---
name: dependency-checker
description: "Analyze every package.json in a repository: compute each dependency's REAL on-disk size (correctly dereferences pnpm/npm symlinks, unlike a naive du), flag duplicate installed versions, dependencies that resolve to the same version but are physically separate installs (dual-package-hazard risk across mixed npm/pnpm packages), and possibly-unused packages, optionally check for outdated majors, and produce a Mermaid dependency-weight diagram plus a prioritized clean-up list. Use this whenever the user asks about dependency size, bundle weight, node_modules bloat, 'why is node_modules so big', duplicate packages, outdated dependencies, a dependency audit/report, or wants a visual dependency diagram — even if they just say 'check our dependencies', 'what's taking up so much space', or 'can we remove any of these packages'."
metadata:
  tags: dependencies, bundle-size, audit, nodejs, npm, pnpm, mermaid
---

# Dependency Checker

Answers one question developers keep asking and rarely measure: **which of our dependencies actually cost us something, and what should we do about it?** It runs a bundled, zero-install script over every `package.json` in the repo, computes real disk footprint per dependency, and turns that into a diagram + a ranked action list — not just a wall of numbers.

## Trigger

Use this skill when the user asks things like: "why is `node_modules` so huge", "audit our dependencies", "which packages are we not even using", "do we have duplicate versions of anything", "show me a dependency size breakdown", "are any of our deps way out of date", or wants a visual dependency graph/diagram. It applies to Node/npm/pnpm projects (this repo: `server/`, `client/`, `reviewer-core/`, `e2e/` — each has its own `package.json`, no root workspace).

## Process

### Step 1 — Run the bundled analyzer

Don't hand-roll a `du` loop or manually read every `package.json` — the script already handles pnpm's symlink layout, exclusion of `node_modules`/`dist`/`build`/`.next`/`clones`/etc., and the size/duplicate/unused logic in one deterministic pass:

```bash
node .claude/skills/dependency-checker/scripts/analyze-deps.mjs [--root <dir>] [--top N] [--outdated] [--out <file>]
```

| Flag | Default | Meaning |
|---|---|---|
| `--root <dir>` | repo root (or cwd) | Where to start discovering `package.json` files |
| `--top N` | 15 | How many heaviest dependencies to show per package |
| `--outdated` | off | Also runs `npm outdated --json` per package (hits the npm registry — slower, needs network; off by default so a normal run stays instant and offline-safe) |
| `--out <file>` | stdout | Write the Markdown report to a file instead of printing it |
| `--exclude a,b,c` | (built-in list) | Extra directory names to skip during discovery |

No `npm install` needed — it's plain Node (builtins only), runs in well under a second on a repo this size.

### Step 2 — Read the report

The output has, in order: an **executive summary** (one row per package — score /100, size, findings count, top-priority action — plus a Mermaid `xychart-beta` bar chart of scores), a repo-level overview (one Mermaid diagram, one node per package, sized/colored by total footprint), then **one section per `package.json`** (its header now also carries that package's score) with its own top-N Mermaid diagram + table + "possibly unused" list + (if `--outdated`) an outdated table, then a repo-wide **duplicate versions** section, then a **"same version, different install" (dual-package-hazard)** section, then a **prioritized action list**.

The **score** (0–100) measures cleanliness, not size — it starts at 100 and is docked for the same findings that drive the action list: possibly-unused deps (-20 each, capped -60), duplicate versions involving that package (-10 each, capped -30), same-version-different-install hazards involving that package (-15 each, capped -30), outdated packages if `--outdated` was run (-4 each, capped -20). A package with no findings scores 100 regardless of how heavy its dependencies are — `next` or `typescript` being large doesn't cost points, since there's no fix for that. Labels: ≥90 Excellent · ≥75 Good · ≥50 Needs attention · <50 Poor.

**"Same version, different install" is a distinct, more dangerous check than the plain duplicate-version one.** Duplicate-version detection compares resolved version *strings*; it says nothing about whether two packages that happen to match still hold the same physical file. This second check compares device+inode of each dependency's `package.json` after resolving symlinks, so it catches the case a version diff can't: two packages report the identical version, but one is npm-installed (a genuinely separate copy) while another is pnpm-installed (hardlinked into pnpm's shared store) — or any other case where the underlying bytes have quietly diverged from a shared copy. This matters because identity-based checks in JS (`instanceof SomeError`, branded types, `Symbol` comparisons) silently break the moment the two copies drift apart, with no version-mismatch warning to catch it — the versions matched right up until they didn't. Do not conflate this with the plain duplicate-version section when explaining it to the user; it is worth calling out even when all versions currently match.

### Step 3 — Turn findings into prioritized advice

Don't just paste the raw report back — synthesize it for the developer. The report already sorts the action list by size (biggest win first), so lead with that, but add judgment the script can't:

- **Unused flags are a heuristic** (see Known Limitations) — phrase them as "worth checking", not "definitely remove".
- **A critical-tier dependency with no lighter alternative is not a problem** — say so explicitly, so the developer doesn't chase a fix that doesn't exist (e.g. `typescript` at 20+ MB is normal; it's a `devDependency` and never ships).
- **Duplicate versions** are worth a sentence on *why* it matters even if pnpm's content-addressable store means the disk cost is often shared (see Known Limitations) — the real risk is usually behavioral drift (two different versions of the same library active in the same process), not raw bytes.
- **"Same version, different install" findings deserve more urgency than plain duplicates, not less** — the matching version number can read as reassuring ("at least they're in sync"), but it's the opposite: nothing is actively keeping them in sync, and there's no version-mismatch signal left to warn anyone when they do drift. If the report's cluster description shows a mix of shared and solo copies (e.g. two packages sharing one pnpm-hardlinked copy, one other on its own npm-installed copy), name the odd one out specifically — that's the package whose install setup (usually the wrong package manager, or missing from a pnpm workspace) is the actual thing to fix.
- If `--outdated` wasn't run and the user is asking about staleness, say you can run it (and that it needs network) rather than guessing versions.

### Step 4 — Present the diagram

Embed the generated Mermaid code block(s) directly in your reply (don't redraw them by hand) — they render inline in most Markdown viewers, including this one.

## Expected output

```
# Dependency Report
**N package(s) analyzed** · **X MB** total footprint.
## Executive summary
  | Package | Score | Size | Findings | Top priority |
  <mermaid xychart-beta: bar of score per package>
## Repo overview
  <mermaid: one node per package.json, color = size tier>
## <package name> (`<relative path>`) — Score: NN/100 (label)
  <mermaid: top-N heaviest deps for this package>
  | # | Package | Version | Size | Tier | Type | Notes |
  Possibly unused (k): ...
  Outdated (if --outdated): ...
## Duplicate versions across packages
## Same version, different install (dual-package-hazard risk)
  | Package | Version | Who shares a copy, who doesn't |
## Prioritized action list
  1. Remove `x` — unused (N MB)
  2. Dedupe/pin `y` — N versions in play
  ...
```

## Size tiers

| Tier | Threshold | Meaning |
|---|---|---|
| 🔴 critical | ≥ 20 MB | Dominates the footprint — usually one of a handful of big libraries (frameworks, bundlers, `typescript` itself) |
| 🟠 large | ≥ 5 MB | Worth knowing about, rarely worth fighting alone |
| 🟡 medium | ≥ 1 MB | Normal |
| 🟢 small | < 1 MB | Noise |

Thresholds live as constants (`TIERS`) at the top of `scripts/analyze-deps.mjs` — change them there if a repo's scale warrants different cutoffs.

## Known limitations (read before trusting the numbers)

- **pnpm's content-addressable store double-counts across packages.** Each dependency's size is computed independently (`du -skL` on its resolved real path), so if two packages in the repo share a large dependency, that dependency's bytes are counted once per package in the report — not deduped globally. This is correct for "which import pulls the most weight into *this* package", not a literal sum of disk usage across the whole `node_modules` tree.
- **"Possibly unused" is a text-grep heuristic** (`from '<dep>'` / `require('<dep>')` / `import('<dep>')` across `.ts/.tsx/.js/.jsx/.mjs/.cjs` source files, `devDependencies` excluded). It will miss usage via CLI binaries, config files it doesn't scan, re-exports through a barrel file with a differently-named import, or type-only usage that the regex doesn't match. Always verify before deleting — but a real one was caught while building this skill: `@fastify/autoload` in `server/package.json`, confirmed unused (the codebase deliberately switched to static imports and left the comment explaining why, but never removed the now-dead dependency).
- **`--outdated` hits the npm registry per package** — slow and requires network; it's opt-in for exactly that reason. If it fails (offline, npm missing, timeout), that package's report just omits the outdated section rather than erroring out.
- **The dual-package-hazard check only sees direct dependencies that are actually installed and resolvable** — same blind spots as the size/unused checks (a package the script can't `stat` a `package.json` for is silently skipped, not reported as a false hazard). It also only compares packages this script discovered as having their own `package.json`; it won't catch the same class of hazard one level deeper in the dependency graph (e.g. two *transitive* deps drifting inside node_modules internals).
- **Node/npm/pnpm only, for now.** It walks for `package.json`; it won't find or weigh `requirements.txt`, `go.mod`, `Cargo.toml`, etc. Say so if asked about a non-Node ecosystem rather than guessing.

## Related skills

- `mermaid-diagram` — for hand-authoring a different kind of diagram than the ones this skill auto-generates (e.g. an architectural "why we depend on X" narrative diagram).
- `typescript-expert` / `fastify-best-practices` — once a dependency is flagged for removal or replacement, use these for the actual refactor.
