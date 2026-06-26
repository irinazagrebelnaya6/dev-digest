import type { FindingRecord } from "@devdigest/shared";
import type { Severity } from "@/vendor/ui/primitives/tokens";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Count findings per severity level. */
export function severityCounts(findings: FindingRecord[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0, INFO: 0 };
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity as Severity]++;
  }
  return counts;
}

/** Optionally drop low-confidence findings, filter by severity, and sort. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity?: Severity | null,
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (severity) shown = shown.filter((f) => f.severity === severity);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
