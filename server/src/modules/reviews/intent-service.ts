import type { Container } from '../../platform/container.js';
import type { Intent, UnifiedDiff } from '@devdigest/shared';
import { buildIntentPrompt, formatFileList } from '@devdigest/reviewer-core';
import { Intent as IntentSchema } from '@devdigest/shared';
import type { RunLogger } from '../../platform/run-logger.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import * as schema from '../../db/schema.js';
import type { PullRow } from './repository.js';

/** Extract a `#123` issue reference from a PR body (closes/fixes/resolves #N or bare #N). */
function extractIssueNumber(body: string | null | undefined): number | undefined {
  if (!body) return undefined;
  const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
  return m?.[1] ? Number(m[1]) : undefined;
}

/**
 * Best-effort linked-issue resolution: parses a `#123` reference out of the PR
 * body, then fetches its title+body via the GitHub adapter. ANY failure here
 * (no GITHUB_TOKEN configured, network error, issue not found, no reference in
 * the body) resolves to `undefined` — it must never fail the intent compute
 * (R2/AC3: graceful degradation).
 */
async function resolveLinkedIssueText(
  container: Container,
  repoRow: typeof schema.repos.$inferSelect,
  body: string | null | undefined,
  runLog?: RunLogger,
): Promise<string | undefined> {
  const issueNumber = extractIssueNumber(body);
  if (!issueNumber) return undefined;
  try {
    const github = await container.github();
    const issue = await github.getIssue({ owner: repoRow.owner, name: repoRow.name }, issueNumber);
    return `#${issue.number} ${issue.title}\n\n${issue.body ?? ''}`.trim();
  } catch (err) {
    // Swallow — never let a GitHub hiccup (missing token, rate limit, 404)
    // fail the whole intent compute. Title + body + files are enough (R2).
    runLog?.info(`intent: linked-issue #${issueNumber} fetch failed — ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Intent Layer — computes `{ intent, in_scope[], out_of_scope[] }` for a PR via
 * a cheap, structured LLM call (default: openrouter/deepseek-v4-flash, per-
 * workspace overridable via Settings → Models), then persists it.
 *
 * Shared by the run-executor pre-step (auto-computed once per review run) and
 * the standalone `POST /pulls/:id/intent` "Recompute" endpoint — no duplication.
 *
 * Input is header-only (file paths + hunk headers, no hunk bodies) — cheap by
 * design. When `runLog` is supplied, logs a `tool` event with the actual
 * call's tokens/cost AND an estimate of what the same call would have cost with
 * full hunk bodies, so the Live Log shows the savings (R8/AC4).
 */
export async function computeIntent(
  container: Container,
  workspaceId: string,
  pull: PullRow,
  repoRow: typeof schema.repos.$inferSelect,
  diff: UnifiedDiff,
  runLog?: RunLogger,
): Promise<Intent> {
  const { provider, model } = await resolveFeatureModel(container, workspaceId, 'review_intent');
  const llm = await container.llm(provider);

  const linkedIssue = await resolveLinkedIssueText(container, repoRow, pull.body, runLog);

  const messages = buildIntentPrompt({
    title: pull.title,
    body: pull.body,
    linkedIssue,
    files: diff.files,
  });

  const sessionId = `${repoRow.owner}/${repoRow.name}#${pull.number}:intent`;
  const result = await llm.completeStructured<Intent>({
    model,
    schema: IntentSchema,
    schemaName: 'Intent',
    messages,
    maxRetries: 1,
    sessionId,
  });

  await container.reviewRepo.upsertIntent(pull.id, result.data);

  if (runLog) {
    // Token-savings log: what this (header-only) call actually cost vs. what
    // the SAME classifier call would have cost had it included full hunk
    // bodies instead of just the header-only file list.
    const headerOnlyTokens = container.tokenizer.count(formatFileList(diff.files));
    const fullDiffTokens = container.tokenizer.count(diff.raw);
    const extraTokens = Math.max(0, fullDiffTokens - headerOnlyTokens);
    const fullDiffTokensIn = result.tokensIn + extraTokens;

    const actualCost = container.priceBook.estimate(model, result.tokensIn, result.tokensOut);
    const fullDiffCost = container.priceBook.estimate(model, fullDiffTokensIn, result.tokensOut);

    const costStr = actualCost != null ? `$${actualCost.toFixed(4)}` : 'n/a';
    const fullCostStr = fullDiffCost != null ? `$${fullDiffCost.toFixed(4)}` : 'n/a';
    const savedStr =
      actualCost != null && fullDiffCost != null ? `$${(fullDiffCost - actualCost).toFixed(4)}` : 'n/a';

    runLog.tool(
      `Intent classifier (${provider}/${model}): ${result.tokensIn} in / ${result.tokensOut} out (${costStr}) — ` +
        `full-diff input would have cost ~${fullCostStr} (${fullDiffTokensIn} tokens) — saved ~${savedStr}`,
      {
        provider,
        model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: actualCost,
        fullDiffTokensIn,
        fullDiffCostUsd: fullDiffCost,
      },
    );
  }

  return result.data;
}

/** Render a computed Intent into a compact human-readable block for the review prompt. */
export function formatIntentForPrompt(intent: Intent): string {
  const lines = [intent.intent, ''];
  if (intent.in_scope.length > 0) {
    lines.push('In scope:');
    lines.push(...intent.in_scope.map((s) => `- ${s}`));
    lines.push('');
  }
  if (intent.out_of_scope.length > 0) {
    lines.push('Out of scope:');
    lines.push(...intent.out_of_scope.map((s) => `- ${s}`));
  }
  return lines.join('\n').trim();
}
