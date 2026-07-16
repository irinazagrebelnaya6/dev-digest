import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type {
  AgentColumn,
  AgentColumnFinding,
  Conflict,
  MultiAgentEconomics,
  MultiAgentRun,
  PreRunEstimate,
  Severity,
} from '@devdigest/shared';
import { ReviewRepository, type MultiRunChild } from '../reviews/repository.js';
import { composeLocationGroups, type AgentRunForGrouping, type GroupableFinding } from './grouping.js';
import { estimateAgent, medianComparableTokens, summarizeEstimates } from './estimate.js';
import { computeEconomics, type RunTokens } from './economics.js';
import { deriveMultiAgentStatus } from './status.js';

/**
 * A5 — Multi-Agent Review reads (SPEC-06). Follows the reviews module's local
 * `this.repo = new ReviewRepository(container.db)` convention (not a
 * container getter) — this module reads the SAME `agent_runs`/`reviews`/
 * `findings` tables the reviews module owns. All reads are workspace-scoped
 * (AC-24) and only ever surface ALREADY-PERSISTED (already-grounded) findings
 * — no new engine path, so the grounding gate is never bypassed (AC-23).
 */
export class MultiAgentService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  /** `GET /multi-agent-runs/:id` — columns (live-shaped) + derived status + conflicts. */
  async getRun(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const run = await this.repo.getMultiAgentRun(workspaceId, id);
    if (!run) throw new NotFoundError('Multi-agent run not found');
    const pull = await this.repo.getPull(workspaceId, run.prId);
    const children = await this.repo.childRunsForMultiRun(workspaceId, id);
    const enabledAgents = await this.container.agentsRepo.listEnabled(workspaceId);

    const columns = children.map((child) => this.toColumn(child));

    const runAgents: AgentRunForGrouping[] = children
      .filter((c) => c.run.agentId)
      .map((c) => ({
        agent_id: c.run.agentId!,
        agent_name: c.agentName ?? '',
        findings: c.reviews.flatMap(({ findings }) =>
          findings.map(
            (f): GroupableFinding => ({
              id: f.id,
              agent_id: c.run.agentId!,
              file: f.file,
              start_line: f.startLine,
              end_line: f.endLine,
              severity: f.severity as Severity,
              title: f.title,
              rationale: f.rationale,
            }),
          ),
        ),
      }));
    const groups = composeLocationGroups(
      runAgents,
      enabledAgents.map((a) => ({ id: a.id, name: a.name })),
    );
    const conflicts: Conflict[] = groups
      .filter((g) => g.is_conflict)
      .map((g) => ({ file: g.file, line: g.line, title: g.title, takes: g.takes }));

    const totalDurationMs = children.reduce((sum, c) => sum + (c.run.durationMs ?? 0), 0);
    const anyCost = columns.some((c) => c.cost_usd != null);
    const totalCostUsd = anyCost ? columns.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0) : null;
    const status = deriveMultiAgentStatus(columns.map((c) => c.status));

    return {
      id: run.id,
      pr_id: run.prId,
      pr_number: pull?.number ?? null,
      ran_at: run.ranAt.toISOString(),
      agent_count: columns.length,
      total_duration_ms: totalDurationMs,
      total_cost_usd: totalCostUsd,
      status,
      columns,
      conflicts,
    };
  }

  /** `GET /multi-agent-runs/:id/economics` — 1-vs-N tokens + dollars (AC-22). */
  async getEconomics(workspaceId: string, id: string): Promise<MultiAgentEconomics> {
    const run = await this.repo.getMultiAgentRun(workspaceId, id);
    if (!run) throw new NotFoundError('Multi-agent run not found');
    const children = await this.repo.childRunsForMultiRun(workspaceId, id);
    const runsTokens: RunTokens[] = children.map((c) => ({
      model: c.run.model,
      tokensIn: c.run.tokensIn,
      tokensOut: c.run.tokensOut,
    }));
    const singleRun = runsTokens[0] ?? null;
    return computeEconomics(singleRun, runsTokens, (model, tokensIn, tokensOut) =>
      this.container.priceBook.estimate(model, tokensIn, tokensOut),
    );
  }

  /** `GET /pulls/:id/agent-estimates` — per-agent pre-run estimate (AC-5..7). */
  async getAgentEstimates(workspaceId: string, prId: string): Promise<PreRunEstimate> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const enabledAgents = await this.container.agentsRepo.listEnabled(workspaceId);
    const comparable = medianComparableTokens(await this.repo.doneRunsForWorkspace(workspaceId));

    const perAgent = await Promise.all(
      enabledAgents.map(async (agent) => {
        const priorRuns = await this.repo.doneRunsForAgent(workspaceId, agent.id);
        return estimateAgent(
          { agent_id: agent.id, agent_name: agent.name, model: agent.model, priorRuns },
          (model, tokensIn, tokensOut) => this.container.priceBook.estimate(model, tokensIn, tokensOut),
          comparable,
        );
      }),
    );
    const summary = summarizeEstimates(perAgent);
    return { per_agent: perAgent, ...summary };
  }

  private toColumn(child: MultiRunChild): AgentColumn {
    const { run, agentName, reviews } = child;
    const findings: AgentColumnFinding[] = reviews.flatMap(({ findings }) =>
      findings.map(
        (f): AgentColumnFinding => ({
          id: f.id,
          severity: f.severity as Severity,
          category: f.category,
          title: f.title,
          file: f.file,
          start_line: f.startLine,
          kind: f.kind ?? null,
        }),
      ),
    );
    const costUsd =
      run.status === 'done' && run.tokensIn != null && run.tokensOut != null && run.model != null
        ? this.container.priceBook.estimate(run.model, run.tokensIn, run.tokensOut)
        : null;
    return {
      run_id: run.id,
      agent_id: run.agentId ?? '',
      agent_name: agentName ?? '',
      provider: run.provider,
      model: run.model,
      status: (run.status as 'done' | 'failed' | 'running') ?? 'running',
      verdict: reviews[0]?.review.verdict ?? null,
      score: run.score,
      summary: reviews[0]?.review.summary ?? null,
      duration_ms: run.durationMs,
      cost_usd: costUsd,
      findings,
    };
  }
}
