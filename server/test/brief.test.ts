import { describe, it, expect } from 'vitest';
import type { Brief } from '@devdigest/shared';
import type { BriefFacts } from '@devdigest/reviewer-core';
import {
  clampRiskLevel,
  defaultRiskLevel,
  groundBrief,
  LARGE_DIFF_LINES_THRESHOLD,
  LARGE_CALLER_COUNT_THRESHOLD,
  LARGE_ENDPOINT_COUNT_THRESHOLD,
  TRIVIAL_DIFF_LINES_THRESHOLD,
} from '../src/modules/brief/ground.js';

/** Minimal, complete `BriefFacts` fixture — override only what a test needs. */
function baseFacts(overrides: Partial<BriefFacts> = {}): BriefFacts {
  return {
    pr: { title: 'Add rate limiting', body: null },
    intent: null,
    blast: {
      changed_symbols: [],
      downstream: [],
      reachable_endpoints: [],
      summary: '',
      degraded: false,
    },
    diffGroups: [],
    totalDiffLines: 0,
    linkedIssue: null,
    contextSpecs: [],
    allowedLinks: [],
    degradedNotes: [],
    ...overrides,
  };
}

const LARGE_FACTS = baseFacts({ totalDiffLines: LARGE_DIFF_LINES_THRESHOLD + 50 });

const LARGE_BY_CALLERS_FACTS = baseFacts({
  blast: {
    changed_symbols: [{ name: 'formatCents', file: 'src/lib/money.ts', kind: 'function' }],
    downstream: [
      {
        symbol: 'formatCents',
        callers: Array.from({ length: LARGE_CALLER_COUNT_THRESHOLD }, (_, i) => ({
          name: `caller${i}`,
          file: `src/api/f${i}.ts`,
          line: 1,
        })),
        endpoints_affected: [],
        crons_affected: [],
      },
    ],
    reachable_endpoints: [],
    summary: '',
    degraded: false,
  },
});

const LARGE_BY_ENDPOINTS_FACTS = baseFacts({
  blast: {
    changed_symbols: [],
    downstream: [],
    reachable_endpoints: Array.from({ length: LARGE_ENDPOINT_COUNT_THRESHOLD }, (_, i) => `GET /e${i}`),
    summary: '',
    degraded: false,
  },
});

const TRIVIAL_FACTS = baseFacts({ totalDiffLines: TRIVIAL_DIFF_LINES_THRESHOLD - 5 });

const NORMAL_FACTS = baseFacts({ totalDiffLines: LARGE_DIFF_LINES_THRESHOLD - 50 });

describe('brief/ground: clampRiskLevel (AC-4b)', () => {
  it('floors a large-magnitude fixture (big diff) with model "low" to "medium"', () => {
    expect(clampRiskLevel('low', LARGE_FACTS)).toBe('medium');
  });

  it('floors a large-magnitude fixture (many downstream callers) with model "low" to "medium"', () => {
    expect(clampRiskLevel('low', LARGE_BY_CALLERS_FACTS)).toBe('medium');
  });

  it('floors a large-magnitude fixture (many affected endpoints) with model "low" to "medium"', () => {
    expect(clampRiskLevel('low', LARGE_BY_ENDPOINTS_FACTS)).toBe('medium');
  });

  it('never lowers a large-magnitude fixture below the model’s own higher read', () => {
    expect(clampRiskLevel('high', LARGE_FACTS)).toBe('high');
    expect(clampRiskLevel('medium', LARGE_FACTS)).toBe('medium');
  });

  it('caps a trivial-magnitude fixture with model "high" to "medium"', () => {
    expect(clampRiskLevel('high', TRIVIAL_FACTS)).toBe('medium');
  });

  it('never raises a trivial-magnitude fixture above the model’s own lower read', () => {
    expect(clampRiskLevel('low', TRIVIAL_FACTS)).toBe('low');
    expect(clampRiskLevel('medium', TRIVIAL_FACTS)).toBe('medium');
  });

  it('passes the model’s read through untouched for a normal-magnitude fixture', () => {
    expect(clampRiskLevel('low', NORMAL_FACTS)).toBe('low');
    expect(clampRiskLevel('medium', NORMAL_FACTS)).toBe('medium');
    expect(clampRiskLevel('high', NORMAL_FACTS)).toBe('high');
  });
});

describe('brief/ground: defaultRiskLevel (AC-16 failure-path default)', () => {
  it('defaults to "medium" for a large-magnitude fixture', () => {
    expect(defaultRiskLevel(LARGE_FACTS)).toBe('medium');
  });

  it('defaults to "low" for a trivial-magnitude fixture', () => {
    expect(defaultRiskLevel(TRIVIAL_FACTS)).toBe('low');
  });

  it('defaults to "medium" for a normal-magnitude fixture', () => {
    expect(defaultRiskLevel(NORMAL_FACTS)).toBe('medium');
  });
});

describe('brief/ground: groundBrief (AC-4/AC-5)', () => {
  const facts = baseFacts({
    totalDiffLines: 20,
    allowedLinks: ['src/api/orders.ts', 'src/lib/money.ts', 'GET /orders'],
  });

  it('drops a fabricated risks[] link and keeps only allowed paths', () => {
    const generated: Brief = {
      what: 'x',
      why: 'y',
      risk_level: 'medium',
      risks: [
        { description: 'real', link: 'src/api/orders.ts' },
        { description: 'invented', link: 'src/not/a/real/file.ts' },
      ],
      review_focus: [],
    };
    const grounded = groundBrief(generated, facts);
    expect(grounded.risks).toEqual([{ description: 'real', link: 'src/api/orders.ts' }]);
  });

  it('drops a fabricated endpoint link from risks[] (not just file paths)', () => {
    const generated: Brief = {
      what: 'x',
      why: 'y',
      risk_level: 'medium',
      risks: [
        { description: 'real endpoint', link: 'GET /orders' },
        { description: 'invented endpoint', link: 'DELETE /invented' },
      ],
      review_focus: [],
    };
    const grounded = groundBrief(generated, facts);
    expect(grounded.risks).toEqual([{ description: 'real endpoint', link: 'GET /orders' }]);
  });

  it('preserves review_focus[] order after filtering out an invented link in the middle', () => {
    const generated: Brief = {
      what: 'x',
      why: 'y',
      risk_level: 'medium',
      risks: [],
      review_focus: [
        { label: 'first', link: 'src/lib/money.ts' },
        { label: 'invented', link: 'src/nope.ts' },
        { label: 'second', link: 'src/api/orders.ts' },
      ],
    };
    const grounded = groundBrief(generated, facts);
    expect(grounded.review_focus.map((f) => f.link)).toEqual(['src/lib/money.ts', 'src/api/orders.ts']);
  });

  it('applies the magnitude clamp to the returned risk_level and never carries over stale/degraded fields', () => {
    const generated: Brief = {
      what: 'x',
      why: 'y',
      risk_level: 'low',
      risks: [],
      review_focus: [],
      stale: true,
      generated_for_sha: 'stray-sha',
      degraded: true,
      reason: 'stray-reason',
    };
    const grounded = groundBrief(generated, LARGE_FACTS);
    expect(grounded.risk_level).toBe('medium'); // floored
    expect(grounded.stale).toBeUndefined();
    expect(grounded.generated_for_sha).toBeUndefined();
    expect(grounded.degraded).toBeUndefined();
    expect(grounded.reason).toBeUndefined();
  });
});
