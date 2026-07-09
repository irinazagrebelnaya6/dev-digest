import { describe, it, expect } from 'vitest';
import { capDiffForRisks, RISKS_DIFF_CHAR_CAP } from '../src/modules/reviews/risk-service.js';

describe('capDiffForRisks', () => {
  it('returns the diff unchanged when under the cap', () => {
    const diff = 'diff --git a/foo.ts b/foo.ts\n+ line';
    expect(capDiffForRisks(diff, 1000)).toBe(diff);
  });

  it('returns the diff unchanged when exactly at the cap', () => {
    const diff = 'x'.repeat(50);
    expect(capDiffForRisks(diff, 50)).toBe(diff);
  });

  it('truncates and appends a note when over the cap', () => {
    const diff = 'x'.repeat(100);
    const capped = capDiffForRisks(diff, 50);
    expect(capped.startsWith('x'.repeat(50))).toBe(true);
    expect(capped).toContain('truncated at 50 chars');
    expect(capped.length).toBeGreaterThan(50);
  });

  it('uses RISKS_DIFF_CHAR_CAP as the default cap', () => {
    const diff = 'y'.repeat(RISKS_DIFF_CHAR_CAP + 10);
    const capped = capDiffForRisks(diff);
    expect(capped.startsWith('y'.repeat(RISKS_DIFF_CHAR_CAP))).toBe(true);
    expect(capped).toContain(`truncated at ${RISKS_DIFF_CHAR_CAP} chars`);
  });
});
