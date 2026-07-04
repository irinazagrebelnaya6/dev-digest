import type { Container } from '../../platform/container.js';
import type { Risks, UnifiedDiff } from '@devdigest/shared';
import { buildRisksPrompt } from '@devdigest/reviewer-core';
import { Risks as RisksSchema } from '@devdigest/shared';
import type { RunLogger } from '../../platform/run-logger.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import * as schema from '../../db/schema.js';
import type { PullRow } from './repository.js';

/**
 * Hard cap on the raw diff chars fed to the risk-assessment prompt. `risk_brief`
 * is the CAPABLE model and already takes the diff WITH hunk bodies (unlike the
 * cheap Intent classifier, which is header-only) — bound it so a pathological
 * mega-PR diff can't blow the context window / cost budget. Chosen generously
 * (~roughly 50k tokens) since risk assessment needs to see real code.
 */
export const RISKS_DIFF_CHAR_CAP = 200_000;

/** Bound `diff` to `RISKS_DIFF_CHAR_CAP` chars, appending a truncation note. Pure/testable. */
export function capDiffForRisks(diff: string, cap = RISKS_DIFF_CHAR_CAP): string {
  if (diff.length <= cap) return diff;
  return `${diff.slice(0, cap)}\n\n… (diff truncated at ${cap} chars for risk assessment)`;
}

/**
 * Risk Areas — computes `{ risks: Risk[] }` for a PR via a structured LLM call
 * on the CAPABLE `risk_brief` model (default: openai/gpt-4.1, per-workspace
 * overridable via Settings → Models), then persists it into the shared
 * `pr_brief.json` partial-brief blob.
 *
 * Unlike the Intent Layer (header-only input), this feeds the diff WITH hunk
 * bodies — spotting an auth-surface change or a new dependency requires seeing
 * the actual code, not just hunk headers. Button-driven only (no auto-run
 * during a review) — it is pricier than Intent.
 */
export async function computeRisks(
  container: Container,
  workspaceId: string,
  pull: PullRow,
  repoRow: typeof schema.repos.$inferSelect,
  diff: UnifiedDiff,
  runLog?: RunLogger,
): Promise<Risks> {
  const { provider, model } = await resolveFeatureModel(container, workspaceId, 'risk_brief');
  const llm = await container.llm(provider);

  const messages = buildRisksPrompt({
    title: pull.title,
    body: pull.body,
    diff: capDiffForRisks(diff.raw),
  });

  const sessionId = `${repoRow.owner}/${repoRow.name}#${pull.number}:risks`;
  const result = await llm.completeStructured<Risks>({
    model,
    schema: RisksSchema,
    schemaName: 'Risks',
    messages,
    maxRetries: 1,
    sessionId,
  });

  await container.reviewRepo.upsertBrief(pull.id, { risks: result.data.risks });

  if (runLog) {
    const cost = container.priceBook.estimate(model, result.tokensIn, result.tokensOut);
    const costStr = cost != null ? `$${cost.toFixed(4)}` : 'n/a';
    runLog.tool(
      `Risk Areas (${provider}/${model}): ${result.tokensIn} in / ${result.tokensOut} out (${costStr}) — ` +
        `${result.data.risks.length} risk(s) found`,
      {
        provider,
        model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: cost,
      },
    );
  }

  return result.data;
}
