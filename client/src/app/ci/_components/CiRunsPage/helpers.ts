/* helpers.ts — pure display transforms for CiRunsPage. Kept out of JSX per the
   frontend-architecture "no derivation in the template" rule. */
import type { IconName } from "@devdigest/ui";

export interface StatusMeta {
  labelKey: "succeeded" | "failed" | "running" | "no_findings" | null;
  color: string;
  icon: IconName;
}

/** Visual meta for the run status column. */
export function statusMeta(status: string | null | undefined): StatusMeta {
  switch (status) {
    case "succeeded":
      return { labelKey: "succeeded", color: "var(--ok)", icon: "CheckCircle" };
    case "failed":
      return { labelKey: "failed", color: "var(--crit)", icon: "XCircle" };
    case "running":
      return { labelKey: "running", color: "var(--accent)", icon: "RefreshCw" };
    case "no_findings":
      return { labelKey: "no_findings", color: "var(--text-muted)", icon: "Check" };
    default:
      return { labelKey: null, color: "var(--text-muted)", icon: "Dot" };
  }
}

/** `duration_s` -> "12s" / "1m 23s". Null/undefined -> em dash. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export interface VerdictMeta {
  labelKey: "requestChanges" | "comment" | "approve" | null;
  color: string;
}

/**
 * UI-derived verdict (D4 in the CI-run-trace-drawer plan) — NOT a contract
 * field. Approximates the review verdict an equivalent PR review would have
 * left, from `ci_run.status` alone: `failed` (gate tripped) reads like a
 * blocking review, `succeeded` (findings but no gate trip) like a comment-only
 * review, `no_findings` like a clean approval. Anything else (e.g. `running`,
 * null) has no verdict yet.
 */
export function verdictMeta(status: string | null | undefined): VerdictMeta {
  switch (status) {
    case "failed":
      return { labelKey: "requestChanges", color: "var(--crit)" };
    case "succeeded":
      return { labelKey: "comment", color: "var(--warn)" };
    case "no_findings":
      return { labelKey: "approve", color: "var(--ok)" };
    default:
      return { labelKey: null, color: "var(--text-muted)" };
  }
}
