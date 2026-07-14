/**
 * Project Context Folder (SPEC-02) — write-path API integration tests (real
 * PG via testcontainers). Covers AC-5..AC-13 + AC-16:
 *   - tenancy: cross-workspace repo write refused, nothing written (AC-5)
 *   - traversal + out-of-root path rejection (AC-6)
 *   - non-".md" extension rejection (AC-7)
 *   - oversized / empty content rejection (AC-8)
 *   - a valid write persists to the clone's working tree, no git action,
 *     visible on next read (AC-9)
 *   - create/upload collision -> 409 unless `overwrite: true` (AC-10)
 *   - folder create + a subsequently-created doc under it is discovered
 *     (AC-11)
 *   - fixtures-dir clone refusal + the seeded demo repo's writable clonePath
 *     (AC-12)
 *   - stale-hash 409 on update, fresh-hash success (AC-13)
 *   - structured AppError + correct status on every failure path (AC-16)
 *
 * These routes never call an LLM or git provider — `appNoLlm()` below builds
 * the app with NO overrides at all (mirrors `smart-diff.it.test.ts`), so an
 * accidental provider call would itself fail the suite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context-write] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** The committed, read-only demo fixtures — a write here must always be refused (AC-12). */
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/db/fixtures/project-context');

d('Project Context Folder — write API (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let tmpDirs: string[] = [];

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
    await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // No `overrides` at all — no llm/embedder/git mocks needed for these routes
  // (proof that no route accidentally touches an LLM or git provider).
  function appNoLlm() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  async function makeClone(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'project-context-write-it-'));
    tmpDirs.push(dir);
    return dir;
  }

  async function writeDoc(root: string, rel: string, body: string): Promise<void> {
    const full = join(root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  let repoSeq = 0;
  async function makeRepo(clonePath: string | null, ws = workspaceId): Promise<typeof t.repos.$inferSelect> {
    const name = `pc-write-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!;
  }

  // ---- AC-5: tenancy ---------------------------------------------------

  it('refuses a write to a repo outside the workspace with a structured AppError, no file written (AC-5, AC-16)', async () => {
    const app = await appNoLlm();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-pc-write-ws' }).returning();
    const clone = await makeClone();
    const foreignRepo = await makeRepo(clone, otherWs!.id);

    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${foreignRepo.id}/project-context/docs`,
      payload: { path: 'specs/new.md', content: '# hello' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBeDefined();
    expect(existsSync(join(clone, 'specs/new.md'))).toBe(false);

    await app.close();
  });

  // ---- AC-6: traversal + out-of-root -----------------------------------

  it('rejects a traversal path with a validation AppError, no file written (AC-6, AC-16)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    const repo = await makeRepo(clone);

    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: '../escape.md', content: '# hello' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBeTruthy();
    expect(existsSync(join(clone, '..', 'escape.md'))).toBe(false);

    await app.close();
  });

  it('rejects a path outside any configured context root, no file written (AC-6)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    const repo = await makeRepo(clone);

    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'README.md', content: '# hello' },
    });
    expect(res.statusCode).toBe(422);
    expect(existsSync(join(clone, 'README.md'))).toBe(false);

    await app.close();
  });

  // ---- AC-7: .md whitelist ---------------------------------------------

  it('rejects a non-".md" extension, no file written (AC-7)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    const repo = await makeRepo(clone);

    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/notes.txt', content: '# hello' },
    });
    expect(res.statusCode).toBe(422);
    expect(existsSync(join(clone, 'specs/notes.txt'))).toBe(false);

    await app.close();
  });

  // ---- AC-8: size cap + empty/whitespace + binary ----------------------

  it('rejects content over the 256 KB cap, no partial file persisted (AC-8)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    const repo = await makeRepo(clone);
    const big = 'a'.repeat(256 * 1024 + 1);

    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/big.md', content: big },
    });
    expect(res.statusCode).toBe(422);
    expect(existsSync(join(clone, 'specs/big.md'))).toBe(false);

    await app.close();
  });

  it('rejects empty/whitespace-only content (AC-8)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    const repo = await makeRepo(clone);

    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/empty.md', content: '   \n\t  ' },
    });
    expect(res.statusCode).toBe(422);
    expect(existsSync(join(clone, 'specs/empty.md'))).toBe(false);

    await app.close();
  });

  it('rejects binary content sniffed via a NUL byte (AC-8)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    const repo = await makeRepo(clone);

    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/binary.md', content: 'leading text' + '\u0000' + 'trailing text' },
    });
    expect(res.statusCode).toBe(422);
    expect(existsSync(join(clone, 'specs/binary.md'))).toBe(false);

    await app.close();
  });

  // ---- AC-9: valid write persists, visible on next read, no git ---------

  it('persists a valid write to the clone working tree with no git action; visible on next GET (AC-9)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    const repo = await makeRepo(clone);

    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/fresh.md', content: '# Fresh doc\n' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.doc.path).toBe('specs/fresh.md');
    expect(body.doc.content).toBe('# Fresh doc\n');
    expect(body.doc.hash).toBeTruthy();
    expect(existsSync(join(clone, '.git'))).toBe(false); // no git action taken

    const onDisk = await readFile(join(clone, 'specs/fresh.md'), 'utf8');
    expect(onDisk).toBe('# Fresh doc\n');

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/project-context` });
    const listed = listRes.json().docs.find((doc: { path: string }) => doc.path === 'specs/fresh.md');
    expect(listed).toBeTruthy();
    expect(listed.content).toBe('# Fresh doc\n');
    expect(listed.hash).toBe(body.doc.hash);

    await app.close();
  });

  // ---- AC-10: create/upload collision -> 409 unless overwrite -----------

  it('PUT create without a hash to an existing path returns 409 unless overwrite:true (AC-10, AC-16)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    await writeDoc(clone, 'specs/existing.md', 'ORIGINAL');
    const repo = await makeRepo(clone);

    const conflict = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/existing.md', content: 'CLOBBER' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBeTruthy();
    expect(await readFile(join(clone, 'specs/existing.md'), 'utf8')).toBe('ORIGINAL');

    const overwritten = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/existing.md', content: 'CLOBBER', overwrite: true },
    });
    expect(overwritten.statusCode).toBe(200);
    expect(await readFile(join(clone, 'specs/existing.md'), 'utf8')).toBe('CLOBBER');

    await app.close();
  });

  it('POST upload to an existing path returns 409 unless overwrite:true (AC-10)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    await writeDoc(clone, 'docs/upload-target.md', 'ORIGINAL');
    const repo = await makeRepo(clone);

    const conflict = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/project-context/uploads`,
      payload: { path: 'docs/upload-target.md', content: 'NEW' },
    });
    expect(conflict.statusCode).toBe(409);

    const overwritten = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/project-context/uploads`,
      payload: { path: 'docs/upload-target.md', content: 'NEW', overwrite: true },
    });
    expect(overwritten.statusCode).toBe(200);
    expect(await readFile(join(clone, 'docs/upload-target.md'), 'utf8')).toBe('NEW');

    await app.close();
  });

  it('POST upload also enforces the ".md" whitelist and the 256 KB cap (AC-7, AC-8, AC-10)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    const repo = await makeRepo(clone);

    const badExt = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/project-context/uploads`,
      payload: { path: 'docs/upload.png', content: 'not really an image' },
    });
    expect(badExt.statusCode).toBe(422);
    expect(existsSync(join(clone, 'docs/upload.png'))).toBe(false);

    const tooBig = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/project-context/uploads`,
      payload: { path: 'docs/too-big.md', content: 'a'.repeat(256 * 1024 + 1) },
    });
    expect(tooBig.statusCode).toBe(422);
    expect(existsSync(join(clone, 'docs/too-big.md'))).toBe(false);

    await app.close();
  });

  // ---- AC-11: folder create + discovery ---------------------------------

  it('creates a subdirectory under a configured root; a doc created under it is discovered (AC-11)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    const repo = await makeRepo(clone);

    const mk = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/project-context/folders`,
      payload: { path: 'specs/new-folder' },
    });
    expect(mk.statusCode).toBe(200);
    expect(mk.json()).toEqual({ ok: true });
    expect(existsSync(join(clone, 'specs/new-folder'))).toBe(true);

    const created = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/new-folder/inner.md', content: '# inner' },
    });
    expect(created.statusCode).toBe(200);

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/project-context` });
    const listed = listRes.json().docs.find((doc: { path: string }) => doc.path === 'specs/new-folder/inner.md');
    expect(listed).toBeTruthy();

    await app.close();
  });

  it('rejects an out-of-root / traversal folder create request (AC-6, AC-11)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    const repo = await makeRepo(clone);

    const outOfRoot = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/project-context/folders`,
      payload: { path: 'not-a-root/sub' },
    });
    expect(outOfRoot.statusCode).toBe(422);
    expect(existsSync(join(clone, 'not-a-root'))).toBe(false);

    const traversal = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/project-context/folders`,
      payload: { path: '../escape-folder' },
    });
    expect(traversal.statusCode).toBe(422);

    await app.close();
  });

  // ---- AC-12: fixtures-dir refusal + seed clonePath ----------------------

  it('refuses every write endpoint when the repo clonePath resolves under the committed fixtures dir, fixtures unchanged (AC-12)', async () => {
    const app = await appNoLlm();
    const repo = await makeRepo(FIXTURES_DIR);
    const untouchedBefore = await readFile(join(FIXTURES_DIR, '.devdigest/specs/public-api.md'), 'utf8');

    const write = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: '.devdigest/specs/public-api.md', content: 'CLOBBER' },
    });
    expect(write.statusCode).toBe(422);

    const upload = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/project-context/uploads`,
      payload: { path: '.devdigest/specs/new.md', content: '# new' },
    });
    expect(upload.statusCode).toBe(422);

    const folder = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/project-context/folders`,
      payload: { path: '.devdigest/specs/new-folder' },
    });
    expect(folder.statusCode).toBe(422);

    const untouchedAfter = await readFile(join(FIXTURES_DIR, '.devdigest/specs/public-api.md'), 'utf8');
    expect(untouchedAfter).toBe(untouchedBefore);
    expect(existsSync(join(FIXTURES_DIR, '.devdigest/specs/new.md'))).toBe(false);
    expect(existsSync(join(FIXTURES_DIR, '.devdigest/specs/new-folder'))).toBe(false);

    await app.close();
  });

  it('the seeded acme/payments-api repo clonePath is writable (not under the fixtures dir)', async () => {
    const app = await appNoLlm();
    const [demoRepo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    expect(demoRepo?.clonePath).toBeTruthy();
    expect(demoRepo!.clonePath!.startsWith(FIXTURES_DIR)).toBe(false);

    // `overwrite: true` + a fixed probe path keeps this test idempotent
    // across repeated runs against the real (non-tmp), persistent writable
    // demo clone dir on disk.
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${demoRepo!.id}/project-context/docs`,
      payload: { path: 'specs/write-probe.md', content: '# probe', overwrite: true },
    });
    expect(res.statusCode).toBe(200);

    await rm(join(demoRepo!.clonePath!, 'specs/write-probe.md'), { force: true });
    await app.close();
  });

  // ---- AC-13: stale-hash 409, fresh-hash success -------------------------

  it('rejects an update with a stale content hash (409), then succeeds with the fresh hash (AC-13)', async () => {
    const app = await appNoLlm();
    const clone = await makeClone();
    await writeDoc(clone, 'specs/versioned.md', 'v1');
    const repo = await makeRepo(clone);

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/project-context` });
    const originalHash = listRes
      .json()
      .docs.find((doc: { path: string }) => doc.path === 'specs/versioned.md').hash;
    expect(originalHash).toBeTruthy();

    // Someone else changes the file on disk after the hash was loaded.
    await writeFile(join(clone, 'specs/versioned.md'), 'v2 (changed on disk)');

    const stale = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/versioned.md', content: 'v3 (my edit)', hash: originalHash },
    });
    expect(stale.statusCode).toBe(409);
    expect(await readFile(join(clone, 'specs/versioned.md'), 'utf8')).toBe('v2 (changed on disk)');

    const freshRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/project-context` });
    const freshHash = freshRes
      .json()
      .docs.find((doc: { path: string }) => doc.path === 'specs/versioned.md').hash;

    const success = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/versioned.md', content: 'v3 (my edit)', hash: freshHash },
    });
    expect(success.statusCode).toBe(200);
    expect(await readFile(join(clone, 'specs/versioned.md'), 'utf8')).toBe('v3 (my edit)');

    await app.close();
  });

  it('an update hash against a doc with no clone at all fails with a validation AppError, not a 500 (AC-16, AC-17)', async () => {
    const app = await appNoLlm();
    const repo = await makeRepo(null);

    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/project-context/docs`,
      payload: { path: 'specs/x.md', content: '# x' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.json().error).toBeDefined();

    await app.close();
  });
});
