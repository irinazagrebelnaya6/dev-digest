/**
 * `get_findings` tool — fetch review findings for a PR by `run_id` (one agent's
 * run) OR `repo`+`pr` (latest review). Returns run status, score, a
 * pre-aggregated severity breakdown, and a severity-filterable, cursor-paginated
 * findings list. Application layer only (`ReviewService`).
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Container } from '../../platform/container.js';
import { ReviewService } from '../../modules/reviews/service.js';
import type { ReviewDtoFinding } from '../../modules/reviews/helpers.js';
import { mcpError, notFoundError } from '../errors.js';
import { currentWorkspace } from '../context.js';
import { resolvePr } from '../resolvers.js';
import { computeBreakdown, deriveStatus, sortBySeverity, toMcpFinding } from './mappers.js';
import type { GetFindingsInput, RunStatus } from '../schemas.js';

export const GET_FINDINGS_DESCRIPTION =
  'Fetch review findings for a PR. Provide `run_id` (one agent run) OR `repo`+`pr` ' +
  '(latest review). Returns run status, score, a severity breakdown, and a compact, ' +
  'paginated findings list. Use `severity` and `limit`/`cursor` to narrow. A PR with ' +
  'no review yet returns status:"pending" (not an error) — poll again after run_agent_on_pr.';

/** Cursor is an opaque, base64url-encoded absolute offset (`offset:<n>`). */
function encodeCursor(offset: number): string {
  return Buffer.from(`offset:${offset}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    mcpError('VALIDATION_ERROR', 'Invalid `cursor` — pass the exact `next_cursor` from a previous response.', 422);
  }
  const m = /^offset:(\d+)$/.exec(decoded);
  if (!m) {
    mcpError('VALIDATION_ERROR', 'Invalid `cursor` — pass the exact `next_cursor` from a previous response.', 422);
  }
  return Number(m[1]);
}

export async function handleGetFindings(
  container: Container,
  input: GetFindingsInput,
): Promise<CallToolResult> {
  const ws = await currentWorkspace(container);
  const service = new ReviewService(container);

  // MCP tool input is a flat shape, so enforce the run_id-XOR-(repo+pr) rule here.
  const hasRunId = input.run_id !== undefined;
  const hasRepo = input.repo !== undefined;
  const hasPr = input.pr !== undefined;
  if (hasRepo !== hasPr || hasRunId === (hasRepo && hasPr)) {
    mcpError(
      'VALIDATION_ERROR',
      'Provide exactly one of `run_id` or both `repo` and `pr` (not neither, not both).',
      422,
    );
  }

  let reviews;
  let status: RunStatus;
  if (hasRunId) {
    const run = await service.getRun(ws.id, input.run_id!);
    if (!run) {
      notFoundError('RUN_NOT_FOUND', `Run "${input.run_id}" not found in this workspace.`);
    }
    reviews = await service.reviewsForRun(ws.id, input.run_id!);
    status = reviews.length === 0 ? 'pending' : deriveStatus(run.status);
  } else {
    const { prId } = await resolvePr(service, ws.id, input.repo!, input.pr!);
    reviews = await service.reviewsForPull(ws.id, prId);
    if (reviews.length === 0) {
      status = 'pending';
    } else {
      const runs = await service.listRuns(ws.id, prId);
      const latest = runs[0];
      status = latest ? deriveStatus(latest.status) : 'done';
    }
  }

  const allFindings: ReviewDtoFinding[] = reviews.flatMap((r) => r.findings);
  const score = reviews[0]?.score ?? null;
  const breakdown = computeBreakdown(allFindings);

  // Filter (severity) → stable sort by severity rank → slice by cursor/limit.
  const filtered = input.severity
    ? allFindings.filter((f) => f.severity === input.severity)
    : allFindings;
  const sorted = sortBySeverity(filtered);
  const total = sorted.length;

  const offset = decodeCursor(input.cursor);
  const limit = input.limit;
  const page = sorted.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const has_more = nextOffset < total;
  const next_cursor = has_more ? encodeCursor(nextOffset) : null;

  const structuredContent = {
    status,
    score,
    breakdown,
    findings: page.map(toMcpFinding),
    total,
    next_cursor,
    has_more,
  };

  const text =
    `status: ${status}` +
    (score !== null ? `, score: ${score}` : '') +
    `\nfindings: ${total} (critical ${breakdown.critical} / warning ${breakdown.warning} / suggestion ${breakdown.suggestion})` +
    (has_more ? `\nshowing ${page.length}; more available — pass cursor="${next_cursor}"` : '');

  return { content: [{ type: 'text', text }], structuredContent };
}
