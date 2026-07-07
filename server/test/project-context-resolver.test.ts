/**
 * Project Context Folder — resolver.ts unit tests (AC-9, AC-14, AC-15).
 *
 * No DB, no LLM. Builds a temp "clone" dir on disk, constructs a real
 * `RunLogger` (in-memory `RunBus`, no network) and a minimal fake `Container`
 * exposing only `tokenizer` (established test-double pattern in this suite —
 * see agents-versions.it.test.ts / indexer-pipeline.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveContextSpecs } from '../src/modules/project-context/resolver.js';
import { RunLogger } from '../src/platform/run-logger.js';
import { RunBus } from '../src/platform/sse.js';
import type { Container } from '../src/platform/container.js';

/** Counts characters ÷ 4 (rounded up) — deterministic, no real tiktoken needed. */
const fakeContainer = {
  tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
} as unknown as Container;

function makeLogger(): RunLogger {
  return new RunLogger(new RunBus(), ['test-run']);
}

async function writeFileAt(root: string, rel: string, contents: string | Buffer): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

describe('resolveContextSpecs', () => {
  let clone: string;

  beforeEach(async () => {
    clone = await mkdtemp(join(tmpdir(), 'project-context-resolver-'));
  });
  afterEach(async () => {
    await rm(clone, { recursive: true, force: true });
  });

  it('returns an empty result (no fs access needed) when nothing is attached', async () => {
    const result = await resolveContextSpecs(fakeContainer, clone, [], [], makeLogger());
    expect(result).toEqual({ specs: [], specsRead: [], specsReadTokens: [] });
  });

  it('skips everything (without throwing) when the repo has no clone', async () => {
    const result = await resolveContextSpecs(fakeContainer, null, ['specs/a.md'], [], makeLogger());
    expect(result).toEqual({ specs: [], specsRead: [], specsReadTokens: [] });
  });

  it('reads direct + skill-inherited docs, direct-first, in stored order (AC-14)', async () => {
    await writeFileAt(clone, 'specs/direct.md', '# direct');
    await writeFileAt(clone, 'docs/inherited.md', '# inherited');

    const result = await resolveContextSpecs(
      fakeContainer,
      clone,
      ['specs/direct.md'],
      [['docs/inherited.md']],
      makeLogger(),
    );
    expect(result.specsRead).toEqual(['specs/direct.md', 'docs/inherited.md']);
    expect(result.specs).toEqual(['# direct', '# inherited']);
    expect(result.specsReadTokens).toEqual([
      { path: 'specs/direct.md', tokens: Math.ceil('# direct'.length / 4) },
      { path: 'docs/inherited.md', tokens: Math.ceil('# inherited'.length / 4) },
    ]);
  });

  it('dedups a path attached both directly and via a skill (first occurrence wins)', async () => {
    await writeFileAt(clone, 'specs/shared.md', '# shared');

    const result = await resolveContextSpecs(
      fakeContainer,
      clone,
      ['specs/shared.md'],
      [['specs/shared.md']],
      makeLogger(),
    );
    expect(result.specsRead).toEqual(['specs/shared.md']);
    expect(result.specs).toEqual(['# shared']);
  });

  it('refuses a path that resolves outside the clone root (AC-15) without failing the run', async () => {
    await writeFileAt(clone, 'specs/ok.md', '# ok');
    // Bypasses the write-boundary Zod guard on purpose — the resolver is the
    // last line of defense against a stored path escaping the clone.
    const result = await resolveContextSpecs(
      fakeContainer,
      clone,
      ['specs/ok.md', '../../etc/passwd'],
      [],
      makeLogger(),
    );
    expect(result.specsRead).toEqual(['specs/ok.md']);
  });

  it('skips a missing path without failing the run (AC-9)', async () => {
    await writeFileAt(clone, 'specs/present.md', '# present');
    const result = await resolveContextSpecs(
      fakeContainer,
      clone,
      ['specs/present.md', 'specs/missing.md'],
      [],
      makeLogger(),
    );
    expect(result.specsRead).toEqual(['specs/present.md']);
  });

  it('skips a binary file without failing the run', async () => {
    await writeFileAt(clone, 'specs/binary.md', Buffer.from([0x00, 0x01, 0x02]));
    await writeFileAt(clone, 'specs/text.md', '# text');
    const result = await resolveContextSpecs(
      fakeContainer,
      clone,
      ['specs/binary.md', 'specs/text.md'],
      [],
      makeLogger(),
    );
    expect(result.specsRead).toEqual(['specs/text.md']);
  });

  it('skips a symlinked file without failing the run', async () => {
    await writeFileAt(clone, 'specs/real.md', '# real');
    try {
      await symlink(join(clone, 'specs', 'real.md'), join(clone, 'specs', 'linked.md'));
    } catch {
      // symlink creation can fail in some sandboxes — assertion still holds.
    }
    const result = await resolveContextSpecs(
      fakeContainer,
      clone,
      ['specs/linked.md', 'specs/real.md'],
      [],
      makeLogger(),
    );
    expect(result.specsRead).toEqual(['specs/real.md']);
  });

  it('flattens multiple skill groups in link order before dedup', async () => {
    await writeFileAt(clone, 'docs/a.md', '# a');
    await writeFileAt(clone, 'docs/b.md', '# b');
    const result = await resolveContextSpecs(
      fakeContainer,
      clone,
      [],
      [['docs/a.md'], ['docs/b.md']],
      makeLogger(),
    );
    expect(result.specsRead).toEqual(['docs/a.md', 'docs/b.md']);
  });
});
