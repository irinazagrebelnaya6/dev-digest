import type { ChatMessage } from '@devdigest/shared';
import { wrapUntrusted } from './prompt.js';

/**
 * Onboarding Tour — narration prompt (SPEC-03).
 *
 * Builds the messages for the SINGLE structured LLM call that narrates a
 * five-section newcomer tour (`architecture`, `critical_paths`, `run_local`,
 * `reading_path`, `first_tasks`, AC-1) from deterministically-gathered,
 * zero-LLM repo facts (AC-2/AC-3). Pure (no DB/network/FS) like the rest of
 * reviewer-core — the caller (server) renders `onboarding.system.md` and
 * gathers `OnboardingFacts` from repo-intel + bounded clone reads, then calls
 * this function to assemble the two-message payload for `completeStructured`.
 *
 * Every repo-derived fact block is DATA, not instructions, and is wrapped via
 * `wrapUntrusted(...)` (AC-9) — mirroring the per-section wrapping pattern in
 * `assemblePrompt()` (prompt.ts). The passed-in `system` already carries the
 * template's own `<untrusted>…</untrusted>` security block (kept by the
 * onboarding.system.md edit), so this function does not duplicate it.
 */

/** A repo-relative file ranked by `pagerank * (1 + hotness)`, most central first (AC-4). */
export interface OnboardingRankedFileFact {
  /** Repo-relative path. */
  path: string;
  /** Rank score — higher is more central. Order (not the raw value) drives `reading_path`. */
  rank: number;
}

/** A high-signal file with a fact-derived one-line reason it matters (AC-7). */
export interface OnboardingCriticalPathFact {
  /** Repo-relative path — must be present in the gathered fact/tree file set (AC-15). */
  path: string;
  /** One-line "why it matters", derived from repo-intel — never invented. */
  reason: string;
}

/** A reachable HTTP endpoint discovered from the ranked/critical files. */
export interface OnboardingEndpointFact {
  method: string;
  path: string;
}

/** package.json-derived facts (D3) — only the fields needed to ground `run_local`/links. */
export interface OnboardingPackageJsonFact {
  name?: string | null;
  /** npm script name -> command, e.g. `{ dev: "next dev" }`. */
  scripts?: Record<string, string> | null;
  dependencies?: string[] | null;
}

/**
 * Repo facts gathered deterministically (zero LLM, AC-2) by the caller's
 * analyzer. This is the sole input the narration call is grounded against —
 * every claim in the generated tour must trace back to one of these fields.
 */
export interface OnboardingFacts {
  /** e.g. "acme/payments-api". */
  repoFullName: string;
  /** Default branch, e.g. "main" — used to build GitHub blob links. */
  defaultBranch: string;
  /** Short human-readable stack summary (languages/frameworks/services detected). */
  stack: string;
  /** Repo-relative file tree, newline-separated (bounded by the caller). */
  tree: string;
  /** Files ranked `pagerank * (1 + hotness)` DESC — drives `reading_path` order (AC-4). */
  rankedFiles: OnboardingRankedFileFact[];
  /** Highest-signal files with a fact-derived "why it matters" (AC-7). */
  criticalPaths: OnboardingCriticalPathFact[];
  /** Reachable HTTP endpoints, read-only fact (folded into architecture/critical_paths). */
  endpoints: OnboardingEndpointFact[];
  /** package.json facts when a package.json was found at the repo root; `null` otherwise. */
  packageJson: OnboardingPackageJsonFact | null;
  /** Detected compose file path (e.g. "docker-compose.yml"), or `null` (AC-8: no invented step). */
  composeFile: string | null;
  /** Whether a `.env.example` file exists at the repo root (AC-8). */
  hasEnvExample: boolean;
  /** File count backing the "generated from index of N files" header line. */
  fileCount: number;
}

export interface BuildOnboardingPromptInput {
  /**
   * The already-rendered `onboarding.system.md` template (the server renders
   * `{{sections}}`/`{{language}}`; this function never reads files).
   */
  system: string;
  /** Repo facts gathered zero-LLM by the caller (AC-2). */
  facts: OnboardingFacts;
}

function formatRankedFiles(files: OnboardingRankedFileFact[]): string {
  if (files.length === 0) return '(no ranked files)';
  return files.map((f, i) => `${i + 1}. ${f.path} (rank=${f.rank.toFixed(4)})`).join('\n');
}

function formatCriticalPaths(paths: OnboardingCriticalPathFact[]): string {
  if (paths.length === 0) return '(no critical paths detected)';
  return paths.map((p) => `- ${p.path} — ${p.reason}`).join('\n');
}

function formatEndpoints(endpoints: OnboardingEndpointFact[]): string {
  if (endpoints.length === 0) return '(no reachable endpoints detected)';
  return endpoints.map((e) => `- ${e.method.toUpperCase()} ${e.path}`).join('\n');
}

function formatPackageJson(pkg: OnboardingPackageJsonFact | null): string {
  if (!pkg) return '(no package.json found)';
  const lines: string[] = [];
  if (pkg.name) lines.push(`name: ${pkg.name}`);
  if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
    lines.push('scripts:');
    for (const [key, value] of Object.entries(pkg.scripts)) lines.push(`  ${key}: ${value}`);
  }
  if (pkg.dependencies && pkg.dependencies.length > 0) {
    lines.push(`dependencies: ${pkg.dependencies.join(', ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(package.json found but empty)';
}

function formatRunLocalConfig(facts: OnboardingFacts): string {
  return [
    `compose file: ${facts.composeFile ?? '(none detected)'}`,
    `.env.example present: ${facts.hasEnvExample ? 'yes' : 'no'}`,
  ].join('\n');
}

/**
 * Build the system + user message pair for the single Onboarding Tour
 * narration call (AC-3). `system` is passed through verbatim (AC-1 canonical
 * sections + `<untrusted>` guard + language live in the rendered template);
 * every repo-derived fact block is delimiter-wrapped as untrusted DATA
 * (AC-9) so embedded instructions in repo content cannot hijack the call.
 */
export function buildOnboardingPrompt(input: BuildOnboardingPromptInput): ChatMessage[] {
  const { system, facts } = input;

  const user = [
    `## Repo\n${facts.repoFullName} (default branch: ${facts.defaultBranch}, ${facts.fileCount} files indexed)`,
    `## Stack\n${wrapUntrusted('stack', facts.stack)}`,
    `## File tree\n${wrapUntrusted('tree', facts.tree)}`,
    `## Ranked files (most to least central — respect this order for reading_path)\n${wrapUntrusted(
      'ranked-files',
      formatRankedFiles(facts.rankedFiles),
    )}`,
    `## Critical paths\n${wrapUntrusted('critical-paths', formatCriticalPaths(facts.criticalPaths))}`,
    `## Reachable endpoints\n${wrapUntrusted('endpoints', formatEndpoints(facts.endpoints))}`,
    `## package.json facts\n${wrapUntrusted('package-json', formatPackageJson(facts.packageJson))}`,
    `## Local run config\n${wrapUntrusted('run-local-config', formatRunLocalConfig(facts))}`,
  ].join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
