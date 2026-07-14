import type { Container } from '../../platform/container.js';
import type { RepoRow } from '../repos/repository.js';
import type {
  OnboardingCriticalPathFact,
  OnboardingEndpointFact,
  OnboardingFacts,
  OnboardingPackageJsonFact,
  OnboardingRankedFileFact,
} from '@devdigest/reviewer-core';
import {
  COMPOSE_FILE_CANDIDATES,
  ENV_EXAMPLE_PATH,
  MAX_CRITICAL_PATH_FACTS,
  PACKAGE_JSON_PATH,
  READING_PATH_SIZE,
} from './constants.js';

/**
 * Fact-gathering (SPEC-03, AC-2). Builds `OnboardingFacts` deterministically —
 * ZERO LLM calls — from two sources only:
 *   1. the repo-intel facade (`getIndexState`/`getTopFilesByRank`/`getFileRank`/
 *      `getCriticalPaths`/`getReachableEndpoints`/`getRepoMap`) — pure index
 *      reads, degrade to `[]`/empty when the index isn't usable;
 *   2. a BOUNDED set of known root config files read via `container.git.readFile`
 *      (`package.json`, a `docker-compose*.yml`/`compose.yml` candidate,
 *      `.env.example`) — NEVER an arbitrary source-file body (AC-6 holds by
 *      construction: the candidate list below is the entire clone-read surface).
 */

export interface GatherFactsResult {
  facts: OnboardingFacts;
  /** True when the repo-intel index isn't usable — caller falls back to the skeleton (AC-5). */
  degraded: boolean;
}

export async function gatherFacts(container: Container, repo: RepoRow): Promise<GatherFactsResult> {
  const state = await container.repoIntel.getIndexState(repo.id);
  const degraded = state.degraded === true;

  const topFiles = await container.repoIntel.getTopFilesByRank(repo.id, READING_PATH_SIZE);

  const [criticalChains, reachableEndpoints, repoMap] = await Promise.all([
    container.repoIntel.getCriticalPaths(repo.id),
    container.repoIntel.getReachableEndpoints(repo.id, topFiles),
    container.repoIntel.getRepoMap(repo.id),
  ]);

  const criticalPaths = buildCriticalPathFacts(criticalChains);
  const endpoints = parseEndpoints(reachableEndpoints);

  // Percentiles for the FULL set of paths the tour can reference (topFiles ∪
  // criticalPaths) — not just topFiles — so `ground.ts` can grade the
  // complexity of a first-task link that came from a critical-path chain hop
  // beyond the top-N reading-path files (real import-graph signal, AC-2).
  const percentilePaths = Array.from(new Set([...topFiles, ...criticalPaths.map((c) => c.path)]));
  const fileRanks = await container.repoIntel.getFileRank(repo.id, percentilePaths);
  const percentileByPath = new Map(fileRanks.map((r) => [r.path, r.percentile]));
  const rankedFiles: OnboardingRankedFileFact[] = topFiles.map((path) => ({
    path,
    rank: percentileByPath.get(path) ?? 0,
  }));
  const filePercentiles: Record<string, number> = {};
  for (const [path, percentile] of percentileByPath) filePercentiles[path] = percentile;

  const ref = { owner: repo.owner, name: repo.name };
  const packageJsonRaw = await readOptionalFile(container, ref, PACKAGE_JSON_PATH);
  const packageJson = parsePackageJson(packageJsonRaw);

  const composeFile = await detectComposeFile(container, ref);
  const hasEnvExample = (await readOptionalFile(container, ref, ENV_EXAMPLE_PATH)) !== null;

  const treePaths = Array.from(new Set([...topFiles, ...criticalPaths.map((c) => c.path)])).sort();
  const tree =
    !repoMap.degraded && repoMap.text
      ? repoMap.text
      : treePaths.length > 0
        ? treePaths.join('\n')
        : '(no files indexed)';

  const stack = deriveStack(packageJson, composeFile, hasEnvExample);

  const facts: OnboardingFacts = {
    repoFullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    stack,
    tree,
    rankedFiles,
    criticalPaths,
    endpoints,
    packageJson,
    composeFile,
    hasEnvExample,
    fileCount: state.filesIndexed,
    filePercentiles,
  };

  return { facts, degraded };
}

/**
 * Flattens `getCriticalPaths`' dependency chains into fact rows, deduped by
 * path (first occurrence wins), each with a fact-derived (never invented)
 * "why it matters" reason describing its position in the chain (AC-7).
 */
function buildCriticalPathFacts(chains: string[][]): OnboardingCriticalPathFact[] {
  const seen = new Set<string>();
  const out: OnboardingCriticalPathFact[] = [];
  for (const chain of chains) {
    for (let i = 0; i < chain.length; i++) {
      const path = chain[i]!;
      if (seen.has(path)) continue;
      seen.add(path);
      const reason =
        i === 0
          ? `Top-ranked import root — head of a ${chain.length}-file critical dependency chain.`
          : `Imported by ${chain[i - 1]}, ${i} hop(s) from the top-ranked file ${chain[0]}.`;
      out.push({ path, reason });
      if (out.length >= MAX_CRITICAL_PATH_FACTS) return out;
    }
  }
  return out;
}

/** `["GET /path", ...]` (repo-intel's flat endpoint strings) -> `{method, path}`. */
function parseEndpoints(raw: string[]): OnboardingEndpointFact[] {
  const out: OnboardingEndpointFact[] = [];
  for (const entry of raw) {
    const spaceIdx = entry.indexOf(' ');
    if (spaceIdx <= 0) continue;
    out.push({ method: entry.slice(0, spaceIdx), path: entry.slice(spaceIdx + 1) });
  }
  return out;
}

/** Reads one bounded root file; `null` on any error (missing file, no clone, etc). Never throws. */
async function readOptionalFile(
  container: Container,
  ref: { owner: string; name: string },
  path: string,
): Promise<string | null> {
  try {
    return await container.git.readFile(ref, path);
  } catch {
    return null;
  }
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parsePackageJson(raw: string | null): OnboardingPackageJsonFact | null {
  if (!raw) return null;
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const scripts = isStringRecord(json.scripts) ? json.scripts : null;
    const deps = isStringRecord(json.dependencies) ? Object.keys(json.dependencies) : [];
    const devDeps = isStringRecord(json.devDependencies) ? Object.keys(json.devDependencies) : [];
    const dependencies = [...new Set([...deps, ...devDeps])].sort();
    return {
      name: typeof json.name === 'string' ? json.name : null,
      scripts,
      dependencies: dependencies.length > 0 ? dependencies : null,
    };
  } catch {
    // Malformed/absent package.json — degrade to "no package.json facts",
    // never throw (fact-gathering must never fail the whole request).
    return null;
  }
}

/** Tries each compose-file candidate in order; returns the first that exists, else null. */
async function detectComposeFile(
  container: Container,
  ref: { owner: string; name: string },
): Promise<string | null> {
  for (const candidate of COMPOSE_FILE_CANDIDATES) {
    const content = await readOptionalFile(container, ref, candidate);
    if (content !== null) return candidate;
  }
  return null;
}

/** Short, fact-derived stack summary — never invents a framework/language it can't see. */
function deriveStack(
  pkg: OnboardingPackageJsonFact | null,
  composeFile: string | null,
  hasEnvExample: boolean,
): string {
  const bits: string[] = [];
  if (pkg) {
    bits.push(`Node.js project${pkg.name ? ` "${pkg.name}"` : ''}`);
    if (pkg.dependencies && pkg.dependencies.length > 0) {
      bits.push(`key dependencies: ${pkg.dependencies.slice(0, 8).join(', ')}`);
    }
  } else {
    bits.push('No package.json detected at the repo root');
  }
  if (composeFile) bits.push(`Docker Compose stack (${composeFile})`);
  if (hasEnvExample) bits.push('environment configured via .env (see .env.example)');
  return bits.join('; ');
}
