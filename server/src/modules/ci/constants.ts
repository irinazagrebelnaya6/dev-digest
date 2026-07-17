/**
 * SPEC-06 — Export to CI. Path/branch constants shared by the generators and
 * the service, so the exact artifact layout lives in exactly one place.
 */

/** Branch the atomic commit lands on (created from the chosen base if missing). */
export const DEVDIGEST_CI_BRANCH = 'devdigest/ci';

/** Directory holding the single per-agent manifest (`<slug>.yaml`). */
export const MANIFEST_DIR = '.devdigest/agents';

/** Directory holding one `<slug>.md` per linked skill. */
export const SKILLS_DIR = '.devdigest/skills';

/** Path of the (possibly empty) exported memory snapshot. */
export const MEMORY_PATH = '.devdigest/memory.jsonl';

/** Directory the bundled `@devdigest/agent-runner` build lands in. */
export const RUNNER_DIR = '.devdigest/runner';

/** Entry point the generated workflow invokes (`node <RUNNER_ENTRY>`). */
export const RUNNER_ENTRY = `${RUNNER_DIR}/index.js`;

/** Path of the generated GitHub Actions workflow. */
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';
