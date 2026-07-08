/**
 * Project Context Folder (SPEC-01, Feature 1) — doc discovery walk.
 *
 * Recursively walks a repo clone and returns every `.md` file that lives
 * under a configured "root" folder (default `specs`/`docs`/`insights`, see
 * `platform/config.ts#contextRoots`) at ANY depth, tagged with a type badge
 * derived from the NEAREST ANCESTOR root folder (AC-17) — e.g. a file at
 * `docs/specs/foo.md` badges as `specs`, not `docs`.
 *
 * Mirrors `repo-intel/pipeline/walk.ts`'s shape (Dirent walk, skip symlinks,
 * skip unreadable dirs, forward-slash repo-relative paths) but is scoped to
 * markdown docs under the configured roots rather than source files anywhere.
 * Zero LLM calls — this is a pure filesystem read.
 */
import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** A discoverable project-context doc. */
export interface ContextDoc {
  /** Repo-relative path, forward-slash normalized (matches `pr_files.path` convention). */
  path: string;
  /** Type badge = the nearest-ancestor configured root folder name (AC-17). */
  badge: string;
}

const MD_EXT = '.md';
/** Bytes sniffed from the start of a file to heuristically detect binary content. */
const SNIFF_BYTES = 8000;
/**
 * Directories never walked — heavy/generated trees that never hold project
 * docs and would otherwise surface dependency markdown (e.g.
 * `node_modules/**​/docs/*.md`) and slow discovery to a crawl. Mirrors
 * `repo-intel/pipeline/walk.ts`'s EXCLUDED_DIRS (kept local to avoid a
 * cross-module import).
 */
const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
]);

/**
 * Heuristic binary sniff: a NUL byte in the first `SNIFF_BYTES` is a strong
 * signal the file isn't text, even though it carries a `.md` extension.
 * Exported so the run-time resolver (`resolver.ts`) can reuse the same rule
 * when reading attached docs (AC-9: skip unreadable/binary without failing).
 */
export function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, SNIFF_BYTES);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Discover every in-scope `.md` doc under `root` (a repo clone directory).
 * Returns docs sorted by path for a stable, reproducible listing.
 */
export async function discoverContextDocs(root: string, roots: string[]): Promise<ContextDoc[]> {
  const rootSet = new Set(roots);
  const out: ContextDoc[] = [];
  await walkDir(root, root, rootSet, undefined, out);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function walkDir(
  root: string,
  dir: string,
  roots: ReadonlySet<string>,
  badge: string | undefined,
  out: ContextDoc[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink target) — skip
    // cleanly so discovery keeps making progress on the readable parts.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks
    const name = entry.name;
    const full = join(dir, name);

    if (entry.isDirectory()) {
      // Never descend into heavy/generated trees — a dependency's own
      // `docs/`/`specs/` is not this project's context.
      if (EXCLUDED_DIRS.has(name)) continue;
      // Nearest-ancestor wins: entering a directory whose name matches a
      // configured root re-badges everything beneath it, even if an outer
      // ancestor already matched a (different) root.
      const nextBadge = roots.has(name) ? name : badge;
      await walkDir(root, full, roots, nextBadge, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (badge === undefined) continue; // not under any configured root — out of scope
    if (!name.toLowerCase().endsWith(MD_EXT)) continue;

    let buf: Buffer;
    try {
      buf = await readFile(full);
    } catch {
      continue; // unreadable — skip, never fail discovery
    }
    if (looksBinary(buf)) continue;

    const rel = relative(root, full).split(sep).join('/');
    out.push({ path: rel, badge });
  }
}
