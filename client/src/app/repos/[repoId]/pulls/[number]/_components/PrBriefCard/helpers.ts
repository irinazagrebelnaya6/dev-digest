import type { RiskSeverity } from "@devdigest/shared";

/** i18n key (relative to the `prReview` namespace) for each risk-level's label.
 *  Mirrors `RiskAreasCard/helpers.ts#SEVERITY_LABEL_KEY` — color is never the
 *  sole signal, every badge carries a text label too. */
export const RISK_LEVEL_LABEL_KEY: Record<RiskSeverity, string> = {
  high: "brief.severityHigh",
  medium: "brief.severityMedium",
  low: "brief.severityLow",
};

/** Map a `risk_level` to the color / background CSS vars used by the theme.
 *  Same severity color convention as `RiskAreasCard/helpers.ts#severityColors`. */
export function riskLevelColors(level: RiskSeverity): { color: string; bg: string } {
  switch (level) {
    case "high":
      return { color: "var(--crit)", bg: "var(--crit-bg)" };
    case "medium":
      return { color: "var(--warn)", bg: "var(--warn-bg)" };
    case "low":
    default:
      return { color: "var(--text-secondary)", bg: "var(--bg-hover)" };
  }
}

/**
 * Heuristic: an endpoint link looks like "GET /path" (HTTP verb + space) —
 * distinguishes it from a repo-relative file path, which never starts with a
 * verb followed by a space. Mirrors how `BlastRadiusCard` treats
 * `endpoints_affected` (plain-text pill, no blob link) vs a caller's
 * `file:line` (clickable `MonoLink`): endpoints aren't files, so they never
 * get a GitHub blob href.
 */
const ENDPOINT_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S/i;
export function isEndpointLink(link: string): boolean {
  return ENDPOINT_RE.test(link);
}
