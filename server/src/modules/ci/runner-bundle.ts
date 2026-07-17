import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CiFile } from '@devdigest/shared';
import { RUNNER_DIR } from './constants.js';

/**
 * AC-17 — embeds the bundled `@devdigest/agent-runner` (its `ncc`-built
 * `dist/`) into the exported artifact set as `.devdigest/runner/*`, so the
 * generated PR is self-executing in the target repo's CI (the workflow
 * invokes `node .devdigest/runner/index.js`).
 *
 * `agent-runner/dist/` is gitignored — it is a *build* artifact
 * (`pnpm --dir agent-runner build`), not something this feature builds or
 * modifies (spec non-goal). When it hasn't been built yet (fresh checkout,
 * CI job that never ran the agent-runner build step), this degrades to a
 * LOUD placeholder — a valid, self-contained `index.js` that exits non-zero
 * with a clear message — rather than throwing here and blocking the whole
 * export. This mirrors the repo-intel "degraded, not an error" convention:
 * every OTHER artifact (manifest, skills, memory, workflow) still exports and
 * installs correctly; only the runner step of the CI job would fail loudly
 * until a real bundle is exported over it by re-running export after a build.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
// server/src/modules/ci -> server/src/modules -> server/src -> server -> <repo root>
const RUNNER_DIST_DIR = path.resolve(HERE, '../../../../agent-runner/dist');

const PLACEHOLDER_RUNNER_JS = `#!/usr/bin/env node
// DevDigest CI runner — PLACEHOLDER.
//
// The real @devdigest/agent-runner bundle was not built at export time
// (agent-runner/dist/ is a build artifact, not checked into DevDigest's own
// repo). Run \`pnpm --dir agent-runner build\` and re-export this agent to
// replace this file with the real, self-contained runner.
console.error(
  '[devdigest] agent-runner bundle missing at export time — rebuild agent-runner and re-export this agent to CI.',
);
process.exitCode = 1;
`;

/** Read every `.js` file under the built `agent-runner/dist/` as CiFile[]. */
export function readRunnerBundle(): CiFile[] {
  if (!existsSync(RUNNER_DIST_DIR)) {
    return [{ path: `${RUNNER_DIR}/index.js`, contents: PLACEHOLDER_RUNNER_JS, editable: false }];
  }
  const entries = readdirSync(RUNNER_DIST_DIR).filter((f) => f.endsWith('.js'));
  return entries.map((file) => ({
    path: `${RUNNER_DIR}/${file}`,
    contents: readFileSync(path.join(RUNNER_DIST_DIR, file), 'utf8'),
    editable: false,
  }));
}
