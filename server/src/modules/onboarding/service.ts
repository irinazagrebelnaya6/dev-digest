import type { FastifyBaseLogger } from 'fastify';
import { Onboarding as OnboardingSchema, type Onboarding, type OnboardingResponse } from '@devdigest/shared';
import { buildOnboardingPrompt } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { renderPrompt } from '../../platform/prompts.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { RepoRepository, type RepoRow } from '../repos/repository.js';
import { gatherFacts } from './analyzer.js';
import { buildSkeleton } from './skeleton.js';
import { groundOnboarding } from './ground.js';
import { ONBOARDING_SECTION_ORDER } from './constants.js';

const ONBOARDING_PROMPT_TEMPLATE = 'onboarding.system.md';

/**
 * Onboarding Tour service (SPEC-03). Orchestrates the whole feature:
 *   - `getOrGenerate` — generate-on-first-view (AC-14), served from the
 *     `onboarding` table with ZERO model calls on every later view (AC-17).
 *   - `regenerate` — always makes exactly one fresh structured call (AC-3).
 * Both funnel through `generate()`, which gathers facts (zero LLM, AC-2),
 * degrades to the deterministic skeleton on an unusable index OR a failed
 * LLM call (AC-5, HTTP 200, never throws), and otherwise makes the SINGLE
 * structured `completeStructured` call, grounds it, and persists only on
 * success (never caches a degraded/failed tour).
 */
export class OnboardingService {
  private repos: RepoRepository;

  constructor(private container: Container) {
    // Reviews/blast/project-context convention: construct a plain, stateless
    // cross-module repository locally rather than adding a container getter
    // for a repository only this (read) module needs.
    this.repos = new RepoRepository(container.db);
  }

  /** Serves the stored tour untouched (0 calls), else generates + persists it (AC-14/AC-17). */
  async getOrGenerate(
    workspaceId: string,
    repoId: string,
    log?: FastifyBaseLogger,
  ): Promise<OnboardingResponse> {
    const repo = await this.resolveRepo(workspaceId, repoId);

    const stored = await this.container.onboardingRepo.getByRepoId(repo.id);
    if (stored) {
      const state = await this.container.repoIntel.getIndexState(repo.id);
      return {
        tour: stored.json as Onboarding,
        generatedAt: stored.generatedAt.toISOString(),
        degraded: false,
        reason: null,
        fileCount: state.filesIndexed,
      };
    }

    return this.generate(workspaceId, repo, log);
  }

  /** Forces a fresh tour: exactly one new call, advances `generatedAt` (AC-3/AC-17). */
  async regenerate(
    workspaceId: string,
    repoId: string,
    log?: FastifyBaseLogger,
  ): Promise<OnboardingResponse> {
    const repo = await this.resolveRepo(workspaceId, repoId);
    return this.generate(workspaceId, repo, log);
  }

  private async resolveRepo(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  private async generate(
    workspaceId: string,
    repo: RepoRow,
    log?: FastifyBaseLogger,
  ): Promise<OnboardingResponse> {
    const { facts, degraded } = await gatherFacts(this.container, repo);

    if (degraded) {
      return {
        tour: buildSkeleton(facts),
        generatedAt: new Date().toISOString(),
        degraded: true,
        reason: 'index_degraded',
        fileCount: facts.fileCount,
      };
    }

    try {
      const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');
      const llm = await this.container.llm(provider);
      const system = await renderPrompt(ONBOARDING_PROMPT_TEMPLATE, { language: 'English' });
      const messages = buildOnboardingPrompt({ system, facts });

      const result = await llm.completeStructured<Onboarding>({
        model,
        schema: OnboardingSchema,
        schemaName: 'Onboarding',
        messages,
        maxRetries: 1,
        sessionId: `${repo.fullName}:onboarding`,
      });

      const grounded = groundOnboarding(result.data, facts);
      const row = await this.container.onboardingRepo.upsert(repo.id, grounded);

      const cost = this.container.priceBook.estimate(model, result.tokensIn, result.tokensOut);
      log?.info(
        {
          provider,
          model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costCents: cost != null ? cost * 100 : null,
        },
        `onboarding: generated tour for ${repo.fullName} (${ONBOARDING_SECTION_ORDER.length} sections)`,
      );

      return {
        tour: grounded,
        generatedAt: row.generatedAt.toISOString(),
        degraded: false,
        reason: null,
        fileCount: facts.fileCount,
      };
    } catch {
      // The single call failed (provider error, schema-validation exhaustion,
      // etc). Degrade to the skeleton, HTTP 200, never persist a bad tour
      // (AC-5) — a later view/regenerate retries the real generation.
      return {
        tour: buildSkeleton(facts),
        generatedAt: new Date().toISOString(),
        degraded: true,
        reason: 'generation_failed',
        fileCount: facts.fileCount,
      };
    }
  }
}
