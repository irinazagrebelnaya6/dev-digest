/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});

describe('assemblePrompt — ## PR intent & scope (Intent Layer)', () => {
  it('renders the section, untrusted-wrapped, after ## PR description and before ## Skills / rules', () => {
    const user = userOf({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
      intent: 'Adds rate limiting; in scope: api/*; out of scope: auth/*.',
      skills: ['skill body'],
    });
    expect(user).toContain('## PR intent & scope');
    expect(user).toContain('<untrusted source="intent">');
    expect(user).toContain('Adds rate limiting; in scope: api/*; out of scope: auth/*.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## PR intent & scope'));
    expect(user.indexOf('## PR intent & scope')).toBeLessThan(user.indexOf('## Skills / rules'));
  });

  it('omits the section when intent is undefined or blank', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR intent & scope');
    expect(userOf({ system: 'sys', diff: 'DIFF', intent: '   ' })).not.toContain(
      '## PR intent & scope',
    );
  });

  it('includes the out-of-scope scope rule in the system prompt (reaches the model unconditionally)', () => {
    const sys = systemOf({ system: 'sys', diff: 'DIFF' });
    expect(sys).toMatch(/in_scope areas/i);
    expect(sys).toMatch(/\[out-of-scope\]/);
    expect(sys).toMatch(/AT MOST ONE/);
  });
});

describe('assemblePrompt — chat message roles', () => {
  // Kills two mutants that survived Stryker (prompt.ts:140/141 `role: 'system'|'user'`
  // → `role: ''`): every existing test read `messages[0]`/`messages[1]` by POSITION and
  // asserted only their `content`, never the `role`. An empty/wrong role produces a
  // malformed chat request the provider rejects, so the roles are load-bearing and must
  // be pinned, not just the order.
  it('assigns role "system" to the first message and "user" to the second', () => {
    const { messages } = assemblePrompt({ system: 'AGENT-SYS', diff: 'DIFF' });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
  });
});
