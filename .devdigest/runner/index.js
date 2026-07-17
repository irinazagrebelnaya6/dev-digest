#!/usr/bin/env node
// DevDigest CI runner — PLACEHOLDER.
//
// The real @devdigest/agent-runner bundle was not built at export time
// (agent-runner/dist/ is a build artifact, not checked into DevDigest's own
// repo). Run `pnpm --dir agent-runner build` and re-export this agent to
// replace this file with the real, self-contained runner.
console.error(
  '[devdigest] agent-runner bundle missing at export time — rebuild agent-runner and re-export this agent to CI.',
);
process.exitCode = 1;
