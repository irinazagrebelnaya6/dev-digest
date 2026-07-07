import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { Container } from '../src/platform/container.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { currentWorkspace } from '../src/mcp/context.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * `ReviewService.reviewDiff` integration coverage — the pre-push CLI's core.
 * Proves the CLI entry point reuses the SAME engine + grounding gate as the PR
 * review, driven by a RAW working-tree diff (no PR row): the finding on a real
 * diff line survives grounding; the hallucinated one (line 999) is dropped.
 * Builds a Container directly (no Fastify app) with a mock OpenRouter provider —
 * the seed's three agents are all `openrouter` (DEFAULT_PROVIDER).
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

d('reviewDiff — local working-tree review (Testcontainers pg)', () => {
  let pg: PgFixture;
  let container: Container;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const mock = new MockLLMProvider('openrouter', { structured: REVIEW_FIXTURE });
    container = new Container(config(), pg.handle.db, {
      llm: { openai: mock, anthropic: mock, openrouter: mock },
    });
    const ws = await currentWorkspace(container);
    workspaceId = ws.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('reviews a raw diff with every enabled agent, grounding drops the phantom finding', async () => {
    const service = new ReviewService(container);
    const diff = parseUnifiedDiff(DIFF);

    const results = await service.reviewDiff(workspaceId, diff, { all: true });

    // Seed enables three agents (General/Security/Performance).
    expect(results.length).toBeGreaterThanOrEqual(1);

    for (const r of results) {
      expect(r.error).toBeUndefined();
      expect(r.review).not.toBeNull();
      // Grounding kept the real-line finding, dropped the line-999 phantom.
      const findings = r.review!.findings;
      expect(findings).toHaveLength(1);
      expect(findings[0]!.file).toBe('src/config.ts');
      expect(findings[0]!.start_line).toBe(11);
      expect(r.grounding).toBe('1/2 passed');
      expect(r.droppedCount).toBe(1);
      // CRITICAL finding blocks every non-'never' gate → at least one blocker.
      expect(r.blockers).toBeGreaterThanOrEqual(1);
    }
  });

  it('reviews with a single named agent when agentId is given', async () => {
    const service = new ReviewService(container);
    const diff = parseUnifiedDiff(DIFF);
    const all = await service.reviewDiff(workspaceId, diff, { all: true });
    const oneId = all[0]!.agent.id;

    const one = await service.reviewDiff(workspaceId, diff, { agentId: oneId });
    expect(one).toHaveLength(1);
    expect(one[0]!.agent.id).toBe(oneId);
  });
});
