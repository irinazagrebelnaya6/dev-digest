import type { Container } from '../../platform/container.js';
import type { BlastRadiusResponse } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { composeBlastRadius } from './blast.js';

export interface BlastOptions {
  /**
   * When true, make exactly ONE cheap-model call to write a one-paragraph
   * plain-English summary of the map. Off by default → the endpoint makes ZERO
   * LLM calls and reads only the repo-intel index.
   */
  summary?: boolean;
}

/**
 * Blast Radius service (L04). Resolves the PR (workspace-scoped), reads the
 * pre-built repo-intel index — changed symbols + callers via
 * `repoIntel.getBlastRadius`, and 2-level reachable endpoints via
 * `repoIntel.getReachableEndpoints` — then hands both to the pure
 * `composeBlastRadius`. No parsing, no LLM (unless `summary` is requested).
 */
export class BlastService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    // Reviews module convention: construct the repo locally as `this.repo`
    // rather than via a container getter (see reviews/service.ts).
    this.repo = new ReviewRepository(container.db);
  }

  async blastForPull(
    workspaceId: string,
    prId: string,
    opts: BlastOptions = {},
  ): Promise<BlastRadiusResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const paths = (await this.repo.getPrFiles(pull.id)).map((f) => f.path);

    // Two independent index reads — run them together.
    const [result, reachableEndpoints] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pull.repoId, paths),
      this.container.repoIntel.getReachableEndpoints(pull.repoId, paths),
    ]);

    const blast = composeBlastRadius(result, reachableEndpoints);

    // Optional, opt-in: one cheap-model paragraph. Never blocks the map — a
    // failed/absent LLM leaves `summary` empty.
    if (opts.summary && blast.changed_symbols.length > 0) {
      const summary = await this.explain(workspaceId, blast).catch(() => '');
      return { ...blast, summary };
    }
    return blast;
  }

  /** The single (optional) LLM call for the whole feature. Cheap tier. */
  private async explain(workspaceId: string, blast: BlastRadiusResponse): Promise<string> {
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      // Reuse the cheap "intent" tier (openrouter/deepseek) — no separate
      // feature-model entry needed for this opt-in nicety.
      'review_intent',
    );
    const llm = await this.container.llm(provider);
    const res = await llm.complete({
      model,
      maxTokens: 220,
      messages: [
        {
          role: 'system',
          content:
            'You are a code reviewer. In ONE short paragraph (no lists), explain the blast ' +
            'radius of a pull request to a reviewer: what changed, who depends on it, and which ' +
            'HTTP endpoints could be affected. Be concrete and concise.',
        },
        { role: 'user', content: blastFactsForPrompt(blast) },
      ],
    });
    return res.text.trim();
  }
}

/** Flatten the (already-computed) map into a compact prompt — no code, no diff. */
function blastFactsForPrompt(blast: BlastRadiusResponse): string {
  const symbols = blast.changed_symbols.map((s) => `${s.kind} ${s.name} (${s.file})`).join(', ');
  const downstream = blast.downstream
    .map(
      (d) =>
        `${d.symbol}: ${d.callers.length} caller(s)` +
        (d.endpoints_affected.length ? `, endpoints ${d.endpoints_affected.join(', ')}` : ''),
    )
    .join('; ');
  return [
    `Changed symbols: ${symbols || 'none'}.`,
    `Downstream: ${downstream || 'no known callers'}.`,
    `Reachable endpoints (≤2 import hops): ${blast.reachable_endpoints.join(', ') || 'none'}.`,
  ].join('\n');
}
