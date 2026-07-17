/**
 * A5 — Multi-Agent Review status derivation (SPEC-06 AC-12). Pure, DB-free:
 * takes the child `agent_runs.status` values for one `multi_agent_runs` row
 * and derives the launch's overall status.
 *
 * Semantics (spec's Resolved decision #5):
 *   - `running` while ANY child is still running (or has no status yet).
 *   - `partial` when all children have settled (done/failed/cancelled) with
 *     at least one failure.
 *   - `done` when every child is `done`.
 *   - `failed` when every child failed (or was cancelled — no successful run).
 */

export type MultiAgentStatus = 'running' | 'partial' | 'done' | 'failed';

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export function deriveMultiAgentStatus(childStatuses: (string | null | undefined)[]): MultiAgentStatus {
  if (childStatuses.length === 0) return 'done';
  const stillRunning = childStatuses.some((s) => !s || !TERMINAL.has(s));
  if (stillRunning) return 'running';

  const succeeded = childStatuses.filter((s) => s === 'done').length;
  if (succeeded === childStatuses.length) return 'done';
  if (succeeded === 0) return 'failed';
  return 'partial';
}
