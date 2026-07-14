/**
 * orderContextSpecs (SPEC-01, AC-14) — pure order/dedup over repo-relative
 * paths. Direct-before-inherited, dedup by normalized path with first
 * occurrence winning, intra-group order preserved.
 */
import { describe, it, expect } from 'vitest';
import { orderContextSpecs } from '../src/project-context.js';

describe('orderContextSpecs', () => {
  it('places direct paths before inherited paths', () => {
    const result = orderContextSpecs(['docs/a.md', 'docs/b.md'], ['specs/c.md']);
    expect(result).toEqual(['docs/a.md', 'docs/b.md', 'specs/c.md']);
  });

  it('dedups a path that appears in both groups, keeping the direct occurrence', () => {
    const result = orderContextSpecs(['docs/a.md'], ['docs/a.md', 'specs/c.md']);
    expect(result).toEqual(['docs/a.md', 'specs/c.md']);
  });

  it('preserves intra-group order for both direct and inherited', () => {
    const result = orderContextSpecs(
      ['docs/z.md', 'docs/a.md'],
      ['specs/y.md', 'specs/b.md'],
    );
    expect(result).toEqual(['docs/z.md', 'docs/a.md', 'specs/y.md', 'specs/b.md']);
  });

  it('dedups within a single group too, keeping the first occurrence', () => {
    const result = orderContextSpecs(['docs/a.md', 'docs/a.md'], ['docs/a.md']);
    expect(result).toEqual(['docs/a.md']);
  });

  it('dedups cosmetically different paths that normalize to the same key', () => {
    const result = orderContextSpecs(['./docs/a.md'], ['docs//a.md']);
    expect(result).toEqual(['./docs/a.md']);
  });

  it('returns an empty array for empty inputs', () => {
    expect(orderContextSpecs([], [])).toEqual([]);
  });

  it('handles one side empty', () => {
    expect(orderContextSpecs(['docs/a.md'], [])).toEqual(['docs/a.md']);
    expect(orderContextSpecs([], ['specs/c.md'])).toEqual(['specs/c.md']);
  });
});
