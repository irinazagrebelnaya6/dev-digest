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
