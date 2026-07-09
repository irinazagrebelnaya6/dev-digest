/**
 * Smart Diff constants. Pure data — no imports, no logic. `classifyFile`
 * (smart-diff.ts) is driven entirely by these patterns so tuning risk
 * classification never touches classifier code.
 *
 * Matching is done against the LOWERCASED file path with `.includes()` /
 * `.endsWith()` — the codebase norm (no glob lib), same as repo-intel.
 */

/**
 * Boilerplate: generated/mechanical files a reviewer should skim, not read
 * line-by-line. Checked with the HIGHEST precedence — a lock file must never
 * be reclassified as wiring/core even if it also matches a wiring pattern.
 */
export const BOILERPLATE_PATTERNS = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'npm-shrinkwrap.json',
  '.lock',
  '/dist/',
  '/build/',
  '/.next/',
  '/out/',
  '/coverage/',
  '.snap',
  '/migrations/meta/',
] as const;

/**
 * Wiring: config, bootstrap, and plumbing that hooks the core logic into the
 * app — worth a quick look, but not where the business logic lives.
 */
export const WIRING_PATTERNS = [
  '.config.',
  'tsconfig',
  'drizzle.config',
  'next.config',
  'postcss.config',
  '/index.ts',
  '/index.tsx',
  'server.ts',
  'platform/container',
  '/migrations/',
  '.github/workflows/',
  'scripts/',
  '.env',
  'dockerfile',
  'docker-compose',
] as const;

/**
 * A PR above this many changed lines (additions + deletions) is flagged as
 * "too big" in `split_suggestion`, prompting a proposed split by role.
 */
export const SMART_DIFF_SPLIT_THRESHOLD_LINES = 400;
