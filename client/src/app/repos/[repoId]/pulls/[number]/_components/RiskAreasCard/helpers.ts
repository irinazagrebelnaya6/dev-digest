import type { IconName } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";

/** Severity buckets, ordered most→least severe. Drives the tab order and the
 *  default-selected tab (the highest severity that has any risks). */
export const SEVERITY_ORDER = ["high", "medium", "low"] as const;

/** i18n key (relative to the `prReview` namespace) for each severity's tab label. */
export const SEVERITY_LABEL_KEY = {
  high: "riskAreas.severityHigh",
  medium: "riskAreas.severityMedium",
  low: "riskAreas.severityLow",
} as const satisfies Record<Risk["severity"], string>;

/**
 * Map a risk `kind` (controlled vocabulary — auth/security/dependency/perf/data/other)
 * to a lucide icon name. Kept out of the component so the mapping is tunable
 * without touching render logic. Verify names against `client/src/vendor/ui/icons.tsx`
 * before adding new cases — the registry is explicit, not a full lucide re-export.
 */
export function kindIcon(kind: string): IconName {
  switch (kind) {
    case "auth":
    case "security":
      return "Shield";
    case "dependency":
      return "Boxes";
    case "perf":
      return "Zap";
    case "data":
      return "Database";
    default:
      return "AlertTriangle";
  }
}

/** Map a risk `severity` to the color / background CSS vars used by the theme. */
export function severityColors(severity: Risk["severity"]): { color: string; bg: string } {
  switch (severity) {
    case "high":
      return { color: "var(--crit)", bg: "var(--crit-bg)" };
    case "medium":
      return { color: "var(--warn)", bg: "var(--warn-bg)" };
    case "low":
    default:
      return { color: "var(--text-secondary)", bg: "var(--bg-hover)" };
  }
}
