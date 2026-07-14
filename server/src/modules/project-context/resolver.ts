/**
 * Project Context Folder (SPEC-01, Feature 1) — run-time resolver.
 *
 * Gathers an agent's directly-attached + skill-inherited context-doc paths,
 * orders + dedups them via reviewer-core's pure `orderContextSpecs` (AC-14),
 * resolves each against the reviewed repo's clone with a traversal guard
 * (AC-15), reads the file, and counts its tokens. Zero LLM calls; never
 * throws — an unresolvable/unreadable/binary/escaping path is skipped and
 * logged via `runLog` instead of failing the run (AC-9).
 */
import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { orderContextSpecs } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { RunLogger } from '../../platform/run-logger.js';
import { EXCLUDED_DIRS, looksBinary } from './reader.js';

/**
 * Max bytes for a project-context doc, shared by the read/preview bound
 * (`readContextDoc`) and the write-path size guard (`writer.ts`, AC-8) so the
 * two caps can never drift apart.
 */
export const MAX_DOC_BYTES = 256 * 1024;

export interface ResolvedContext {
  /** Ordered, resolved file contents — pass straight through as `specs`. */
  specs: string[];
  /** Paths that were actually read, in the same order as `specs` (AC-8). */
  specsRead: string[];
  /** Per-doc token counts for the docs actually read (AC-8). */
  specsReadTokens: Array<{ path: string; tokens: number }>;
}

const EMPTY_RESULT: ResolvedContext = { specs: [], specsRead: [], specsReadTokens: [] };

/**
 * Resolve context docs for one agent's review. `direct` = the agent's own
 * `context_paths` (stored order); `inheritedGroups` = each ENABLED linked
 * skill's `context_paths` (stored order, in link order) — the caller passes
 * one array per skill so this function can flatten in the right order before
 * `orderContextSpecs` applies direct-first, first-occurrence-wins dedup.
 */
export async function resolveContextSpecs(
  container: Container,
  clonePath: string | null | undefined,
  direct: string[] | null | undefined,
  inheritedGroups: string[][],
  runLog: RunLogger,
): Promise<ResolvedContext> {
  const directPaths = direct ?? [];
  const inheritedPaths = inheritedGroups.flat();
  if (directPaths.length === 0 && inheritedPaths.length === 0) return EMPTY_RESULT;

  if (!clonePath) {
    runLog.info(
      `project context: ${directPaths.length + inheritedPaths.length} attached doc(s) skipped — repo has no clone`,
    );
    return EMPTY_RESULT;
  }

  const ordered = orderContextSpecs(directPaths, inheritedPaths);

  const specs: string[] = [];
  const specsRead: string[] = [];
  const specsReadTokens: Array<{ path: string; tokens: number }> = [];
  let skipped = 0;

  for (const relPath of ordered) {
    const resolved = resolveWithinClone(clonePath, relPath);
    if (!resolved) {
      runLog.info(`project context: skipped "${relPath}" — escapes the repo clone`);
      skipped++;
      continue;
    }

    let stat;
    try {
      stat = await lstat(resolved);
    } catch {
      runLog.info(`project context: skipped "${relPath}" — not found`);
      skipped++;
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      runLog.info(`project context: skipped "${relPath}" — not a regular file`);
      skipped++;
      continue;
    }

    let buf: Buffer;
    try {
      buf = await readFile(resolved);
    } catch (err) {
      runLog.info(`project context: skipped "${relPath}" — unreadable (${(err as Error).message})`);
      skipped++;
      continue;
    }
    if (looksBinary(buf)) {
      runLog.info(`project context: skipped "${relPath}" — binary content`);
      skipped++;
      continue;
    }

    const text = buf.toString('utf8');
    specs.push(text);
    specsRead.push(relPath);
    specsReadTokens.push({ path: relPath, tokens: container.tokenizer.count(text) });
  }

  if (specsRead.length > 0 || skipped > 0) {
    runLog.info(
      `project context: ${specsRead.length} doc(s) attached${skipped > 0 ? `, ${skipped} skipped` : ''}`,
    );
  }

  return { specs, specsRead, specsReadTokens };
}

/**
 * Refuse any path that resolves outside `clonePath` (AC-15/AC-6). Returns the
 * resolved absolute path, or `undefined` when it escapes / is absolute.
 * Defense-in-depth: the write boundary (`ContextPaths` zod schema) already
 * rejects absolute paths and `..` segments, but a stored path is untrusted
 * data by the time it reaches here. Exported so the write path (`writer.ts`)
 * reuses the exact same traversal guard as the run-time resolver + reader.
 */
export function resolveWithinClone(clonePath: string, relPath: string): string | undefined {
  if (isAbsolute(relPath)) return undefined;
  const root = resolvePath(clonePath);
  const resolved = resolvePath(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + sep)) return undefined;
  return resolved;
}

/**
 * In-root check (AC-6): a write target must not only resolve within the
 * clone (`resolveWithinClone`) but also lie under one of the configured
 * context roots (default `specs`/`docs`/`insights`, `platform/config.ts`).
 * Nearest-ancestor semantics don't matter here — any matching path segment
 * (at any depth) is sufficient, mirroring the reader's discovery scope.
 */
export function assertWithinConfiguredRoot(relPath: string, roots: readonly string[]): boolean {
  const segs = relPath.split('/');
  // Never accept a write into a directory the discovery walk skips
  // (node_modules/.git/dist/build/coverage/.next/out) — otherwise the write
  // "succeeds" but is invisible on the next read. Keeps the write and
  // discovery guards in lockstep.
  if (segs.some((seg) => EXCLUDED_DIRS.has(seg))) return false;
  const rootSet = new Set(roots);
  return segs.some((seg) => rootSet.has(seg));
}

/**
 * sha256 content hash (hex) used as an optimistic-concurrency precondition
 * (AC-13, ETag-style). Computed fresh from on-disk content at read AND
 * re-verify time — never trusted from the client.
 */
export function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Absolute path to the committed, read-only demo fixtures
 * (`server/src/db/fixtures`), resolved relative to this module so it works
 * regardless of process cwd.
 */
const FIXTURES_DIR = resolvePath(fileURLToPath(new URL('../../db/fixtures', import.meta.url)));

/**
 * Hard backstop for AC-12: refuse every write whose repo clone resolves
 * under the committed fixtures tree, even if a `clonePath` is misconfigured
 * to point there. Checked against the write's resolved absolute target
 * (not just `clonePath`) so it fails closed regardless of caller.
 */
export function isUnderFixturesDir(absPath: string): boolean {
  const resolved = resolvePath(absPath);
  return resolved === FIXTURES_DIR || resolved.startsWith(FIXTURES_DIR + sep);
}

/**
 * Read one discovered doc's body for the read/preview screen, traversal-safe.
 * Returns the text, or `null` when the path escapes the clone, isn't a regular
 * file, is binary, or exceeds `maxBytes` (bounds the screen payload). Never
 * throws — the screen degrades to "no preview" rather than failing.
 */
export async function readContextDoc(
  clonePath: string,
  relPath: string,
  maxBytes = MAX_DOC_BYTES,
): Promise<string | null> {
  const resolved = resolveWithinClone(clonePath, relPath);
  if (!resolved) return null;
  try {
    const stat = await lstat(resolved);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes) return null;
    const buf = await readFile(resolved);
    if (looksBinary(buf)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}
