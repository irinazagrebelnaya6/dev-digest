import { parse as parseYaml, stringify } from 'yaml';
import { RUNNER_ENTRY } from '../constants.js';

/**
 * Deterministic GitHub Actions workflow generator (AC-4, AC-5, AC-6). Built as
 * a plain object (not a hand-assembled string) so the security invariants are
 * enforced BY CONSTRUCTION — permissions and the fork guard are literal
 * fields, not string interpolation that could be bypassed — then serialized
 * with `yaml.stringify`. `assertWorkflowSecurity` re-checks the serialized
 * text as a second, independent gate (defence in depth / regression net).
 */

export type CiTrigger = 'opened' | 'synchronize' | 'reopened';

export interface WorkflowInputs {
  /** Maintainer-selected triggers from Configure; `reopened` is the only optional one. */
  triggers: string[];
  postAs: 'github_review' | 'pr_comment' | 'none';
}

/** Always included regardless of `inputs.triggers` (AC-5). */
const ALWAYS_ON_TRIGGERS: readonly CiTrigger[] = ['opened', 'synchronize'];

export function workflowYaml(
  agentSlug: string,
  inputs: WorkflowInputs,
): { yaml: string; validated: boolean } {
  const types: CiTrigger[] = inputs.triggers.includes('reopened')
    ? [...ALWAYS_ON_TRIGGERS, 'reopened']
    : [...ALWAYS_ON_TRIGGERS];

  const workflow = {
    name: 'DevDigest CI Review',
    on: {
      pull_request: { types },
    },
    // AC-4: EXACTLY these two permissions, nothing broader.
    permissions: {
      contents: 'read',
      'pull-requests': 'write',
    },
    jobs: {
      review: {
        'runs-on': 'ubuntu-latest',
        // AC-6: gate the WHOLE job on non-fork PRs, not just the secret env
        // var — so a fork-triggered run never executes ANY step with
        // OPENROUTER_API_KEY in its environment.
        if: 'github.event.pull_request.head.repo.fork == false',
        steps: [
          { uses: 'actions/checkout@v4' },
          { uses: 'actions/setup-node@v4', with: { 'node-version': '20' } },
          {
            name: 'DevDigest review',
            env: {
              // AC-4: reference the secret only via the GHA expression — NEVER
              // an inlined key value.
              OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
              // Auto-provided by Actions for every job; forwarded explicitly so
              // the runner (which reads process.env directly) can see it.
              GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
              PR_NUMBER: '${{ github.event.pull_request.number }}',
              DEVDIGEST_POST_AS: inputs.postAs,
              DEVDIGEST_AGENT_SLUG: agentSlug,
            },
            run: `node ${RUNNER_ENTRY}`,
          },
        ],
      },
    },
  };

  const yamlText = stringify(workflow);
  return { yaml: yamlText, validated: assertWorkflowSecurity(yamlText) };
}

interface ParsedWorkflow {
  permissions?: Record<string, string>;
  jobs?: Record<string, { if?: string }>;
}

/**
 * Re-validates the security invariants of a workflow YAML string (AC-4, AC-6).
 * Exported so tests can assert the invariants directly, and so a future
 * server-side re-validation step (if edited workflow text is ever accepted
 * back from the client) has a single place to call — today `CiExportInput`
 * carries no file-override field, so the service only ever validates its own
 * freshly-generated output.
 */
export function assertWorkflowSecurity(yamlText: string): boolean {
  const parsed = parseYaml(yamlText) as ParsedWorkflow;
  const perms = parsed.permissions ?? {};
  const permKeys = Object.keys(perms);
  const permsOk =
    permKeys.length === 2 && perms.contents === 'read' && perms['pull-requests'] === 'write';

  const secretOk = referencesSecretOnly(yamlText, 'OPENROUTER_API_KEY');

  const forkGuardOk = Object.values(parsed.jobs ?? {}).some((job) =>
    (job.if ?? '').replace(/\s+/g, ' ').includes('head.repo.fork == false'),
  );

  return permsOk && secretOk && forkGuardOk;
}

/**
 * True iff every LINE mentioning `key` is exactly the well-formed
 * `KEY: ${{ secrets.KEY }}` env assignment — never a literal value, a comment
 * leaking it, or any other shape. Naming the env var `OPENROUTER_API_KEY` is
 * expected and correct (that occurrence is the assignment's left-hand side,
 * not a leak); what must NEVER appear is that name paired with anything
 * other than the secrets expression on the right-hand side. A text with zero
 * mentions of `key` vacuously passes (nothing to leak).
 */
function referencesSecretOnly(text: string, key: string): boolean {
  const validLine = new RegExp(`^${key}\\s*:\\s*\\$\\{\\{\\s*secrets\\.${key}\\s*\\}\\}$`);
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes(key));
  return lines.every((l) => validLine.test(l));
}
