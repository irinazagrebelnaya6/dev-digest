import type { ChatMessage, UnifiedDiff } from '@devdigest/shared';

/**
 * Intent Layer — classifier prompt.
 *
 * Builds the messages for a cheap, structured LLM call that classifies WHY a
 * PR was opened into `{ intent, in_scope[], out_of_scope[] }`. Pure (no
 * DB/network) like the rest of reviewer-core; the caller resolves the model,
 * fetches the linked issue, and persists the result.
 *
 * Input is intentionally header-only (file paths + hunk headers, NOT hunk
 * bodies) — the classifier only needs to know WHAT changed at a glance, not
 * the full diff, which keeps this call cheap relative to the main review.
 */

/** The subset of a changed file the classifier needs: path + hunk headers. */
export type IntentDiffFile = UnifiedDiff['files'][number];

export interface BuildIntentPromptInput {
  /** PR title (always present). */
  title: string;
  /** PR author's description/body. May be null/empty — graceful degradation applies. */
  body?: string | null;
  /** Linked issue/ticket title+body, when one could be resolved. Best-effort. */
  linkedIssue?: string | null;
  /** Changed files, header-only (hunks carry no body lines here). */
  files: IntentDiffFile[];
}

/**
 * Render each changed file's path plus its hunk headers, reconstructing the
 * unified-diff `@@ -oldStart,oldLines +newStart,newLines @@` header from the
 * `DiffHunk` fields. Hunk BODY lines are never included — this is the
 * "header-only" input the Intent Layer classifier is scoped to (cheap +
 * avoids leaking full code into a classifier call).
 */
export function formatFileList(files: IntentDiffFile[]): string {
  if (files.length === 0) return '(no changed files)';
  return files
    .map((f) => {
      const header = `${f.path} (+${f.additions}/-${f.deletions})`;
      const hunkLines = f.hunks.map(
        (h) => `  @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
      );
      return [header, ...hunkLines].join('\n');
    })
    .join('\n');
}

const SYSTEM_PROMPT =
  'You are a PR intent classifier. Given a pull request\'s title, description, ' +
  'optionally a linked issue/ticket, and its changed-file list (paths + hunk headers ' +
  'only, no code), classify WHY the PR was opened.\n\n' +
  'Produce:\n' +
  '- intent: a one-sentence summary of the PR\'s purpose.\n' +
  '- in_scope: short phrases naming the areas/concerns this PR is legitimately about.\n' +
  '- out_of_scope: short phrases naming adjacent areas/concerns this PR explicitly is ' +
  'NOT trying to address (used to keep a downstream code reviewer from nitpicking ' +
  'unrelated pre-existing issues).\n\n' +
  'BEST-EFFORT INFERENCE IS MANDATORY — you must NEVER refuse or return an empty ' +
  'result. When the description has no documentation, no ticket, no spec, and no ' +
  'linked issue, INFER the intent from implicit signals alone: the PR title, the set ' +
  'of changed file paths (their names and directories hint at the feature/module), ' +
  'and the hunk headers (which functions/regions moved). A plausible best guess is ' +
  'always better than refusing.\n\n' +
  'When a ticket, spec, or linked issue IS present in the input, treat it as a ' +
  'STRONGER signal than the title/files alone and let it drive the in_scope/' +
  'out_of_scope split.\n\n' +
  'Respond ONLY with the requested structured output.';

/**
 * Build the system + user message pair for the Intent Layer classifier call.
 * Graceful degradation (R2): works even when `body` and `linkedIssue` are
 * null/empty — the user message always includes the title and file list, so
 * the model always has enough to infer from.
 */
export function buildIntentPrompt(input: BuildIntentPromptInput): ChatMessage[] {
  const body = input.body && input.body.trim().length > 0 ? input.body.trim() : '(no description provided)';
  const linkedIssue =
    input.linkedIssue && input.linkedIssue.trim().length > 0
      ? input.linkedIssue.trim()
      : '(no linked issue found)';

  const user = [
    `## PR title\n${input.title}`,
    `## PR description\n${body}`,
    `## Linked issue\n${linkedIssue}`,
    `## Changed files (paths + hunk headers only)\n${formatFileList(input.files)}`,
  ].join('\n\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}
