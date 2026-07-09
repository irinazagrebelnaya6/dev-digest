/**
 * Intent Layer classifier prompt: header-only file list (hunk headers, no
 * body lines) + graceful degradation on a doc-less PR (R2).
 */
import { describe, it, expect } from 'vitest';
import { buildIntentPrompt, formatFileList, type IntentDiffFile } from '../src/intent-prompt.js';

const files: IntentDiffFile[] = [
  {
    path: 'src/config.ts',
    additions: 3,
    deletions: 1,
    hunks: [
      {
        file: 'src/config.ts',
        oldStart: 10,
        oldLines: 2,
        newStart: 10,
        newLines: 4,
        newLineNumbers: [10, 11, 12, 13],
      },
    ],
  },
  {
    path: 'src/routes/api.ts',
    additions: 20,
    deletions: 0,
    hunks: [
      {
        file: 'src/routes/api.ts',
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 20,
        newLineNumbers: Array.from({ length: 20 }, (_, i) => i + 1),
      },
    ],
  },
];

describe('formatFileList', () => {
  it('includes each file path and reconstructed hunk headers', () => {
    const out = formatFileList(files);
    expect(out).toContain('src/config.ts');
    expect(out).toContain('src/routes/api.ts');
    expect(out).toContain('@@ -10,2 +10,4 @@');
    expect(out).toContain('@@ -1,0 +1,20 @@');
  });

  it('never includes hunk body lines (header-only, AC6)', () => {
    const out = formatFileList(files);
    // No diff body markers: a leading '+' or '-' at the start of a rendered
    // line (as opposed to the '@@ -x +y @@' header, which is asserted above).
    const bodyLikeLine = out
      .split('\n')
      .some((line) => /^\s*[+-](?!\d)/.test(line) && !line.trim().startsWith('@@'));
    expect(bodyLikeLine).toBe(false);
  });

  it('handles an empty file list without throwing', () => {
    expect(() => formatFileList([])).not.toThrow();
    expect(formatFileList([])).toBe('(no changed files)');
  });
});

describe('buildIntentPrompt', () => {
  it('produces a system + user message pair for a rich PR (title + body + linked issue)', () => {
    const messages = buildIntentPrompt({
      title: 'Add rate limiting to public API',
      body: 'Implements ticket JIRA-123: add token-bucket rate limiting to /api/*.',
      linkedIssue: 'JIRA-123: Public API is unprotected against abuse',
      files,
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('Add rate limiting to public API');
    expect(messages[1]!.content).toContain('JIRA-123');
    expect(messages[1]!.content).toContain('src/routes/api.ts');
  });

  it('degrades gracefully when body and linkedIssue are null/empty (R2 — never refuses)', () => {
    const messages = buildIntentPrompt({
      title: 'Update config',
      body: null,
      linkedIssue: null,
      files,
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toMatch(/NEVER refuse/i);
    expect(messages[0]!.content).toMatch(/infer/i);
    expect(messages[1]!.content).toContain('Update config');
    expect(messages[1]!.content).toContain('(no description provided)');
    expect(messages[1]!.content).toContain('(no linked issue found)');
  });

  it('degrades gracefully with an empty-string body too', () => {
    const messages = buildIntentPrompt({ title: 'x', body: '', files: [] });
    expect(messages).toHaveLength(2);
    expect(messages[1]!.content).toContain('(no description provided)');
    expect(messages[1]!.content).toContain('(no changed files)');
  });
});
