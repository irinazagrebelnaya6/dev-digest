#!/usr/bin/env node
/**
 * `devdigest` bin launcher. The project runs TypeScript directly (no build
 * step — tsx in dev/tests), so this thin Node shim runs the TS CLI entry
 * through tsx's programmatic CLI. Invoking `node <tsx-cli> <entry>` (rather than
 * relying on the `.bin/tsx` symlink) is the portable form that works in this
 * repo's environment.
 *
 * After `pnpm install` / `npm link`, this is exposed as the `devdigest` command:
 *   devdigest review --mode working
 * Or run without installing:
 *   node server/bin/devdigest.mjs review --mode working
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, '..');
const entry = path.join(serverRoot, 'src', 'mcp', 'cli.ts');
const tsxCli = path.join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// Keep the CALLER's cwd (so `git diff` reviews the developer's working copy),
// but point tsx at server/tsconfig.json so the `@devdigest/*` path aliases
// resolve regardless of where the command was invoked from.
const child = spawn(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TSX_TSCONFIG_PATH: path.join(serverRoot, 'tsconfig.json') },
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (err) => {
  console.error(`devdigest: failed to launch — ${err.message}`);
  process.exit(2);
});
