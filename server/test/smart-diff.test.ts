import { describe, it, expect } from 'vitest';
import { classifyFile, composeSmartDiff } from '../src/modules/reviews/smart-diff.js';
import { SMART_DIFF_SPLIT_THRESHOLD_LINES } from '../src/modules/reviews/smart-diff.constants.js';

/**
 * Pure unit coverage for the Smart Diff classifier + composer. NO DB, NO
 * network, NO LLM — the absence of any provider/completeStructured import in
 * ../src/modules/reviews/smart-diff.ts is itself proof of R4 (no LLM call).
 */

describe('classifyFile', () => {
  // AC1 — lock-files ALWAYS classify as boilerplate, highest precedence.
  it('classifies lock files as boilerplate', () => {
    expect(classifyFile('server/pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyFile('client/package-lock.json')).toBe('boilerplate');
    expect(classifyFile('yarn.lock')).toBe('boilerplate');
    expect(classifyFile('npm-shrinkwrap.json')).toBe('boilerplate');
  });

  it('classifies generated/mechanical paths as boilerplate', () => {
    expect(classifyFile('client/dist/bundle.js')).toBe('boilerplate');
    expect(classifyFile('server/build/index.js')).toBe('boilerplate');
    expect(classifyFile('client/.next/server/app.js')).toBe('boilerplate');
    expect(classifyFile('src/__snapshots__/Foo.test.tsx.snap')).toBe('boilerplate');
    expect(classifyFile('server/src/db/migrations/meta/_journal.json')).toBe('boilerplate');
  });

  it('classifies config/bootstrap/plumbing paths as wiring', () => {
    expect(classifyFile('server/vitest.config.ts')).toBe('wiring');
    expect(classifyFile('client/tsconfig.json')).toBe('wiring');
    expect(classifyFile('server/drizzle.config.ts')).toBe('wiring');
    expect(classifyFile('client/next.config.js')).toBe('wiring');
    expect(classifyFile('server/src/modules/reviews/index.ts')).toBe('wiring');
    expect(classifyFile('server/src/db/migrations/0001_add_column.sql')).toBe('wiring');
    expect(classifyFile('.github/workflows/ci.yml')).toBe('wiring');
    expect(classifyFile('scripts/e2e.sh')).toBe('wiring');
  });

  it('classifies business-logic source files as core', () => {
    expect(classifyFile('server/src/modules/reviews/service.ts')).toBe('core');
    expect(classifyFile('client/src/components/diff-viewer/FileCard.tsx')).toBe('core');
  });

  it('lock-file precedence wins even against a wiring-like path', () => {
    // A file that could look "config"-ish by name but is a lock file must
    // still resolve to boilerplate — boilerplate patterns are checked first.
    expect(classifyFile('tooling/config/pnpm-lock.yaml')).toBe('boilerplate');
  });
});

describe('composeSmartDiff', () => {
  it('groups files by role in fixed order core -> wiring -> boilerplate, keeping empty groups', () => {
    const result = composeSmartDiff(
      [
        { path: 'src/modules/reviews/service.ts', additions: 10, deletions: 2 },
        { path: 'pnpm-lock.yaml', additions: 1, deletions: 1 },
      ],
      [],
    );
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(result.groups[0]!.files).toHaveLength(1);
    expect(result.groups[0]!.files[0]!.path).toBe('src/modules/reviews/service.ts');
    expect(result.groups[1]!.files).toHaveLength(0); // no wiring files — kept as an empty group
    expect(result.groups[2]!.files).toHaveLength(1);
    expect(result.groups[2]!.files[0]!.path).toBe('pnpm-lock.yaml');
  });

  it('maps finding_lines to sorted unique start lines per file, empty when none', () => {
    const result = composeSmartDiff(
      [{ path: 'src/api/users.ts', additions: 5, deletions: 0 }],
      [
        { file: 'src/api/users.ts', startLine: 45 },
        { file: 'src/api/users.ts', startLine: 12 },
        { file: 'src/api/users.ts', startLine: 45 }, // duplicate
        { file: 'other/file.ts', startLine: 99 },
      ],
    );
    const [file] = result.groups[0]!.files;
    expect(file!.finding_lines).toEqual([12, 45]);
    expect(file!.pseudocode_summary).toBeNull();
  });

  it('returns finding_lines: [] for every file when there are no findings (before any review)', () => {
    const result = composeSmartDiff(
      [
        { path: 'src/a.ts', additions: 1, deletions: 0 },
        { path: 'src/b.ts', additions: 1, deletions: 0 },
      ],
      [],
    );
    for (const group of result.groups) {
      for (const file of group.files) {
        expect(file.finding_lines).toEqual([]);
      }
    }
  });

  it('too_big toggles around the threshold constant, driving proposed_splits', () => {
    const underThreshold = composeSmartDiff(
      [{ path: 'src/a.ts', additions: SMART_DIFF_SPLIT_THRESHOLD_LINES / 2, deletions: 0 }],
      [],
    );
    expect(underThreshold.split_suggestion.too_big).toBe(false);
    expect(underThreshold.split_suggestion.proposed_splits).toEqual([]);

    const overThreshold = composeSmartDiff(
      [
        { path: 'src/modules/reviews/service.ts', additions: SMART_DIFF_SPLIT_THRESHOLD_LINES, deletions: 1 },
        { path: 'pnpm-lock.yaml', additions: 1, deletions: 0 },
      ],
      [],
    );
    expect(overThreshold.split_suggestion.too_big).toBe(true);
    expect(overThreshold.split_suggestion.total_lines).toBe(SMART_DIFF_SPLIT_THRESHOLD_LINES + 2);
    // One split per non-empty role only (core + boilerplate here, no wiring files).
    expect(overThreshold.split_suggestion.proposed_splits).toEqual([
      { name: 'core', files: ['src/modules/reviews/service.ts'] },
      { name: 'boilerplate', files: ['pnpm-lock.yaml'] },
    ]);
  });
});
