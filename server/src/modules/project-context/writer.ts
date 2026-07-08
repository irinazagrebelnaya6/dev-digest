/**
 * Project Context Folder (SPEC-02) — write path.
 *
 * `writeContextDoc` (create-or-update), `uploadContextDoc` (create-only, same
 * guards) and `createContextFolder` (mkdir) mutate ONLY the repo clone's
 * working tree on disk — no git commit/push/PR (AC-9). All three share one
 * guard pipeline, applied in order:
 *
 *   1. fixtures-dir refusal (AC-12) — hard backstop, checked on the RESOLVED
 *      absolute target so a misconfigured `clonePath` still fails closed.
 *   2. path-shape validation (AC-6) — repo-relative, no leading "/", no ".."
 *      segment (mirrors the shared `ContextPaths` array refinement, applied
 *      here to a single `path` string since the write bodies carry one path
 *      each, not an array).
 *   3. traversal guard (AC-6) — `resolveWithinClone` (must resolve inside the
 *      clone root).
 *   4. in-root guard (AC-6) — `assertWithinConfiguredRoot` (must additionally
 *      lie under a configured `specs`/`docs`/`insights` root).
 *   5. `.md` whitelist (AC-7) — doc writes/uploads only, not folders.
 *   6. size cap + empty/whitespace + binary rejection (AC-8) — doc
 *      writes/uploads only.
 *   7. hash precondition (update) / collision guard (create) (AC-10/AC-13).
 *
 * Pure `node:fs` I/O, mirroring `reader.ts`/`resolver.ts`'s direct-fs style
 * (SPEC-01 does not use a DI adapter for this module).
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  CreateContextFolderBody,
  UploadContextDocBody,
  WriteContextDocBody,
} from '@devdigest/shared';
import { ConflictError, ValidationError } from '../../platform/errors.js';
import { looksBinary } from './reader.js';
import {
  MAX_DOC_BYTES,
  assertWithinConfiguredRoot,
  hashContent,
  isUnderFixturesDir,
  resolveWithinClone,
} from './resolver.js';

/** Result of a successful doc create/update/upload — enough to build a `ContextWriteResult`. */
export interface WrittenDoc {
  path: string;
  content: string;
  hash: string;
  badge: string;
}

/**
 * Validate a single write-target path against the same repo-relative, no-"..",
 * no-absolute rule the shared `ContextPaths` array schema enforces — applied
 * here to one `path` string (the write bodies carry a single target, not an
 * array). Throws `ValidationError`; never partially validates.
 */
function assertBoundaryPath(relPath: string): void {
  if (relPath.startsWith('/')) {
    throw new ValidationError('path must be repo-relative (no leading "/")');
  }
  if (relPath.split('/').includes('..')) {
    throw new ValidationError('path must not contain ".." segments');
  }
}

/** `.md`-only whitelist (AC-7). */
function assertMarkdownExtension(relPath: string): void {
  if (!relPath.toLowerCase().endsWith('.md')) {
    throw new ValidationError('only ".md" files can be created or edited here');
  }
}

/** 256 KB cap + reject empty/whitespace-only + reject binary/non-UTF-8 bytes (AC-8). */
function assertWritableContent(content: string): void {
  if (content.trim().length === 0) {
    throw new ValidationError('content must not be empty or whitespace-only');
  }
  const buf = Buffer.from(content, 'utf8');
  if (buf.byteLength > MAX_DOC_BYTES) {
    throw new ValidationError(`content exceeds the ${MAX_DOC_BYTES} byte cap`);
  }
  if (looksBinary(buf)) {
    throw new ValidationError('content looks binary — only text markdown is accepted');
  }
}

/**
 * Resolve + guard a target path within the clone: fixtures-dir refusal,
 * shape validation, traversal guard, in-root guard (AC-6/AC-12). Shared by
 * all three write operations. Returns the resolved absolute path.
 */
function resolveWriteTarget(clonePath: string, roots: readonly string[], relPath: string): string {
  if (isUnderFixturesDir(clonePath)) {
    throw new ValidationError('this repo clone resolves under the read-only fixtures directory — writes are refused');
  }
  assertBoundaryPath(relPath);
  const resolved = resolveWithinClone(clonePath, relPath);
  if (!resolved) throw new ValidationError('path escapes the repo clone');
  if (isUnderFixturesDir(resolved)) {
    throw new ValidationError('this write target resolves under the read-only fixtures directory — writes are refused');
  }
  if (!assertWithinConfiguredRoot(relPath, roots)) {
    throw new ValidationError('path must lie within a configured context root (e.g. specs/docs/insights)');
  }
  return resolved;
}

/** Nearest-ancestor root-name badge for a (validated, in-root) repo-relative path. */
function badgeForPath(relPath: string, roots: readonly string[]): string {
  const rootSet = new Set(roots);
  let badge = '';
  for (const seg of relPath.split('/')) {
    if (rootSet.has(seg)) badge = seg;
  }
  return badge;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    const st = await stat(absPath);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * Create-or-update one doc. `hash` present in `body` = update precondition
 * (must match the CURRENT on-disk content hash, recomputed fresh — never
 * trusted from the client — or a 409, AC-13); absent = create (a path
 * collision without `overwrite: true` is a 409, AC-10).
 */
export async function writeContextDoc(
  clonePath: string,
  roots: readonly string[],
  body: WriteContextDocBody,
): Promise<WrittenDoc> {
  const resolved = resolveWriteTarget(clonePath, roots, body.path);
  assertMarkdownExtension(body.path);
  assertWritableContent(body.content);

  const exists = await fileExists(resolved);
  if (body.hash) {
    if (!exists) throw new ConflictError('doc no longer exists at this path — reload and retry');
    const current = await readFile(resolved, 'utf8');
    if (hashContent(current) !== body.hash) {
      throw new ConflictError('content has changed since it was loaded — reload and retry');
    }
  } else if (exists && !body.overwrite) {
    throw new ConflictError('a doc already exists at this path');
  }

  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, body.content, 'utf8');
  return { path: body.path, content: body.content, hash: hashContent(body.content), badge: badgeForPath(body.path, roots) };
}

/**
 * Upload a new doc into the currently-displayed root. Create-only (no hash
 * precondition concept) — a path collision without `overwrite: true` is a
 * 409 (AC-10); same `.md`/size/binary guards as a manual write (AC-7/AC-8).
 */
export async function uploadContextDoc(
  clonePath: string,
  roots: readonly string[],
  body: UploadContextDocBody,
): Promise<WrittenDoc> {
  const resolved = resolveWriteTarget(clonePath, roots, body.path);
  assertMarkdownExtension(body.path);
  assertWritableContent(body.content);

  const exists = await fileExists(resolved);
  if (exists && !body.overwrite) {
    throw new ConflictError('a doc already exists at this path');
  }

  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, body.content, 'utf8');
  return { path: body.path, content: body.content, hash: hashContent(body.content), badge: badgeForPath(body.path, roots) };
}

/**
 * Create a subdirectory under a configured root inside the clone (AC-11).
 * Idempotent when the directory already exists; a FILE already occupying
 * the target path is a 409 (mkdir's `recursive: true` only tolerates an
 * existing directory, never a file).
 */
export async function createContextFolder(
  clonePath: string,
  roots: readonly string[],
  body: CreateContextFolderBody,
): Promise<void> {
  const resolved = resolveWriteTarget(clonePath, roots, body.path);

  try {
    await mkdir(resolved, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ConflictError('a file already exists at this path');
    }
    throw err;
  }
}
