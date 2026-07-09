/**
 * `run_agent_on_pr` tool — BLOCKING review of a PR by one agent (pass `agent`)
 * or all enabled agents (omit `agent`). Resolves human identifiers via the
 * APPLICATION layer (`ReviewService`), runs via `runReviewAndWait`, then
 * hydrates each run's findings inline ("a completed result, not an operation").
 *
 * Onion: never touches a repository directly — `ReviewService` /
 * `resolvePr` (which delegates to `ReviewService.resolvePull`) only.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Container } from '../../platform/container.js';
import { ReviewService } from '../../modules/reviews/service.js';
import { AppError } from '../../platform/errors.js';
import { mcpError, notFoundError } from '../errors.js';
import { currentWorkspace } from '../context.js';
import { resolvePr } from '../resolvers.js';
import { computeBreakdown, sortBySeverity, toMcpFinding, toMcpRunHandle, deriveStatus } from './mappers.js';
import type { RunAgentOnPrInput } from '../schemas.js';

export const RUN_AGENT_ON_PR_DESCRIPTION =
  'Start a review of a pull request by one agent (pass `agent`) or all enabled ' +
  'agents (omit `agent`). Blocks until every run settles, then returns each ' +
  "run's status, score, severity breakdown, and findings. IMPORTANT: triggers " +
  'real LLM calls and incurs cost.';

export async function handleRunAgentOnPr(
  container: Container,
  input: RunAgentOnPrInput,
): Promise<CallToolResult> {
  const ws = await currentWorkspace(container);
  const service = new ReviewService(container);

  const { prId } = await resolvePr(service, ws.id, input.repo, input.pr);

  let targets;
  try {
    targets = await service.resolveTargets(
      ws.id,
      input.agent ? { agentId: input.agent } : { all: true },
    );
  } catch (err) {
    // A bad explicit agent id surfaces as a generic NotFoundError.
    if (input.agent && err instanceof AppError && err.code === 'not_found') {
      notFoundError(
        'AGENT_NOT_FOUND',
        `Agent "${input.agent}" not found in this workspace. Call list_agents to see valid agent ids.`,
      );
    }
    throw err;
  }

  if (targets.length === 0) {
    mcpError(
      'NO_ENABLED_AGENTS',
      'No enabled agents to run. Enable at least one agent, or pass an explicit `agent` id.',
      400,
    );
  }

  const { runs } = await service.runReviewAndWait(ws.id, prId, targets);

  const results = await Promise.all(
    runs.map(async (r) => {
      const run = await service.getRun(ws.id, r.run_id);
      const reviews = await service.reviewsForRun(ws.id, r.run_id);
      const allFindings = reviews.flatMap((rv) => rv.findings);
      return {
        ...toMcpRunHandle(r),
        status: deriveStatus(run?.status),
        score: reviews[0]?.score ?? null,
        breakdown: computeBreakdown(allFindings),
        findings: sortBySeverity(allFindings).map(toMcpFinding),
      };
    }),
  );

  const structuredContent = { runs: results };

  const text =
    `Ran ${results.length} agent(s) on ${input.repo}#${input.pr}:\n` +
    results
      .map(
        (r) =>
          `- ${r.agent_name}: ${r.status}` +
          (r.status === 'done'
            ? ` — score ${r.score ?? 'n/a'}, ${r.findings.length} finding(s) ` +
              `(critical ${r.breakdown.critical} / warning ${r.breakdown.warning} / suggestion ${r.breakdown.suggestion})`
            : '') +
          ` [run ${r.run_id}]`,
      )
      .join('\n');

  return { content: [{ type: 'text', text }], structuredContent };
}
