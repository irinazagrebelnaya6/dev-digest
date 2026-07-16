import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { agentYaml } from '../generators/manifest.js';
import { workflowYaml, assertWorkflowSecurity } from '../generators/workflow.js';
import { RUNNER_ENTRY } from '../constants.js';

const VALID_SOURCE = {
  name: 'Security Reviewer',
  provider: 'openrouter' as const,
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a strict security reviewer.',
  skills: ['api-contract-reviewer', 'test-quality-reviewer'],
  strategy: 'auto' as const,
  ciFailOn: 'critical' as const,
};

describe('CI manifest generator (AC-3, AC-13)', () => {
  it('produces a manifest that validates against AgentManifest.safeParse', () => {
    const { yaml, manifest } = agentYaml(VALID_SOURCE);
    expect(manifest.name).toBe('Security Reviewer');
    expect(manifest.skills).toEqual(['api-contract-reviewer', 'test-quality-reviewer']);
    expect(manifest.ci_fail_on).toBe('critical');

    // Round-trip: the SAME contract the agent-runner parses at CI time.
    const parsed = AgentManifest.safeParse(parseYaml(yaml));
    expect(parsed.success).toBe(true);
  });

  it('re-generates with a different ci_fail_on (AC-13)', () => {
    const { manifest } = agentYaml({ ...VALID_SOURCE, ciFailOn: 'any' });
    expect(manifest.ci_fail_on).toBe('any');
  });

  it('emits skills: [] (not omitted) for an agent with zero linked skills', () => {
    const { manifest } = agentYaml({ ...VALID_SOURCE, skills: [] });
    expect(manifest.skills).toEqual([]);
  });

  it('throws when a tampered/invalid field would fail AgentManifest validation', () => {
    expect(() =>
      agentYaml({ ...VALID_SOURCE, provider: 'not-a-real-provider' as never }),
    ).toThrow();
  });
});

describe('CI workflow generator (AC-4, AC-5, AC-6, AC-17)', () => {
  it('always includes opened + synchronize, omits reopened by default (AC-5)', () => {
    const { yaml } = workflowYaml('security-reviewer', {
      triggers: ['opened', 'synchronize'],
      postAs: 'github_review',
    });
    const parsed = parseYaml(yaml) as { on: { pull_request: { types: string[] } } };
    expect(parsed.on.pull_request.types).toEqual(['opened', 'synchronize']);
  });

  it('adds reopened when selected (AC-5)', () => {
    const { yaml } = workflowYaml('security-reviewer', {
      triggers: ['opened', 'synchronize', 'reopened'],
      postAs: 'github_review',
    });
    const parsed = parseYaml(yaml) as { on: { pull_request: { types: string[] } } };
    expect(parsed.on.pull_request.types).toEqual(['opened', 'synchronize', 'reopened']);
  });

  it('always includes opened + synchronize even if the caller omits them', () => {
    const { yaml } = workflowYaml('security-reviewer', { triggers: [], postAs: 'github_review' });
    const parsed = parseYaml(yaml) as { on: { pull_request: { types: string[] } } };
    expect(parsed.on.pull_request.types).toEqual(['opened', 'synchronize']);
  });

  it('declares exactly contents:read + pull-requests:write (AC-4)', () => {
    const { yaml } = workflowYaml('security-reviewer', {
      triggers: ['opened', 'synchronize'],
      postAs: 'github_review',
    });
    const parsed = parseYaml(yaml) as { permissions: Record<string, string> };
    expect(parsed.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
  });

  it('references OPENROUTER_API_KEY only via ${{ secrets.OPENROUTER_API_KEY }} (AC-4)', () => {
    const { yaml } = workflowYaml('security-reviewer', {
      triggers: ['opened', 'synchronize'],
      postAs: 'github_review',
    });
    expect(yaml).toContain('${{ secrets.OPENROUTER_API_KEY }}');
    // Every line mentioning the key name is the well-formed env assignment —
    // never a literal value or a comment leaking it.
    const mentions = yaml
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('OPENROUTER_API_KEY'));
    expect(mentions).toEqual(['OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}']);
  });

  it('gates the job on non-fork PRs (AC-6)', () => {
    const { yaml } = workflowYaml('security-reviewer', {
      triggers: ['opened', 'synchronize'],
      postAs: 'github_review',
    });
    expect(yaml).toContain('github.event.pull_request.head.repo.fork == false');
  });

  it('invokes the bundled runner entry (AC-17)', () => {
    const { yaml } = workflowYaml('security-reviewer', {
      triggers: ['opened', 'synchronize'],
      postAs: 'github_review',
    });
    expect(yaml).toContain(`node ${RUNNER_ENTRY}`);
    expect(RUNNER_ENTRY).toBe('.devdigest/runner/index.js');
  });

  it('flows the chosen post_as into the workflow env (AC-19)', () => {
    const { yaml } = workflowYaml('security-reviewer', {
      triggers: ['opened', 'synchronize'],
      postAs: 'pr_comment',
    });
    const parsed = parseYaml(yaml) as {
      jobs: { review: { steps: { env?: Record<string, string> }[] } };
    };
    const step = parsed.jobs.review.steps.find((s) => s.env);
    expect(step?.env?.DEVDIGEST_POST_AS).toBe('pr_comment');
  });

  it('marks the generated workflow as passing its own security assertion', () => {
    const { validated } = workflowYaml('security-reviewer', {
      triggers: ['opened', 'synchronize'],
      postAs: 'github_review',
    });
    expect(validated).toBe(true);
  });
});

describe('assertWorkflowSecurity — regression net (AC-4, AC-6)', () => {
  it('rejects a workflow with broader permissions', () => {
    const bad = `permissions:\n  contents: write\n  pull-requests: write\njobs:\n  review:\n    if: github.event.pull_request.head.repo.fork == false\n`;
    expect(assertWorkflowSecurity(bad)).toBe(false);
  });

  it('rejects a workflow with an extra permission key', () => {
    const bad = `permissions:\n  contents: read\n  pull-requests: write\n  issues: write\njobs:\n  review:\n    if: github.event.pull_request.head.repo.fork == false\n`;
    expect(assertWorkflowSecurity(bad)).toBe(false);
  });

  it('rejects a workflow that inlines a literal-looking key alongside the secret ref', () => {
    const bad =
      `permissions:\n  contents: read\n  pull-requests: write\n` +
      `jobs:\n  review:\n    if: github.event.pull_request.head.repo.fork == false\n` +
      `    steps:\n      - env:\n          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}\n` +
      `          NOTE: "OPENROUTER_API_KEY=sk-inlined-value"\n`;
    expect(assertWorkflowSecurity(bad)).toBe(false);
  });

  it('rejects a workflow missing the fork guard', () => {
    const bad = `permissions:\n  contents: read\n  pull-requests: write\njobs:\n  review:\n    runs-on: ubuntu-latest\n`;
    expect(assertWorkflowSecurity(bad)).toBe(false);
  });

  it('accepts a workflow that satisfies all three invariants', () => {
    const good =
      `permissions:\n  contents: read\n  pull-requests: write\n` +
      `jobs:\n  review:\n    if: github.event.pull_request.head.repo.fork == false\n` +
      `    steps:\n      - env:\n          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}\n`;
    expect(assertWorkflowSecurity(good)).toBe(true);
  });
});
