# Dependency Checker — metrics reference

Deep-dive on exactly how each number in the report is computed, and how to troubleshoot when something looks wrong. Read `SKILL.md` first — this file is for when you need the mechanics.

## Discovery

`analyze-deps.mjs` recursively walks from `--root` (default: repo root / cwd), collecting every directory that contains a `package.json`. It does **not** descend into:

```
node_modules  .git  dist  build  coverage  .next  .turbo  .cache  out  clones  .pnpm-store  .vercel
```

...plus any dotfile-prefixed directory (`.vscode`, `.github`, etc.) and anything passed via `--exclude a,b,c`. This mirrors the exclude-list convention already used elsewhere in this repo for filesystem discovery (project-context reader, write-lock guard) — dependency scanning shouldn't wander into vendored code, build output, or cloned external repos.

## Size: how `du -skL` is used

For each declared dependency (`dependencies` + `devDependencies`) in a package's manifest, the script looks at `<packageDir>/node_modules/<depName>`:

1. If it doesn't exist → size is `null` (rendered as `n/a` — either the package isn't installed at all, or that specific dependency is missing/hoisted elsewhere).
2. If it's a symlink (the normal case under pnpm — top-level deps are symlinks into a content-addressable store), the script resolves the **real path** with `fs.realpathSync` first.
3. It then runs `du -skL <realPath>` and parses the kilobyte count from stdout.

**Why `-L` (dereference) matters:** a plain `du -sh` on a pnpm symlink reports a handful of bytes (the symlink itself), not the actual package. Every dependency-analysis tool that doesn't account for this will report near-zero sizes for everything under pnpm — a naive implementation is worse than useless here, since it looks like it's working while being completely wrong. `-L` follows the link before measuring.

**The one real caveat:** because each dependency is measured independently, and pnpm hardlinks (not just symlinks) shared package content from its central store into multiple locations, a package that's a dependency of *both* `server/` and `client/` gets counted at full size in *both* reports. The repo-wide total (sum across all packages) is therefore an **upper bound on unique bytes on disk**, not the true unique total — `du` only dedupes hardlinks within a single invocation, and this script invokes `du` once per dependency, so cross-dependency and cross-package sharing isn't detected. This doesn't affect the *within-package* ranking (which is the number that actually drives decisions — "does this package pull in something huge"), only the repo-level aggregate.

## Version: how "installed version" is read

`getInstalledVersion` reads `.version` from `<packageDir>/node_modules/<depName>/package.json` — the version that's **actually installed and resolved**, not the semver range declared in the consuming manifest (`^3.0.0` tells you nothing about drift; the resolved `3.4.2` vs `3.6.0` does).

## Duplicate-version detection

For every dependency name seen across *any* manifest in the repo, the script groups by **resolved installed version** (not by declared range). If the same package name resolves to more than one distinct version anywhere in the repo, it's reported as a duplicate. The action-list entry for a duplicate is scored by the *largest known size* seen for that package name across all packages — so a duplicated 40 MB library outranks a duplicated 200 KB one in the priority list, even though "how many versions" is the same for both.

**Why duplicates matter beyond disk space:** even when pnpm's store means the marginal disk cost of a second version is small, having two active versions of the same library in one process is a common source of subtle bugs (e.g. two instances of a library that relies on a module-level singleton, or two versions of `zod`/`react` with incompatible internal types). Disk savings are a bonus; behavioral consistency is the real reason to dedupe.

## "Possibly unused" heuristic

For every **production** dependency (never `devDependencies` — those are commonly used only from config files, CLIs, or build tooling that this heuristic doesn't scan, so flagging them produces mostly noise), the script:

1. Recursively reads every `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs` file under that package's directory (same exclude list as discovery).
2. Searches the concatenated text for the pattern `['"`]<depName>(/<anything>)?['"`]` — i.e. the dependency name appearing inside a quoted import/require specifier, optionally with a subpath (`lodash/debounce` still matches a check for `lodash`).
3. If no match is found anywhere, the dependency is flagged.

**What this catches:** the overwhelmingly common case — a dependency listed in `package.json` that nothing in the source tree ever imports. Confirmed on this repo's own `server/` package: `@fastify/autoload` is declared but never imported (the codebase has a comment explaining it deliberately uses static route registration instead — a real, verified finding, not a hypothetical).

**What it misses (verify before deleting):**
- Usage from a CLI binary invocation (`"scripts": {"start": "some-cli"}`) rather than a source-code import.
- Usage only inside a config file with an extension outside the scanned set (`.json`, `.yaml`, `.mjs` is scanned but e.g. `.cts` is not).
- A dependency that's only a `peerDependency` requirement of *another* installed package (transitively required, never imported directly by your code, but still needed).
- Re-exports through an intermediate module using a computed or aliased specifier the regex won't literal-match.

## Outdated check (`--outdated`)

Runs `npm outdated --json` once per package directory (not once per dependency — that would be dozens of registry round-trips). `npm outdated` exits with a non-zero status code whenever it finds anything outdated (that's normal, not a failure) — the script reads the JSON from stdout regardless of exit code, and only treats it as "unavailable" if stdout isn't parseable JSON at all (offline, npm not on PATH, or a 60-second timeout).

This flag is **opt-in** specifically because it's the only network-dependent, slow part of the tool — every other metric here is instant and fully offline.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every size in a package's table is `n/a` | That package's `node_modules` isn't installed — the report says so explicitly with a ⚠️ line; run `pnpm install` (or equivalent) there first. |
| A dependency you know is huge shows `n/a` | It's declared in `package.json` but not actually installed (check spelling, check it's not accidentally under `optionalDependencies`, which this script doesn't currently read). |
| `--outdated` section is missing even though you passed the flag | `npm outdated` failed silently (offline, no npm on PATH, or timed out after 60s) — that package's report just omits the section rather than erroring the whole run. |
| A dependency you're SURE is used shows as "possibly unused" | Check the four bullets above — it's very likely one of: CLI-only usage, config-file-only usage, peer-dependency-only usage, or a re-export pattern the regex can't literal-match. |
