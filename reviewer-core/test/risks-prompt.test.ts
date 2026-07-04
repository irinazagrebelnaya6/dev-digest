/**
 * Risk Areas prompt: diff-with-bodies input, controlled `kind` vocabulary,
 * `file:line` citation instruction, empty-`risks: []` rule, and graceful
 * degradation on a doc-less PR.
 */
import { describe, it, expect } from 'vitest';
import { buildRisksPrompt, RISK_KINDS } from '../src/risks-prompt.js';

const sampleDiff = [
  'diff --git a/src/middleware/ratelimit.ts b/src/middleware/ratelimit.ts',
  'index 1234567..89abcde 100644',
  '--- a/src/middleware/ratelimit.ts',
  '+++ b/src/middleware/ratelimit.ts',
  '@@ -10,2 +10,8 @@',
  '+import Redis from "ioredis";',
  '+const redis = new Redis(process.env.REDIS_URL);',
  '+export async function rateLimit(req) {',
  '+  const count = await redis.incr(req.ip);',
  '+  return count;',
  '+}',
].join('\n');

describe('RISK_KINDS', () => {
  it('is a small fixed controlled vocabulary', () => {
    expect(RISK_KINDS).toEqual(['auth', 'security', 'dependency', 'perf', 'data', 'other']);
  });
});

describe('buildRisksPrompt', () => {
  it('produces a system + user message pair for a rich PR (title + body + diff)', () => {
    const messages = buildRisksPrompt({
      title: 'Add rate limiting to public API',
      body: 'Adds a Redis-backed token-bucket rate limiter.',
      diff: sampleDiff,
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('Add rate limiting to public API');
    expect(messages[1]!.content).toContain('Adds a Redis-backed token-bucket rate limiter.');
    expect(messages[1]!.content).toContain('ioredis');
    expect(messages[1]!.content).toContain('src/middleware/ratelimit.ts');
  });

  it('mentions the controlled kind vocabulary in the system prompt', () => {
    const messages = buildRisksPrompt({ title: 'x', diff: sampleDiff });
    for (const kind of RISK_KINDS) {
      expect(messages[0]!.content).toContain(kind);
    }
  });

  it('instructs the model to cite concrete file:line references', () => {
    const messages = buildRisksPrompt({ title: 'x', diff: sampleDiff });
    expect(messages[0]!.content).toMatch(/file_refs/);
    expect(messages[0]!.content).toMatch(/path:line|path:startLine-endLine/);
  });

  it('instructs an empty risks array when there is no notable merge risk', () => {
    const messages = buildRisksPrompt({ title: 'x', diff: sampleDiff });
    expect(messages[0]!.content).toMatch(/"risks":\s*\[\]/);
    expect(messages[0]!.content).toMatch(/NEVER refuse/i);
  });

  it('frames merge risk, not a general PR summary', () => {
    const messages = buildRisksPrompt({ title: 'x', diff: sampleDiff });
    expect(messages[0]!.content).toMatch(/MERGE RISK/);
  });

  it('degrades gracefully when body is null (does not throw, still includes title+diff)', () => {
    const messages = buildRisksPrompt({ title: 'Update config', body: null, diff: sampleDiff });
    expect(messages).toHaveLength(2);
    expect(messages[1]!.content).toContain('Update config');
    expect(messages[1]!.content).toContain('(no description provided)');
    expect(messages[1]!.content).toContain('ioredis');
  });

  it('degrades gracefully with an empty-string body and an empty diff too', () => {
    const messages = buildRisksPrompt({ title: 'x', body: '', diff: '' });
    expect(messages).toHaveLength(2);
    expect(messages[1]!.content).toContain('(no description provided)');
    expect(messages[1]!.content).toContain('(empty diff)');
  });
});
