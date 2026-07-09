import type { FastifyBaseLogger } from 'fastify';
import { Brief as BriefSchema, type Brief, type BriefResponse } from '@devdigest/shared';
import { buildBriefPrompt, type BriefFacts } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { PullRow } from '../../db/rows.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { ReviewRepository } from '../reviews/repository.js';
import { assembleSignals } from './assembler.js';
import { groundBrief, defaultRiskLevel } from './ground.js';

/**
 * Why + Risk Brief service (SPEC-04). Orchestrates the whole feature, mirroring
 * `OnboardingService`'s generate-on-first-view / regenerate / cache shape:
 *
 *   - `getOrGenerate` — serves the stored `brief` slice with ZERO model calls
 *     (AC-17-equivalent, AC-6), deriving `stale` at READ time by comparing the
 *     persisted `generated_for_sha` to the PR's current `head_sha` (D5/AC-14,
 *     never auto-regenerates); else generates + persists it.
 *   - `regenerate` — always makes exactly one fresh structured call (AC-7),
 *     overwriting the `brief` slice while leaving the pre-existing `risks`
 *     slice untouched (AC-12/AC-17, by construction of `upsertBrief`'s
 *     shallow merge).
 *
 * Both funnel through `generate()`: assemble facts (zero LLM, AC-1/AC-8) →
 * the SINGLE `completeStructured` call on the resolved `risk_brief` feature
 * model (D2/AC-2/AC-11) → ground + clamp (AC-4/AC-4b) → persist. A failed
 * call degrades to a deterministic minimal brief (AC-16), HTTP 200, never
 * persisted, never throws. When some (but not all) inputs were individually
 * degraded, the ONE call is still made — the assembled `degradedNotes` are
 * fed into the prompt so the model can be honest about it (AC-8) — and the
 * successful result is marked `degraded:true` with a `reason` summarizing
 * the missing signals, rather than silently pretending nothing was missing.
 */
export class BriefService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    // Reviews/blast/onboarding convention: construct the repo locally rather
    // than adding a container getter for a repository only this module needs.
    this.repo = new ReviewRepository(container.db);
  }

  /** Serves the stored brief untouched (0 calls) with a fresh `stale` read, else generates it. */
  async getOrGenerate(
    workspaceId: string,
    prId: string,
    log?: FastifyBaseLogger,
  ): Promise<BriefResponse> {
    const pull = await this.resolvePull(workspaceId, prId);
    const stored = await this.repo.getBrief(pull.id);
    if (stored?.brief) return this.serveStored(pull, stored.brief, stored.briefGeneratedAt);
    return this.generate(workspaceId, pull, log);
  }

  /** Forces a fresh brief: exactly one new call, overwrites the `brief` slice (AC-7). */
  async regenerate(
    workspaceId: string,
    prId: string,
    log?: FastifyBaseLogger,
  ): Promise<BriefResponse> {
    const pull = await this.resolvePull(workspaceId, prId);
    return this.generate(workspaceId, pull, log);
  }

  private async resolvePull(workspaceId: string, prId: string): Promise<PullRow> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  private serveStored(pull: PullRow, brief: Brief, generatedAt?: string): BriefResponse {
    const stale = Boolean(brief.generated_for_sha) && brief.generated_for_sha !== pull.headSha;
    return {
      brief: { ...brief, stale },
      generatedAt: generatedAt ?? new Date().toISOString(),
      stale,
    };
  }

  private async generate(
    workspaceId: string,
    pull: PullRow,
    log?: FastifyBaseLogger,
  ): Promise<BriefResponse> {
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const facts = await assembleSignals(this.container, workspaceId, pull, repo);
    const generatedAt = new Date().toISOString();

    try {
      const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
      const llm = await this.container.llm(provider);
      const messages = buildBriefPrompt(facts);

      const result = await llm.completeStructured<Brief>({
        model,
        schema: BriefSchema,
        schemaName: 'Brief',
        messages,
        maxRetries: 1,
        sessionId: `${repo.fullName}#${pull.number}:brief`,
      });

      const grounded = groundBrief(result.data, facts);
      const degraded = facts.degradedNotes.length > 0;
      const toPersist: Brief = {
        ...grounded,
        generated_for_sha: pull.headSha,
        degraded,
        reason: degraded ? facts.degradedNotes.join('; ') : null,
      };
      await this.repo.upsertBrief(pull.id, { brief: toPersist, briefGeneratedAt: generatedAt });

      const cost = this.container.priceBook.estimate(model, result.tokensIn, result.tokensOut);
      log?.info(
        {
          provider,
          model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costCents: cost != null ? cost * 100 : null,
        },
        `brief: generated Why+Risk Brief for ${repo.fullName}#${pull.number}`,
      );

      return { brief: { ...toPersist, stale: false }, generatedAt, stale: false };
    } catch (err) {
      // The single call failed (provider error, schema-validation exhaustion,
      // config/API-key error, etc). Log it, then degrade to a deterministic
      // minimal brief, HTTP 200, never persist a failed brief (AC-16) — a
      // later view/regenerate retries the real generation.
      log?.warn(
        { err },
        `brief: generation failed for ${repo.fullName}#${pull.number}, degrading to minimal brief`,
      );
      return { brief: this.failureBrief(facts), generatedAt, stale: false };
    }
  }

  private failureBrief(facts: BriefFacts): Brief {
    return {
      what: fallbackWhat(facts),
      why: fallbackWhy(facts),
      risk_level: defaultRiskLevel(facts),
      risks: [],
      review_focus: [],
      degraded: true,
      reason: 'generation_failed',
    };
  }
}

function fallbackWhat(facts: BriefFacts): string {
  if (facts.intent) return facts.intent.intent;
  const fileCount = facts.diffGroups.reduce((n, g) => n + g.files.length, 0);
  return facts.totalDiffLines > 0
    ? `Changes ${fileCount} file(s), ${facts.totalDiffLines} line(s) — brief generation failed, no PR intent available.`
    : 'Brief generation failed and no PR intent or diff stats are available.';
}

function fallbackWhy(facts: BriefFacts): string {
  if (facts.intent && facts.intent.in_scope.length > 0) {
    return `Likely scope (from stored intent): ${facts.intent.in_scope.join(', ')}.`;
  }
  if (facts.linkedIssue) {
    return `Possibly related to linked issue #${facts.linkedIssue.number}: ${facts.linkedIssue.title}.`;
  }
  return 'Insufficient signal to infer motivation — brief generation failed.';
}
