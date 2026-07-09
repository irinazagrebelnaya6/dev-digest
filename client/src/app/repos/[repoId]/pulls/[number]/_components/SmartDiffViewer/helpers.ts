/** Pure helpers for SmartDiffViewer — no DB/network, no LLM. */
import type { PrFile, SmartDiffRole } from "@devdigest/shared";

/**
 * Initial open/collapsed state per role: boilerplate always starts collapsed,
 * core always starts expanded, wiring falls back to FileCard's own
 * size-based decision (undefined = "let FileCard decide").
 */
export function defaultOpenForRole(role: SmartDiffRole): boolean | undefined {
  if (role === "boilerplate") return false;
  if (role === "core") return true;
  return undefined;
}

/** Sum of additions/deletions across a file list — for the "+X −Y" summary line. */
export function sumStats(files: PrFile[]): { additions: number; deletions: number } {
  return files.reduce(
    (acc, f) => ({ additions: acc.additions + (f.additions ?? 0), deletions: acc.deletions + (f.deletions ?? 0) }),
    { additions: 0, deletions: 0 },
  );
}

/** Look up a PrFile (for its patch) by path — smart-diff files carry no patch of their own. */
export function findPrFile(files: PrFile[], path: string): PrFile | undefined {
  return files.find((f) => f.path === path);
}

/** Scroll a click-to-line target into view. No-op if the row isn't in the DOM. */
export function scrollToFindingLine(path: string, line: number): void {
  const el = document.querySelector(`[data-pr-file="${path}"] [data-line="${line}"]`);
  el?.scrollIntoView({ block: "center" });
}
