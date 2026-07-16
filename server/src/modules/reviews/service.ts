import type { Container } from '../../platform/container.js';
import type {
  FindingActionKind,
  GitHubClient,
  PrIntentRecord,
  PrRisksRecord,
  Provider,
  Review,
  RunEventKind,
  RunSummary,
  RunTrace,
  SmartDiff,
  UnifiedDiff,
} from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { findingRowToDto, reviewToDto } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import { computeIntent } from './intent-service.js';
import { computeRisks } from './risk-service.js';
import { composeSmartDiff } from './smart-diff.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * One agent's result from {@link ReviewService.reviewDiff} — a local review of a
 * raw diff (e.g. the pre-push CLI's working tree), NOT persisted to the DB.
 * `review` is the grounded output of `reviewPullRequest`; `null` only when the
 * agent errored (message in `error`), so the caller can report per-agent
 * failures without aborting the others.
 */
export interface LocalAgentReview {
  agent: { id: string; name: string; provider: string; model: string };
  review: Review | null;
  grounding: string;
  droppedCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** Findings at/above the agent's `ci_fail_on` gate — the CLI's exit-code signal. */
  blockers: number;
  error?: string;
}

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. Precedence (SPEC-06 AC-8): `agentIds` (a
   * picked set) > `agentId` (single) > `all` (every enabled agent). An empty
   * `agentIds` is rejected — the picker should never send it (the shared
   * `RunRequest.agentIds` is `.nonempty()`), but this guards direct callers
   * (e.g. MCP, tests) too.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean; agentIds?: string[] },
  ): Promise<AgentRow[]> {
    if (opts.agentIds !== undefined) {
      if (opts.agentIds.length === 0) {
        throw new AppError('invalid_run_request', 'agentIds must not be empty', 400);
      }
      const agents = await Promise.all(
        opts.agentIds.map((id) => this.agents.getById(workspaceId, id)),
      );
      const missing = agents.findIndex((a) => !a);
      if (missing !== -1) throw new NotFoundError(`Agent not found: ${opts.agentIds[missing]}`);
      return agents as AgentRow[];
    }
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId, agentIds, or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    const raw = await this.repo.listRunsForPull(workspaceId, prId);
    return raw.map((run) => ({
      ...run,
      cost_usd:
        run.status === 'done' &&
        run.tokens_in != null &&
        run.tokens_out != null &&
        run.model != null
          ? (this.container.priceBook.estimate(run.model, run.tokens_in, run.tokens_out) ?? null)
          : null,
    }));
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Review a RAW diff (no PR row) with the enabled agents — or one named agent.
   *
   * This is the SAME engine and agents the PR review uses: it runs
   * `reviewPullRequest` (from `@devdigest/reviewer-core`) per agent, exactly like
   * `run-executor.runOneAgent`, including each agent's linked+enabled skills and
   * the citation-grounding gate. It deliberately does NOT persist (there is no
   * PR) and skips repo-intel enrichment (the working copy is not an indexed
   * repo), so the prompt is the repo-intel-off baseline.
   *
   * Backs the pre-push CLI (`devdigest review --mode working`): the diff comes
   * from `git diff` in the developer's working copy, so a review is available
   * BEFORE a push/PR exists. Per-agent failures are isolated (captured in the
   * result's `error`), mirroring the executor's isolation.
   */
  async reviewDiff(
    workspaceId: string,
    diff: UnifiedDiff,
    opts: {
      agentId?: string;
      all?: boolean;
      /** Task framing line (default: a generic working-tree review instruction). */
      task?: string;
      /** Progress sink forwarded to the engine (e.g. the CLI's spinner). */
      onEvent?: (e: { kind: RunEventKind; msg: string; data?: unknown }) => void;
    } = {},
  ): Promise<LocalAgentReview[]> {
    const targets = await this.resolveTargets(workspaceId, {
      agentId: opts.agentId,
      all: opts.all ?? !opts.agentId,
    });
    if (targets.length === 0) {
      throw new AppError(
        'no_enabled_agents',
        'No enabled agents to run. Enable at least one agent, or pass an explicit agent id.',
        400,
      );
    }

    const task =
      opts.task ??
      'Review the local working-tree changes for bugs, correctness, security, and clarity.';

    const results: LocalAgentReview[] = [];
    for (const agent of targets) {
      const meta = { id: agent.id, name: agent.name, provider: agent.provider, model: agent.model };
      try {
        const llm = await this.container.llm(agent.provider as Provider);
        const linked = await this.agents.linkedSkills(agent.id);
        const skills = linked.filter((l) => l.skill.enabled).map((l) => l.skill.body);

        const outcome = await reviewPullRequest({
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          diff,
          llm,
          strategy: agent.strategy ?? REVIEW_STRATEGY,
          ...(skills.length > 0 ? { skills } : {}),
          task,
          sessionId: `local-working-tree:${agent.name}`,
          ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
        });

        results.push({
          agent: meta,
          review: outcome.review,
          grounding: outcome.grounding,
          droppedCount: outcome.dropped.length,
          tokensIn: outcome.tokensIn,
          tokensOut: outcome.tokensOut,
          costUsd: outcome.costUsd,
          blockers: countBlockers(outcome.review.findings, agent.ciFailOn),
        });
      } catch (err) {
        results.push({
          agent: meta,
          review: null,
          grounding: '0/0 passed',
          droppedCount: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: null,
          blockers: 0,
          error: (err as Error).message,
        });
      }
    }
    return results;
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   *
   * `agentIds`, when provided (the picked-set launch, SPEC-06 AC-8/AC-9),
   * creates one `multi_agent_runs` row up front and links every child run to
   * it; the id is returned as `multiAgentRunId` so the route can hand it back
   * to the picker. Legacy `{agentId}`/`{all}` callers omit `agentIds` and get
   * `multiAgentRunId: null`.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
    opts: { agentIds?: string[] } = {},
  ): Promise<{
    runs: { run_id: string; agent_id: string; agent_name: string }[];
    reviews: ReviewDto[];
    multiAgentRunId: string | null;
  }> {
    const { pull, repo, runs, jobs, multiAgentRunId } = await this.queueRuns(
      workspaceId,
      prId,
      targets,
      opts,
    );

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [], multiAgentRunId };
  }

  /**
   * Blocking variant of {@link runReview}: queue the runs then AWAIT the
   * executor before returning. Backs the MCP `run_agent_on_pr` tool, whose
   * design is "a completed result, not an operation" — the caller gets the
   * finished run handles in one round-trip and reads the findings with
   * `reviewsForRun`/`getRun`. Per-agent failures are still isolated inside the
   * executor (a failed agent leaves a `failed` run row; the others complete),
   * so this resolves once EVERY queued run has settled (done/failed/cancelled).
   */
  async runReviewAndWait(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[] }> {
    const { pull, repo, runs, jobs } = await this.queueRuns(workspaceId, prId, targets);
    await this.executor.executeRuns(workspaceId, pull, repo, jobs, logger);
    return { runs };
  }

  /**
   * Shared setup for the fire-and-forget and blocking run paths: resolve the
   * pull + repo and create an `agent_runs` row per target up front so a runId
   * is available IMMEDIATELY. Returns the run handles + the executor jobs.
   *
   * When `opts.agentIds` is a non-empty picked set (SPEC-06 AC-9), creates one
   * `multi_agent_runs` row FIRST and threads its id into every `createAgentRun`
   * call so every child run this launch produces is linked to it. Legacy
   * `{agentId}`/`{all}` launches (no `agentIds`) keep `multiAgentRunId: null` —
   * this is the ONLY branch that creates a multi-run row.
   */
  private async queueRuns(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    opts: { agentIds?: string[] } = {},
  ): Promise<{
    pull: NonNullable<Awaited<ReturnType<ReviewRepository['getPull']>>>;
    repo: NonNullable<Awaited<ReturnType<ReviewRepository['getRepo']>>>;
    runs: { run_id: string; agent_id: string; agent_name: string }[];
    jobs: { agent: AgentRow; runId: string }[];
    multiAgentRunId: string | null;
  }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const multiAgentRunId =
      opts.agentIds !== undefined && opts.agentIds.length > 0
        ? await this.repo.createMultiAgentRun({ workspaceId, prId })
        : null;

    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        multiAgentRunId,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }
    return { pull, repo, runs, jobs, multiAgentRunId };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  /**
   * `reply` (SPEC-06 AC-18) is handled HERE, not in `findings.ts`, because it
   * needs `container.github()` — `findings.ts` stays a pure repo-only module.
   * Every other action delegates unchanged.
   */
  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
    reply?: string,
  ): Promise<{ finding: ReviewDtoFinding }> {
    if (action === 'reply') {
      return this.replyToFinding(workspaceId, findingId, reply ?? '');
    }
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  /**
   * Post a GitHub PR review comment anchored to the finding's file+line
   * (mirrors `POST /pulls/:id/comments` + `createReviewComment`). The reply
   * body is untrusted DATA (SPEC-06 AC-26) — passed straight to the adapter's
   * `body` field, never concatenated into a prompt/command. Fails with a clean
   * `AppError` (not a raw 500) when GitHub is unavailable or the finding's
   * line can no longer be anchored (SPEC-06 AC-18 edge case).
   */
  private async replyToFinding(
    workspaceId: string,
    findingId: string,
    reply: string,
  ): Promise<{ finding: ReviewDtoFinding }> {
    if (!reply.trim()) {
      throw new AppError('invalid_reply', 'Reply body must not be empty', 400);
    }
    const ctx = await this.repo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, pull } = ctx;
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    if (!finding.startLine || finding.startLine < 1) {
      throw new AppError('invalid_reply_target', 'Finding has no valid diff line to reply on', 400);
    }

    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      throw new AppError(
        'github_unavailable',
        'Connect a GitHub token to reply to findings.',
        400,
      );
    }

    try {
      await gh.createReviewComment({ owner: repoRow.owner, name: repoRow.name }, pull.number, {
        commitId: pull.headSha,
        path: finding.file,
        line: finding.startLine,
        body: reply,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to post the reply to GitHub.';
      throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
    }

    return { finding: findingRowToDto(finding) };
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  /**
   * A single run by id (workspace-scoped) as a `RunSummary`, or `undefined`
   * for an unknown/foreign run. Backs the MCP `get_findings` tool's status
   * derivation on the `run_id` path (where no PR is known up front, so
   * `listRuns` can't be used). No cost enrichment — MCP output omits cost.
   */
  async getRun(workspaceId: string, runId: string): Promise<RunSummary | undefined> {
    return this.repo.getRunById(workspaceId, runId);
  }

  /**
   * Reviews linked to a specific agent run (newest first) — mirrors
   * `reviewsForPull`'s DTO shape + agent-name enrichment, but keyed by
   * `run_id` instead of `pr_id`. Backs the MCP `get_findings` tool's
   * `run_id` lookup path.
   */
  async reviewsForRun(workspaceId: string, runId: string): Promise<ReviewDto[]> {
    const rows = await this.repo.reviewsByRunId(workspaceId, runId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  // ===========================================================================
  // Identifier resolution — human-friendly `"owner/name"` repo + PR `number`
  // to internal UUIDs. Lives here (application layer) so the MCP adapter (and
  // any other inbound adapter) never has to touch a repository directly.
  // Error messages follow the existing `NotFoundError` convention in this file
  // ("Repo not found" / "Pull request not found") — MCP-layer callers
  // (`mcp/resolvers.ts`) know from calling context which lookup failed and map
  // that to the stable `REPO_NOT_FOUND` / `PR_NOT_FOUND` machine codes.
  // ===========================================================================

  /** Resolve a repo by its `"owner/name"` full name, scoped to the workspace. */
  async resolveRepo(workspaceId: string, fullName: string): Promise<{ repoId: string }> {
    const repo = await this.repo.getRepoByFullName(workspaceId, fullName);
    if (!repo) throw new NotFoundError(`Repo not found: ${fullName}`);
    return { repoId: repo.id };
  }

  /** Resolve a PR by `"owner/name"` + PR `number`, scoped to the workspace. */
  async resolvePull(
    workspaceId: string,
    fullName: string,
    number: number,
  ): Promise<{ repoId: string; prId: string }> {
    const { repoId } = await this.resolveRepo(workspaceId, fullName);
    const pull = await this.repo.getPullByNumber(workspaceId, repoId, number);
    if (!pull) throw new NotFoundError(`Pull request not found: ${fullName}#${number}`);
    return { repoId, prId: pull.id };
  }

  /** Minimal repo listing for the MCP conventions resource's `resources/list`. */
  async listRepos(
    workspaceId: string,
  ): Promise<{ repoId: string; owner: string; name: string; fullName: string }[]> {
    const rows = await this.repo.listReposForWorkspace(workspaceId);
    return rows.map((r) => ({ repoId: r.id, owner: r.owner, name: r.name, fullName: r.fullName }));
  }

  // ===========================================================================
  // Intent Layer — synchronous recompute + read (the run-executor pre-step
  // shares the same `computeIntent` service function; see run-executor.ts).
  // ===========================================================================

  /** Recompute + persist the Intent for a PR (the "Recompute" button). */
  async computeIntentForPull(workspaceId: string, prId: string): Promise<PrIntentRecord> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repo);
    const intent = await computeIntent(this.container, workspaceId, pull, repo, diff);
    return { ...intent, pr_id: pull.id };
  }

  /** The stored Intent for a PR, or `null` when none has been computed yet. */
  async getIntentForPull(workspaceId: string, prId: string): Promise<PrIntentRecord | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const intent = await this.repo.getIntent(pull.id);
    return intent ? { ...intent, pr_id: pull.id } : null;
  }

  // ===========================================================================
  // Risk Areas — synchronous recompute + read. Uses the CAPABLE `risk_brief`
  // model + the diff WITH hunk bodies (unlike Intent, which is header-only).
  // Persisted as a partial brief blob (`{ risks: Risk[] }`) in `pr_brief.json`.
  // ===========================================================================

  /** Recompute + persist the Risk Areas assessment for a PR (the "Recompute" button). */
  async computeRisksForPull(workspaceId: string, prId: string): Promise<PrRisksRecord> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repo);
    const risks = await computeRisks(this.container, workspaceId, pull, repo, diff);
    return { ...risks, pr_id: pull.id };
  }

  /**
   * The stored Risk Areas assessment for a PR — an empty-risks record
   * (`{ risks: [], pr_id }`) when nothing has been computed yet, so GET works
   * before any review/recompute.
   */
  async getRisksForPull(workspaceId: string, prId: string): Promise<PrRisksRecord | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const brief = await this.repo.getBrief(pull.id);
    if (!brief?.risks) return null;
    return { risks: brief.risks, pr_id: pull.id };
  }

  // ===========================================================================
  // Smart Diff — NO LLM call. Deterministically composes already-loaded PR
  // files (pr_files) + already-computed findings (latest review). See
  // ./smart-diff.ts for the pure classifier/composer.
  // ===========================================================================

  /** Risk-ordered (core → wiring → boilerplate) diff layout for a PR. */
  async smartDiffForPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const files = await this.repo.getPrFiles(pull.id);
    const reviews = await this.repo.reviewsForPull(pull.id);
    const findings = (reviews[0]?.findings ?? []).map((f) => ({
      file: f.file,
      startLine: f.startLine,
    }));
    return composeSmartDiff(
      files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      findings,
    );
  }
}
