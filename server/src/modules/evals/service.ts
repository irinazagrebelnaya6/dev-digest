import type { Container } from '../../platform/container.js';
import type {
  Agent,
  EvalCase,
  EvalDashboard,
  EvalExpectation,
  EvalOwnerKind,
  EvalRunRecord,
  EvalTrendPoint,
} from '@devdigest/shared';
import { AgentVersionConfig } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { EvalsRepository } from './repository.js';
import { toEvalCaseDto, toEvalRunRecordDto, groupRunsByBatch, type EvalBatch } from './helpers.js';
import { runBatch } from './execution.js';
import { serializeUnifiedDiff } from './diff-freeze.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { AgentsService } from '../agents/service.js';

/**
 * SPEC-05 — eval service. Case CRUD, "Turn into eval case" (AC-2/AC-3),
 * batch execution wiring (AC-6), dashboard reads (AC-15/17/18), compare
 * (AC-12/13) and promote (AC-14).
 */

export interface CreateEvalCaseInput {
  owner_kind: EvalOwnerKind;
  owner_id: string;
  name: string;
  input_diff?: string;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output: EvalExpectation;
  notes?: string | null;
}

export interface UpdateEvalCaseInput {
  name?: string;
  input_diff?: string;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output?: EvalExpectation;
  notes?: string | null;
}

export interface EvalCompareSide {
  batch_id: string;
  agent_version: number;
  ran_at: string;
  cases_total: number;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  cost_usd: number | null;
  system_prompt: string;
}

export interface EvalCompareResult {
  agent_id: string;
  a: EvalCompareSide;
  b: EvalCompareSide;
  delta: { recall: number; precision: number; citation_accuracy: number; cost_usd: number };
}

function deltaOf(cur: number | null, prev: number | null): number {
  if (cur == null || prev == null) return 0;
  return cur - prev;
}

/** How many of the newest WHOLE batches feed a dashboard's "Recent eval runs" table (FIX-4). */
const RECENT_RUN_BATCH_LIMIT = 20;

export class EvalsService {
  private repo: EvalsRepository;
  private agentsService: AgentsService;

  constructor(private container: Container) {
    this.repo = container.evalRepo;
    this.agentsService = new AgentsService(container);
  }

  // ===========================================================================
  // Case CRUD (AC-1, AC-19, AC-20, AC-21)
  // ===========================================================================

  async listCasesForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCase[]> {
    const rows = await this.repo.listCasesForOwner(workspaceId, ownerKind, ownerId);
    return rows.map(toEvalCaseDto);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    const row = await this.repo.getCaseById(workspaceId, id);
    return row ? toEvalCaseDto(row) : undefined;
  }

  async createCase(workspaceId: string, input: CreateEvalCaseInput): Promise<EvalCase> {
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes,
    });
    return toEvalCaseDto(row);
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCaseInput,
  ): Promise<EvalCase | undefined> {
    const row = await this.repo.updateCase(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined ? { expectedOutput: patch.expected_output } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, id);
  }

  /**
   * AC-2/AC-3 — "Turn into eval case". Owner/expectation/diff are ALL derived
   * server-side from the finding + its review (Q8: the route never accepts
   * `owner_kind`/`owner_id` from the client). `must_find` for an accepted
   * finding, `must_not_flag` for a dismissed one; a finding with neither set
   * is rejected (AC-4 keeps the client action itself hidden/disabled, this is
   * the server-side backstop).
   */
  async createCaseFromFinding(workspaceId: string, findingId: string): Promise<EvalCase> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    if (!finding.acceptedAt && !finding.dismissedAt) {
      throw new AppError(
        'finding_not_actioned',
        'Finding must be accepted or dismissed before it can become an eval case',
        400,
      );
    }
    if (!review.agentId) {
      throw new AppError('finding_no_agent', 'Finding has no originating agent', 400);
    }

    const expectation: EvalExpectation = {
      type: finding.acceptedAt ? 'must_find' : 'must_not_flag',
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
    };

    // Freeze input_diff at creation time (AC-2/AC-3/AC-5) — same
    // reconstruction path (`loadDiff`) a normal review uses, so the case
    // stays runnable/reproducible independent of any later PR/repo change.
    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const diff = await loadDiff(this.container, this.container.reviewRepo, workspaceId, pull, repoRow);
    const inputDiff = serializeUnifiedDiff(diff);

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: review.agentId,
      name: finding.title,
      inputDiff,
      inputMeta: { pr_number: pull.number, pr_title: pull.title, pr_body: pull.body },
      expectedOutput: expectation,
      notes: null,
    });
    return toEvalCaseDto(row);
  }

  // ===========================================================================
  // Batch execution (AC-5, AC-6, AC-16, AC-20's "Run case", AC-22)
  // ===========================================================================

  /** Run every case owned by one agent — one new batch (AC-6). Empty case set → empty batch, not an error. */
  async runForAgent(workspaceId: string, agentId: string): Promise<EvalRunRecord[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    const rows = await runBatch(this.container, agent, cases);
    const caseById = new Map(cases.map((c) => [c.id, c]));
    return rows.map((run) => toEvalRunRecordDto({ run, case: caseById.get(run.caseId)! }));
  }

  /** Run one case (case editor's "Run case") — a one-case batch. */
  async runForCase(workspaceId: string, caseId: string): Promise<EvalRunRecord[]> {
    const caseRow = await this.repo.getCaseById(workspaceId, caseId);
    if (!caseRow) throw new NotFoundError('Eval case not found');
    if (caseRow.ownerKind !== 'agent') {
      throw new AppError(
        'unsupported_owner_kind',
        'Only agent-owned cases can be run (skill-owned cases are a future feature)',
        400,
      );
    }
    const agent = await this.container.agentsRepo.getById(workspaceId, caseRow.ownerId);
    if (!agent) throw new NotFoundError('Agent not found');
    const rows = await runBatch(this.container, agent, [caseRow]);
    return rows.map((run) => toEvalRunRecordDto({ run, case: caseRow }));
  }

  /** "Run all agents" (AC-16) — one batch per ENABLED agent that has >=1 case; case-less agents are skipped. */
  async runAllAgents(
    workspaceId: string,
  ): Promise<{ agent_id: string; runs: EvalRunRecord[] }[]> {
    const agents = await this.container.agentsRepo.listEnabled(workspaceId);
    const results: { agent_id: string; runs: EvalRunRecord[] }[] = [];
    for (const agent of agents) {
      const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agent.id);
      if (cases.length === 0) continue;
      const rows = await runBatch(this.container, agent, cases);
      const caseById = new Map(cases.map((c) => [c.id, c]));
      results.push({
        agent_id: agent.id,
        runs: rows.map((run) => toEvalRunRecordDto({ run, case: caseById.get(run.caseId)! })),
      });
    }
    return results;
  }

  // ===========================================================================
  // Reads: run history + dashboards (AC-15, AC-17, AC-18, AC-19)
  // ===========================================================================

  /**
   * An agent's run history as FLAT run records (newest first), NOT grouped
   * batches — the client hook `useAgentEvalRuns` does its own client-side
   * grouping, exactly like the dashboard's `recent_runs`. This also keeps GET
   * `/agents/:id/eval-runs` consistent with the POST on the same path, which
   * already returns a flat `EvalRunRecord[]`.
   */
  async runHistoryForAgent(workspaceId: string, agentId: string): Promise<EvalRunRecord[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const runRows = await this.repo.listRunsForOwner(workspaceId, 'agent', agentId);
    return runRows.map(toEvalRunRecordDto);
  }

  async perAgentDashboard(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    const runRows = await this.repo.listRunsForOwner(workspaceId, 'agent', agentId);
    return this.buildDashboard('agent', agentId, cases.length, runRows);
  }

  async workspaceDashboard(workspaceId: string): Promise<EvalDashboard> {
    const cases = await this.repo.listCasesForWorkspace(workspaceId);
    const runRows = await this.repo.listRunsForWorkspace(workspaceId);
    return this.buildDashboard(null, null, cases.length, runRows);
  }

  private buildDashboard(
    ownerKind: EvalOwnerKind | null,
    ownerId: string | null,
    casesTotal: number,
    runRows: Awaited<ReturnType<EvalsRepository['listRunsForWorkspace']>>,
  ): EvalDashboard {
    const batches = groupRunsByBatch(runRows); // newest first
    const latest = batches[0];
    const previous = batches[1];

    // FIX-5: a structurally-null metric (zero must_find / must_not_flag cases)
    // stays `null` (renders "—"), never flattened to `0` — matching the
    // recent-runs cells' own null handling and AC-8/AC-9's "never 0/1" spirit.
    const current = {
      recall: latest?.recall ?? null,
      precision: latest?.precision ?? null,
      citation_accuracy: latest?.citation_accuracy ?? null,
      traces_passed: latest?.traces_passed ?? 0,
      traces_total: latest?.traces_total ?? 0,
      cost_usd: latest?.cost_usd ?? null,
    };
    const delta = {
      recall: deltaOf(latest?.recall ?? null, previous?.recall ?? null),
      precision: deltaOf(latest?.precision ?? null, previous?.precision ?? null),
      citation_accuracy: deltaOf(latest?.citation_accuracy ?? null, previous?.citation_accuracy ?? null),
    };

    // Chronological (oldest -> newest) for a trend line chart.
    const trend: EvalTrendPoint[] = [...batches].reverse().map((b) => ({
      ran_at: b.ran_at,
      recall: b.recall ?? 0,
      precision: b.precision ?? 0,
      citation_accuracy: b.citation_accuracy ?? 0,
      pass_rate: b.traces_total > 0 ? b.traces_passed / b.traces_total : 0,
      cost_usd: b.cost_usd,
    }));

    // FIX-4: slice by the newest N whole BATCHES, not by individual case-row —
    // a batch straddling a row-boundary would otherwise show a partial case
    // count / wrong passed-total / understated cost in the "Recent eval runs"
    // table (AC-17). `batches` is newest-first and each `.runs` is already the
    // batch's full set of flat records.
    const recentRuns: EvalRunRecord[] = batches
      .slice(0, RECENT_RUN_BATCH_LIMIT)
      .flatMap((b) => b.runs);

    return {
      owner_kind: ownerKind,
      owner_id: ownerId,
      cases_total: casesTotal,
      current,
      delta,
      trend,
      recent_runs: recentRuns,
      alert: casesTotal === 0 ? 'no cases yet' : null,
    };
  }

  // ===========================================================================
  // Compare + Promote (AC-12, AC-13, AC-14)
  // ===========================================================================

  async compareBatches(
    workspaceId: string,
    batchIdA: string,
    batchIdB: string,
  ): Promise<EvalCompareResult> {
    const runRows = await this.repo.listRunsForWorkspace(workspaceId);
    const batches = groupRunsByBatch(runRows);
    const a = batches.find((b) => b.batch_id === batchIdA);
    const b = batches.find((b) => b.batch_id === batchIdB);
    if (!a || !b) throw new NotFoundError('Eval run batch not found');
    if (a.agent_id !== b.agent_id) {
      throw new AppError(
        'cross_agent_compare',
        'Both batches must belong to the same agent',
        400,
      );
    }

    const [versionA, versionB] = await Promise.all([
      this.container.agentsRepo.getVersion(a.agent_id, a.agent_version),
      this.container.agentsRepo.getVersion(b.agent_id, b.agent_version),
    ]);
    if (!versionA || !versionB) throw new NotFoundError('Agent config version not found');

    const toSide = (batch: EvalBatch, versionRow: NonNullable<typeof versionA>): EvalCompareSide => ({
      batch_id: batch.batch_id,
      agent_version: batch.agent_version,
      ran_at: batch.ran_at,
      cases_total: batch.cases_total,
      recall: batch.recall,
      precision: batch.precision,
      citation_accuracy: batch.citation_accuracy,
      // Batch cost total, summed per-case the same way the dashboard totals it
      // (D3: cost_usd stays per-case in the DB; the batch total is a read-time sum).
      cost_usd: batch.cost_usd,
      system_prompt: AgentVersionConfig.parse(versionRow.configJson).system_prompt,
    });

    return {
      agent_id: a.agent_id,
      a: toSide(a, versionA),
      b: toSide(b, versionB),
      delta: {
        recall: deltaOf(b.recall, a.recall),
        precision: deltaOf(b.precision, a.precision),
        citation_accuracy: deltaOf(b.citation_accuracy, a.citation_accuracy),
        cost_usd: deltaOf(b.cost_usd, a.cost_usd),
      },
    };
  }

  /** Apply a batch's tagged agent version as the agent's LIVE config (AC-14, Q7). */
  async promoteBatch(workspaceId: string, batchId: string): Promise<Agent> {
    const runRows = await this.repo.listRunsForWorkspace(workspaceId);
    const batches = groupRunsByBatch(runRows);
    const batch = batches.find((b) => b.batch_id === batchId);
    if (!batch) throw new NotFoundError('Eval run batch not found');

    const agent = await this.agentsService.restoreVersion(workspaceId, batch.agent_id, batch.agent_version);
    if (!agent) throw new NotFoundError('Agent or version not found');
    return agent;
  }
}
