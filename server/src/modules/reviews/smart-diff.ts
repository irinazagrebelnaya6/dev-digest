import type { SmartDiff, SmartDiffFile, SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_PATTERNS,
  SMART_DIFF_SPLIT_THRESHOLD_LINES,
  WIRING_PATTERNS,
} from './smart-diff.constants.js';

/**
 * Smart Diff — pure, deterministic composition of already-loaded PR data.
 * NO LLM call, NO DB access, NO network here: `composeSmartDiff` only reorders
 * data the caller already fetched (pr_files + latest review's findings). The
 * expensive call already happened when the review ran; this module spends
 * zero extra tokens.
 */

/** Fixed group order so the UI always renders core → wiring → boilerplate. */
const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/**
 * Classify a file path into a risk role. Boilerplate patterns are checked
 * FIRST so lock-files always win even if a path also looks config-like.
 * Falls through to `core` by default — including test files (`.test.`,
 * `.spec.`, `__tests__/`), which are intentionally treated as core-worth-
 * reading rather than boilerplate; tune via the pattern constants if needed.
 */
export function classifyFile(path: string): SmartDiffRole {
  const lower = path.toLowerCase();
  if (BOILERPLATE_PATTERNS.some((p) => lower.includes(p) || lower.endsWith(p))) {
    return 'boilerplate';
  }
  if (WIRING_PATTERNS.some((p) => lower.includes(p) || lower.endsWith(p))) {
    return 'wiring';
  }
  return 'core';
}

/**
 * Compose the SmartDiff response from already-loaded PR files and the latest
 * review's findings. Groups are ALWAYS present in fixed order (even when
 * empty) so the UI has a stable shape to render against.
 */
export function composeSmartDiff(
  files: { path: string; additions: number; deletions: number }[],
  findings: { file: string; startLine: number }[],
): SmartDiff {
  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>(
    ROLE_ORDER.map((role) => [role, [] as SmartDiffFile[]]),
  );

  for (const file of files) {
    const role = classifyFile(file.path);
    const findingLines = [
      ...new Set(
        findings.filter((f) => f.file === file.path).map((f) => f.startLine),
      ),
    ].sort((a, b) => a - b);

    byRole.get(role)!.push({
      path: file.path,
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLines,
    });
  }

  const groups = ROLE_ORDER.map((role) => ({ role, files: byRole.get(role)! }));

  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const tooBig = totalLines > SMART_DIFF_SPLIT_THRESHOLD_LINES;
  const proposedSplits = tooBig
    ? groups
        .filter((g) => g.files.length > 0)
        .map((g) => ({ name: g.role, files: g.files.map((f) => f.path) }))
    : [];

  return {
    groups,
    split_suggestion: {
      too_big: tooBig,
      total_lines: totalLines,
      proposed_splits: proposedSplits,
    },
  };
}
