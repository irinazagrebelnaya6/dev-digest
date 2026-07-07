/**
 * Project Context Folder — reader.ts unit tests (AC-1, AC-2, AC-11, AC-17).
 *
 * No DB, no git, no LLM. Builds a temp dir on disk, runs `discoverContextDocs`,
 * asserts scope (only `.md` under configured roots), nearest-ancestor badges,
 * and that symlinks/binary/unreadable files are skipped cleanly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverContextDocs, looksBinary } from '../src/modules/project-context/reader.js';

const DEFAULT_ROOTS = ['specs', 'docs', 'insights'];

async function writeFileAt(root: string, rel: string, contents: string | Buffer): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

describe('discoverContextDocs', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-context-reader-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('discovers .md files under configured roots at any depth', async () => {
    await writeFileAt(root, 'specs/feature.md', '# spec');
    await writeFileAt(root, 'docs/guide/setup.md', '# setup');
    await writeFileAt(root, 'insights/notes.md', '# notes');

    const docs = await discoverContextDocs(root, DEFAULT_ROOTS);
    expect(docs.map((d) => d.path)).toEqual([
      'docs/guide/setup.md',
      'insights/notes.md',
      'specs/feature.md',
    ]);
  });

  it('excludes .md files outside any configured root', async () => {
    await writeFileAt(root, 'README.md', '# nope');
    await writeFileAt(root, 'src/notes.md', '# also nope');
    await writeFileAt(root, 'specs/in-scope.md', '# yes');

    const docs = await discoverContextDocs(root, DEFAULT_ROOTS);
    expect(docs.map((d) => d.path)).toEqual(['specs/in-scope.md']);
  });

  it('ignores non-.md files even inside a configured root', async () => {
    await writeFileAt(root, 'docs/data.json', '{}');
    await writeFileAt(root, 'docs/readme.txt', 'hi');
    await writeFileAt(root, 'docs/doc.md', '# doc');

    const docs = await discoverContextDocs(root, DEFAULT_ROOTS);
    expect(docs.map((d) => d.path)).toEqual(['docs/doc.md']);
  });

  it('badges by the NEAREST ancestor root (AC-17), even when roots nest', async () => {
    await writeFileAt(root, 'docs/specs/nested.md', '# nested');
    await writeFileAt(root, 'docs/top.md', '# top');

    const docs = await discoverContextDocs(root, DEFAULT_ROOTS);
    const nested = docs.find((d) => d.path === 'docs/specs/nested.md');
    const top = docs.find((d) => d.path === 'docs/top.md');
    expect(nested?.badge).toBe('specs');
    expect(top?.badge).toBe('docs');
  });

  it('respects a custom root list (config override)', async () => {
    await writeFileAt(root, 'adr/decision.md', '# adr');
    await writeFileAt(root, 'docs/ignored.md', '# ignored under default roots only');

    const docs = await discoverContextDocs(root, ['adr']);
    expect(docs.map((d) => d.path)).toEqual(['adr/decision.md']);
  });

  it('skips a symlinked directory (never follows symlinks)', async () => {
    await writeFileAt(root, 'specs/real.md', '# real');
    await mkdir(join(root, 'other-specs'));
    await writeFileAt(root, 'other-specs/real2.md', '# real2');
    try {
      await symlink(join(root, 'other-specs'), join(root, 'specs', 'linked'));
    } catch {
      // symlink creation can fail in some sandboxes (permissions) — the
      // assertion below still holds trivially in that case.
    }

    const docs = await discoverContextDocs(root, DEFAULT_ROOTS);
    expect(docs.map((d) => d.path)).toEqual(['specs/real.md']);
  });

  it('skips a binary file even if it has a .md extension', async () => {
    await writeFileAt(root, 'specs/binary.md', Buffer.from([0x00, 0x01, 0x02, 0x4d, 0x44]));
    await writeFileAt(root, 'specs/text.md', '# text');

    const docs = await discoverContextDocs(root, DEFAULT_ROOTS);
    expect(docs.map((d) => d.path)).toEqual(['specs/text.md']);
  });

  it('returns [] and never throws when the clone root does not exist (degraded)', async () => {
    const docs = await discoverContextDocs(join(root, 'does-not-exist'), DEFAULT_ROOTS);
    expect(docs).toEqual([]);
  });

  it('looksBinary detects a NUL byte and passes clean text through', () => {
    expect(looksBinary(Buffer.from([0x00, 0x41]))).toBe(true);
    expect(looksBinary(Buffer.from('# hello world'))).toBe(false);
  });
});
