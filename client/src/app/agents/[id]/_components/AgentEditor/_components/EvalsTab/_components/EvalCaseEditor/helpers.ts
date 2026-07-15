import { EvalExpectation } from "@devdigest/shared";
import type { EvalCaseMeta } from "@/lib/hooks/evals";

export type ExpectedOutputValidation =
  | { valid: true; value: EvalExpectation }
  | { valid: false; error: string };

/** Client-side rejection before save (AC-20) — parses the textarea's raw JSON
 *  and validates it against the frozen `EvalExpectation` contract (D4). Never
 *  silently accepted as `unknown`. */
export function validateExpectedOutput(raw: string): ExpectedOutputValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, error: "invalidJson" };
  }
  const result = EvalExpectation.safeParse(parsed);
  if (!result.success) return { valid: false, error: "invalidJson" };
  return { valid: true, value: result.data };
}

/** A starter `EvalExpectation` object for the "Finding skeleton" helper button
 *  — prefills the file from the first `Files` tab entry (or the diff's first
 *  `+++ b/...` line) when one is available, so the user edits rather than
 *  types from scratch. */
export function expectationSkeleton(type: "must_find" | "must_not_flag", fileHint: string): string {
  return JSON.stringify({ type, file: fileHint || "src/example.ts", start_line: 1, end_line: 1 }, null, 2);
}

/** Best-effort file guess from a raw unified diff's first `+++ b/<path>` line. */
export function firstFileFromDiff(diff: string): string {
  const match = diff.match(/^\+\+\+ b\/(.+)$/m);
  return match ? match[1]!.trim() : "";
}

export function filesToText(files: string[] | null | undefined): string {
  return (files ?? []).join("\n");
}

export function textToFiles(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function metaOrEmpty(meta: EvalCaseMeta | null | undefined): EvalCaseMeta {
  return meta ?? {};
}
