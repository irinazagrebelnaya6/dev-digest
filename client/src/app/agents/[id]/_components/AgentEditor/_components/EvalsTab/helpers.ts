import type { EvalExpectation } from "@devdigest/shared";
import type { EvalCaseRecord, EvalRunRecord } from "@/lib/hooks/evals";
import { readActualOutput } from "@/lib/hooks/evals";

/** Most recent run per case, keyed by `case_id` (runs sorted by `ran_at` desc
 *  win). Mirrors the "build a Map to correlate without an extra API call"
 *  pattern used elsewhere in this codebase (see FindingsTab's run_id → RunSummary map). */
export function latestRunByCase(runs: EvalRunRecord[] | undefined): Map<string, EvalRunRecord> {
  const map = new Map<string, EvalRunRecord>();
  for (const run of runs ?? []) {
    const prev = map.get(run.case_id);
    if (!prev || run.ran_at > prev.ran_at) map.set(run.case_id, run);
  }
  return map;
}

export type CaseRunState = "passed" | "failed" | "error" | "never_run";

/** `pass` is `true`/`false` for a scored run, `null` for an isolated per-case
 *  failure (AC-22 — LLM error/timeout/malformed frozen diff), and there is no
 *  run row at all when the case has never been executed. Three distinct
 *  states, three distinct icon+text pairs (never color alone). */
export function caseRunState(run: EvalRunRecord | undefined): CaseRunState {
  if (!run) return "never_run";
  if (run.pass === true) return "passed";
  if (run.pass === false) return "failed";
  return "error";
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Display-only count of produced findings that overlap this case's
 * expectation range (file + line-range overlap, mirroring AC-7's match
 * predicate). NOT the scoring authority — `server/src/modules/evals/scoring.ts`
 * is; this only powers the case list's "expected … got N" subtitle copy.
 */
export function matchingFindingsCount(expectation: EvalExpectation, run: EvalRunRecord | undefined): number {
  if (!run) return 0;
  const findings = readActualOutput(run).produced_findings ?? [];
  return findings.filter(
    (f) => f.file === expectation.file && overlaps(f.start_line, f.end_line, expectation.start_line, expectation.end_line),
  ).length;
}

/** "11" for a single line, "11-15" for a range — mirrors FindingCard's `lineLabel`. */
export function lineRangeLabel(expectation: Pick<EvalExpectation, "start_line" | "end_line">): string {
  return expectation.start_line === expectation.end_line
    ? `${expectation.start_line}`
    : `${expectation.start_line}-${expectation.end_line}`;
}

/** Fraction of cases whose latest run passed (for the "N/M passing" header). */
export function passingCount(cases: EvalCaseRecord[], runsByCase: Map<string, EvalRunRecord>): number {
  return cases.filter((c) => caseRunState(runsByCase.get(c.id)) === "passed").length;
}
