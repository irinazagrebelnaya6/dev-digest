/**
 * Deterministic scorer — no model. Fraction of expected substrings present in the output.
 * Use as a cheap first tier: don't pay the judge for what a substring settles.
 *
 * An entry may be a single substring (must be present) or an array of alternatives (at least one
 * of them must be present) — e.g. ["mermaid" required, but ["flowchart", "graph"] rather than one
 * fixed keyword, since both are valid Mermaid diagram-type syntax and a specific model's choice
 * between them isn't the thing under test.
 */

export function patternMatch(output: string, expected: (string | string[])[]): number {
  if (expected.length === 0) return 1;
  const low = output.toLowerCase();
  const hit = (e: string) => low.includes(e.toLowerCase());
  const matched = expected.filter((e) => (Array.isArray(e) ? e.some(hit) : hit(e))).length;
  return matched / expected.length;
}
