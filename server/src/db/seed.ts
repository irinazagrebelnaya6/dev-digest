import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset). Each row carries a real unified-diff `patch` (the `@@`
    // hunks only — diffFromPrFiles prepends the git/---/+++ headers). Without a
    // patch, loadDiff falls back to an EMPTY diff, the reviewer sees nothing,
    // and every live run returns 0 findings / score 100. The config + users
    // patches deliberately contain the two seeded issues (hardcoded Stripe key,
    // N+1 loop) so a live security/perf review can ground findings on them.
    const ratelimitPatch = [
      '@@ -0,0 +1,18 @@',
      "+import type { Request, Response, NextFunction } from 'express';",
      '+',
      '+// In-memory token-bucket limiter for unauthenticated public routes.',
      '+const buckets = new Map<string, { tokens: number; updated: number }>();',
      '+const CAPACITY = 60;',
      '+const REFILL_PER_SEC = 1;',
      '+',
      '+export function rateLimit(req: Request, res: Response, next: NextFunction) {',
      "+  const key = req.ip ?? 'anon';",
      '+  const now = Date.now();',
      '+  const b = buckets.get(key) ?? { tokens: CAPACITY, updated: now };',
      '+  b.tokens = Math.min(CAPACITY, b.tokens + ((now - b.updated) / 1000) * REFILL_PER_SEC);',
      '+  b.updated = now;',
      "+  if (b.tokens < 1) return res.status(429).json({ error: 'rate_limited' });",
      '+  b.tokens -= 1;',
      '+  buckets.set(key, b);',
      '+  next();',
      '+}',
    ].join('\n');

    const webhooksPatch = [
      '@@ -1,8 +1,10 @@',
      " import { Router } from 'express';",
      "+import { rateLimit } from '../../middleware/ratelimit';",
      ' ',
      ' export const webhooks = Router();',
      ' ',
      "-webhooks.post('/stripe', async (req, res) => {",
      "+webhooks.post('/stripe', rateLimit, async (req, res) => {",
      '   const event = req.body;',
      '+  // TODO: verify Stripe signature before trusting the payload',
      '   res.sendStatus(200);',
      ' });',
    ].join('\n');

    const configPatch = [
      "@@ -6,4 +6,7 @@ import { z } from 'zod';",
      ' export const config = {',
      '   port: Number(process.env.PORT ?? 3000),',
      '   dbUrl: process.env.DATABASE_URL!,',
      '+  // Stripe billing integration (added for webhook signature checks)',
      // Fake demo secret: keeps the `sk_live_` prefix so the Security Reviewer
      // still grounds a "hardcoded key" finding, but the underscores break the
      // continuous alnum run so it does NOT match GitHub's Stripe-key push
      // protection (this is seeded fixture data, never a real credential).
      "+  stripeSecretKey: 'sk_live_EXAMPLE_do_not_use_fake_demo_key',",
      '+  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,',
      ' } as const;',
    ].join('\n');

    const usersPatch = [
      '@@ -42,5 +42,13 @@ export async function listUsers(req: Request, res: Response) {',
      '   const q = req.query.q as string | undefined;',
      "   const users = await db.query('SELECT id, email FROM users LIMIT 100');",
      ' ',
      '-  return res.json(users);',
      '+  // Enrich each user with their latest order (added alongside the limiter)',
      '+  const enriched = [];',
      '+  for (const u of users) {',
      "+    const orders = await db.query('SELECT * FROM orders WHERE user_id = $1', [u.id]);",
      "+    const profile = await db.query('SELECT * FROM profiles WHERE user_id = $1', [u.id]);",
      '+    enriched.push({ ...u, orders, latestProfile: profile[0] });',
      '+  }',
      '+',
      '+  return res.json(enriched);',
      ' }',
    ].join('\n');

    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 18, deletions: 0, patch: ratelimitPatch },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 3, deletions: 1, patch: webhooksPatch },
      { prId: pr!.id, path: 'src/config.ts', additions: 3, deletions: 0, patch: configPatch },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 9, deletions: 1, patch: usersPatch },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- prior PRs touching #482's files (Blast Radius "Prior PRs" history) ----
  // Each shares at least one path with #482 (src/api/public/webhooks.ts,
  // src/config.ts) so `priorPullsTouchingPaths` returns them. `body` becomes the
  // note line and `openedAt` the date in the timeline UI. Idempotent by number.
  const priorPrs: Array<{
    pr: typeof t.pullRequests.$inferInsert;
    files: string[];
  }> = [
    {
      pr: {
        workspaceId,
        repoId,
        number: 401,
        title: 'Introduce public API namespace',
        author: 'deepak.r',
        branch: 'feat/public-api-namespace',
        base: 'main',
        headSha: 'p401aa11bb22',
        status: 'merged',
        openedAt: new Date('2026-03-18T00:00:00Z'),
        body: 'Original `/api/public/*` split-out. Established the router this PR hooks into.',
      },
      files: ['src/api/public/webhooks.ts'],
    },
    {
      pr: {
        workspaceId,
        repoId,
        number: 356,
        title: 'Add ioredis client for session cache',
        author: 'marisa.koch',
        branch: 'feat/ioredis-session-cache',
        base: 'main',
        headSha: 'p356cc33dd44',
        status: 'merged',
        openedAt: new Date('2026-02-02T00:00:00Z'),
        body: 'Redis client already lives here — reuse `src/lib/redis.ts` instead of constructing a second connection.',
      },
      files: ['src/config.ts'],
    },
    {
      pr: {
        workspaceId,
        repoId,
        number: 288,
        title: 'Webhook forwarding for connect accounts',
        author: 'tomek.w',
        branch: 'feat/webhook-forwarding',
        base: 'main',
        headSha: 'p288ee55ff66',
        status: 'merged',
        openedAt: new Date('2025-12-11T00:00:00Z'),
        body: 'Last change to webhooks. SSRF concern was raised in review then but deferred — relevant to finding f2.',
      },
      files: ['src/api/public/webhooks.ts'],
    },
  ];
  for (const { pr: priorPr, files } of priorPrs) {
    const [existing] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, priorPr.number!)));
    if (existing) continue;
    const [row] = await db.insert(t.pullRequests).values(priorPr).returning();
    await db
      .insert(t.prFiles)
      .values(files.map((path) => ({ prId: row!.id, path, additions: 1, deletions: 0 })));
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- demo skills (A1, L02) ----
  const seedSkills: Array<typeof t.skills.$inferInsert & { _name: string }> = [
    {
      _name: 'Test Quality Reviewer',
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Audits test coverage, assertion quality, and flakiness risks in a diff.',
      type: 'rubric',
      source: 'manual',
      version: 1,
      enabled: true,
      body: `## Test Quality Rubric

### Coverage
- Every new public function must have at least one positive and one negative test.
- Deleted branches or conditions must have corresponding test removals — orphaned tests are noise.

### Assertions
- Each test must assert a **specific value or behaviour**, not just "no error thrown".
- Avoid \`expect(result).toBeTruthy()\` — use \`expect(result).toBe(42)\` or equivalent.

### Flakiness
- No \`setTimeout\` / \`sleep\` in test bodies. Use \`vi.useFakeTimers()\` or wait for a Promise.
- No global state mutations without teardown in \`afterEach\`.

### Expected output
\`\`\`
MISSING TEST — src/lib/parser.ts:34
  Function parseDate() added but has no unit test.
  Suggested file: src/lib/parser.test.ts
\`\`\``,
    },
    {
      _name: 'API Contract Reviewer',
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Flags breaking changes, schema drift, and semver violations in API diffs.',
      type: 'security',
      source: 'manual',
      version: 1,
      enabled: true,
      body: `## API Contract Reviewer

### Breaking changes
- Removed or renamed response fields are **always breaking** — flag with CRITICAL.
- Removed endpoints must return \`410 Gone\` with an upgrade hint instead of disappearing.
- Changing an HTTP method for the same path is breaking.

### New required params
- Adding a required field to a POST/PUT body without a default breaks existing callers.
- Fix: add \`.optional().default(value)\` or bump the major version.

### Semver discipline
- Patch: bug fix with no contract change.
- Minor: additive change (new optional field, new endpoint).
- Major: any breaking change listed above.

### Deprecation policy
- Fields to be removed must carry a \`@deprecated\` JSDoc comment for ≥1 minor version.
- The deprecation must appear in the changelog.

### Expected output
\`\`\`
BREAKING CHANGE — src/routes/users.ts:18
  Removed field \`userId\` from GET /users response.
  Callers reading userId will silently receive undefined.
  Fix: keep field + add accountId, deprecate userId in next minor.
\`\`\``,
    },
  ];

  for (const { _name, ...skill } of seedSkills) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, _name)));
    if (!existing) {
      const [row] = await db.insert(t.skills).values(skill).returning();
      // snapshot version 1
      await db.insert(t.skillVersions)
        .values({ skillId: row!.id, version: 1, body: skill.body })
        .onConflictDoNothing();
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
