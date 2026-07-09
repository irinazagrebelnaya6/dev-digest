/**
 * Boundary mappers — the ONLY place Drizzle-row / service-DTO shapes are turned
 * into the curated, snake_case MCP output shapes. No handler or resource builds
 * an output object by hand; they all go through here, so an internal DTO field
 * (e.g. `review_id`, `kind`, `evidence`) can never leak onto the wire.
 *
 * Pure functions only — no DB, no network, no throwing. (Cursor decode, which
 * must reject bad input with a VALIDATION_ERROR, lives in `get-findings.ts`.)
 */
import type { Agent, ConventionCandidate } from '@devdigest/shared';
import type { ReviewDtoFinding } from '../../modules/reviews/helpers.js';
import { renderSkillBody } from '../../modules/conventions/helpers.js';
import type { McpAgent, McpFinding, McpRunHandle, RunStatus, SeverityBreakdown } from '../schemas.js';

/** `list_agents` — 6 scalar fields only (drops system_prompt/output_schema/version/…). */
export function toMcpAgent(a: Agent): McpAgent {
  return {
    agent_id: a.id,
    name: a.name,
    description: a.description,
    provider: a.provider,
    model: a.model,
    enabled: a.enabled,
  };
}

/** Internal review DTO finding → the 9-field curated MCP finding. */
export function toMcpFinding(f: ReviewDtoFinding): McpFinding {
  return {
    severity: f.severity as McpFinding['severity'],
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    category: f.category as McpFinding['category'],
    title: f.title,
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
    confidence: f.confidence,
  };
}

/** Run handle produced by `queueRuns` → MCP run handle (identity fields only). */
export function toMcpRunHandle(run: {
  run_id: string;
  agent_id: string;
  agent_name: string;
}): McpRunHandle {
  return { run_id: run.run_id, agent_id: run.agent_id, agent_name: run.agent_name };
}

/** ACCEPTED conventions → the markdown body served by the conventions resource. */
export function toConventionsMarkdown(list: ConventionCandidate[]): string {
  return renderSkillBody(list);
}

// ---------------------------------------------------------------------------
// Finding aggregation helpers (severity is the axis MCP callers care about).
// ---------------------------------------------------------------------------

/** Sort rank so CRITICAL surfaces before WARNING before SUGGESTION. */
const SEVERITY_RANK: Readonly<Record<string, number>> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/** Count findings by severity over the FULL set (before any filter/pagination). */
export function computeBreakdown(findings: readonly ReviewDtoFinding[]): SeverityBreakdown {
  const b = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) {
    if (f.severity === 'CRITICAL') b.critical++;
    else if (f.severity === 'WARNING') b.warning++;
    else if (f.severity === 'SUGGESTION') b.suggestion++;
  }
  return b;
}

/** Stable sort by severity rank (unknown severities sort last). */
export function sortBySeverity<T extends { severity: string }>(findings: readonly T[]): T[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
  );
}

/**
 * Map an `agent_runs.status` (`running | done | failed | cancelled`, or null)
 * to the MCP `RunStatus`. `cancelled` collapses to `failed`; anything
 * else/absent (or a run that produced no review yet) is `pending`.
 */
export function deriveStatus(runStatus: string | null | undefined): RunStatus {
  switch (runStatus) {
    case 'done':
      return 'done';
    case 'running':
      return 'running';
    case 'failed':
    case 'cancelled':
      return 'failed';
    default:
      return 'pending';
  }
}
