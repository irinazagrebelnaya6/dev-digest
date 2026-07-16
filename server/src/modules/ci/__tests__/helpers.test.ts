import { describe, it, expect } from 'vitest';
import { isValidRepoSlug, slugify, exportPrBody } from '../helpers.js';

describe('isValidRepoSlug (AC-15)', () => {
  it.each([
    'acme/payments-api',
    'my-org/repo.name',
    'a/b',
    'Org_1/Repo-2.x',
    'a1/b2',
  ])('accepts well-formed owner/name: %s', (slug) => {
    expect(isValidRepoSlug(slug)).toBe(true);
  });

  it.each([
    '',
    '../evil',
    'owner/../evil',
    '/repo',
    'owner/',
    'owner//repo',
    'owner/repo/extra',
    'owner name/repo',
    'owner/repo; rm -rf /',
    'owner/`whoami`',
    'owner/$(whoami)',
    'owner/repo|cat',
    'owner/repo\n',
    '.hidden/repo',
    'owner/.hidden',
    'owner/-repo',
    'owner-/repo',
  ])('rejects malformed/injection-shaped input: %j', (slug) => {
    expect(isValidRepoSlug(slug)).toBe(false);
  });
});

describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('Security Reviewer')).toBe('security-reviewer');
  });

  it('strips diacritics', () => {
    expect(slugify('Café Reviewer')).toBe('cafe-reviewer');
  });

  it('collapses non-alphanumeric runs into a single dash', () => {
    expect(slugify('API Contract!! Reviewer++')).toBe('api-contract-reviewer');
  });

  it('trims leading/trailing dashes', () => {
    expect(slugify('--weird--name--')).toBe('weird-name');
  });

  it('falls back when nothing sluggable remains', () => {
    expect(slugify('🎉🎉🎉')).toBe('agent');
    expect(slugify('🎉', 'skill-1')).toBe('skill-1');
  });
});

describe('exportPrBody (AC-7)', () => {
  it('includes the agent name, triggers, and post_as choice', () => {
    const body = exportPrBody('Security Reviewer', {
      repo: 'acme/payments-api',
      target: 'gha',
      action: 'open_pr',
      post_as: 'pr_comment',
      triggers: ['opened', 'synchronize'],
      base: 'main',
    });
    expect(body).toContain('Security Reviewer');
    expect(body).toContain('opened, synchronize');
    expect(body).toContain('pr_comment');
  });
});
