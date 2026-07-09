import { describe, it, expect } from 'vitest';
import { parseArgs, gitDiffArgs, formatResults } from '../src/mcp/cli.js';
import type { LocalAgentReview } from '../src/modules/reviews/service.js';

/** DB-free unit coverage for the CLI's pure helpers (arg parsing + rendering). */
describe('cli review — parseArgs', () => {
  it('defaults to the working mode and all agents', () => {
    const a = parseArgs(['review', '--mode', 'working']);
    expect(a.command).toBe('review');
    expect(a.mode).toBe('working');
    expect(a.agent).toBeUndefined();
    expect(a.json).toBe(false);
    expect(a.error).toBeUndefined();
  });

  it('accepts a bare invocation without the leading command token', () => {
    expect(parseArgs(['--mode', 'working']).command).toBe('review');
  });

  it('parses --agent, --json and the --flag=value form', () => {
    const a = parseArgs(['review', '--agent=abc', '--json', '--mode=working']);
    expect(a.agent).toBe('abc');
    expect(a.json).toBe(true);
    expect(a.mode).toBe('working');
  });

  it('rejects an unknown mode and unknown flags', () => {
    expect(parseArgs(['review', '--mode', 'nope']).error).toMatch(/--mode must be one of/);
    expect(parseArgs(['review', '--wat']).error).toMatch(/Unknown argument/);
  });

  it('surfaces --help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('cli review — gitDiffArgs', () => {
  it('maps working → git diff HEAD; other modes are reserved (null)', () => {
    expect(gitDiffArgs('working')).toEqual(['diff', 'HEAD']);
    expect(gitDiffArgs('staged')).toBeNull();
    expect(gitDiffArgs('branch')).toBeNull();
  });
});

describe('cli review — formatResults', () => {
  const base: LocalAgentReview = {
    agent: { id: 'a1', name: 'Security Reviewer', provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' },
    review: {
      verdict: 'request_changes',
      summary: 'x',
      score: 40,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded secret',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'A literal key is committed.',
          suggestion: 'Move to env var.',
          confidence: 0.9,
        },
      ],
    },
    grounding: '1/1 passed',
    droppedCount: 0,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.0012,
    blockers: 1,
  };

  it('renders agent header, verdict line, and the finding with file:line', () => {
    const out = formatResults([base]);
    expect(out).toContain('Security Reviewer');
    expect(out).toContain('openrouter/deepseek/deepseek-v4-flash');
    expect(out).toContain('request_changes');
    expect(out).toContain('CRITICAL');
    expect(out).toContain('src/config.ts:12');
    expect(out).toContain('Hardcoded secret');
    expect(out).toContain('Move to env var.');
  });

  it('renders a per-agent failure without throwing', () => {
    const failed: LocalAgentReview = {
      ...base,
      review: null,
      error: 'missing OpenRouter key',
      blockers: 0,
    };
    const out = formatResults([failed]);
    expect(out).toContain('failed:');
    expect(out).toContain('missing OpenRouter key');
  });
});
