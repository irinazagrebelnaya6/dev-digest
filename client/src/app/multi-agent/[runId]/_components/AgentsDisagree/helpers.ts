import type { Conflict } from "@devdigest/shared";

/**
 * DISPLAY-ONLY reimplementation of the "conflict" predicate from the spec's
 * resolved decision #2 (SPEC-06 AC-21) — NOT the scoring authority (that's the
 * server's `modules/multi-agent/grouping.ts`). Used only to drive the "Show
 * only conflicts" toggle: a group is a conflict when ≥1 agent flagged AND ≥1
 * enabled, in-run agent "did not flag" (`ignored`), OR the flagging agents
 * disagree on severity.
 */
export function isConflictGroup(conflict: Conflict): boolean {
  const flagged = conflict.takes.filter((t) => t.verdict !== "ignored" && t.verdict !== "did_not_run");
  const ignored = conflict.takes.some((t) => t.verdict === "ignored");
  if (flagged.length === 0) return false;
  if (flagged.length >= 1 && ignored) return true;
  const severities = new Set(flagged.map((t) => t.verdict));
  return severities.size > 1;
}
