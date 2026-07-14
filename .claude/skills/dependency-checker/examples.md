# Dependency Checker — real example

This is **actual, unedited output** from running the bundled analyzer against this repository (`node .claude/skills/dependency-checker/scripts/analyze-deps.mjs --root . --top 5`) on 2026-07-11 — not a hypothetical. Both findings below are real and were verified by hand while building this skill:

- `@types/node` really does resolve to two different versions across `@devdigest/web`/`@devdigest/api` (22.19.19) vs `@devdigest/reviewer-core` (22.19.20).
- `@fastify/autoload` really is declared in `server/package.json` and never imported — the codebase deliberately switched to static route registration and left a comment explaining why, but never removed the now-dead dependency.

---

```markdown
# Dependency Report

**5 package(s) analyzed** · **464.5 MB** total direct-dependency footprint on disk.

## Repo overview

​```mermaid
flowchart TD
  n_devdigest["devdigest\n0.0 MB"]:::small
  n__devdigest_web["@devdigest/web\n319.1 MB"]:::critical
  n__devdigest_e2e["@devdigest/e2e\n0.0 MB"]:::small
  n__devdigest_reviewer_core["@devdigest/reviewer-core\n43.1 MB"]:::critical
  n__devdigest_api["@devdigest/api\n102.3 MB"]:::critical
  classDef critical fill:#f8d7da,stroke:#b02a37,color:#58151c
  classDef large fill:#ffe5c2,stroke:#b3620a,color:#5c3103
  classDef medium fill:#fff3b0,stroke:#8a6d00,color:#4d3c00
  classDef small fill:#d4edda,stroke:#2e7d32,color:#173d1c
​```

## @devdigest/web (`client`)

Total direct-dependency footprint: **319.1 MB**

​```mermaid
flowchart LR
  root["@devdigest/web"]
  root --> n__devdigest_web_next["next\n153.7 MB"]:::critical
  root --> n__devdigest_web_mermaid["mermaid\n74.7 MB"]:::critical
  root --> n__devdigest_web_lucide_react["lucide-react\n36.4 MB"]:::critical
  root --> n__devdigest_web_typescript["typescript\n22.9 MB"]:::critical
  root --> n__devdigest_web_react_dom["react-dom\n7.1 MB"]:::large
  classDef critical fill:#f8d7da,stroke:#b02a37,color:#58151c
  classDef large fill:#ffe5c2,stroke:#b3620a,color:#5c3103
  classDef medium fill:#fff3b0,stroke:#8a6d00,color:#4d3c00
  classDef small fill:#d4edda,stroke:#2e7d32,color:#173d1c
​```

| # | Package | Version | Size | Tier | Type | Notes |
|---|---|---|---|---|---|---|
| 1 | next | 15.5.19 | 153.7 MB | 🔴 critical | prod | - |
| 2 | mermaid | 11.15.0 | 74.7 MB | 🔴 critical | prod | - |
| 3 | lucide-react | 0.469.0 | 36.4 MB | 🔴 critical | prod | - |
| 4 | typescript | 5.9.3 | 22.9 MB | 🔴 critical | dev | - |
| 5 | react-dom | 19.2.7 | 7.1 MB | 🟠 large | prod | - |

## @devdigest/e2e (`e2e`)

⚠️ `node_modules` not found for this package — run `pnpm install` (or npm/yarn) here first. Sizes below are unavailable until then.

## @devdigest/reviewer-core (`reviewer-core`)

Total direct-dependency footprint: **43.1 MB**

| # | Package | Version | Size | Tier | Type | Notes |
|---|---|---|---|---|---|---|
| 1 | typescript | 5.9.3 | 22.9 MB | 🔴 critical | dev | - |
| 2 | openai | 4.104.0 | 10.0 MB | 🟠 large | prod | - |
| 3 | zod | 3.25.76 | 5.1 MB | 🟠 large | prod | - |
| 4 | @types/node | 22.19.20 | 2.5 MB | 🟡 medium | dev | - |
| 5 | vitest | 2.1.9 | 1.9 MB | 🟡 medium | dev | - |

## @devdigest/api (`server`)

Total direct-dependency footprint: **102.3 MB**

| # | Package | Version | Size | Tier | Type | Notes |
|---|---|---|---|---|---|---|
| 1 | typescript | 5.9.3 | 22.9 MB | 🔴 critical | dev | - |
| 2 | js-tiktoken | 1.0.21 | 20.4 MB | 🔴 critical | prod | - |
| 3 | drizzle-orm | 0.38.4 | 12.8 MB | 🟠 large | prod | - |
| 4 | openai | 4.104.0 | 7.6 MB | 🟠 large | prod | - |
| 5 | drizzle-kit | 0.30.6 | 7.4 MB | 🟠 large | dev | - |

**Possibly unused (1):** no import/require found for: `@fastify/autoload`. Heuristic — verify before removing (see references/metrics.md).

## Duplicate versions across packages

| Package | Versions found |
|---|---|
| @types/node | 22.19.19 (@devdigest/web, @devdigest/api); 22.19.20 (@devdigest/reviewer-core) |

## Prioritized action list

1. Dedupe/pin `@types/node` (2.5 MB) — resolves to 2 different versions across packages (22.19.19, 22.19.20).
2. Remove `@fastify/autoload` from **@devdigest/api** — declared but no import found (1.7 MB). Verify first, then `pnpm remove`.
```

---

## How you'd summarize this to a developer

> Ran a dependency audit across all 4 packages (464.5 MB total direct-dependency footprint, dominated by `client/` at 319 MB — mostly `next` + `mermaid` + `lucide-react`, all expected for a Next.js app with diagram rendering, not a problem to chase).
>
> Two real findings:
> 1. **`@fastify/autoload` in `server/` is dead weight (1.7 MB)** — declared but never imported; the code already switched to static route registration. Safe to `pnpm remove` after a quick grep confirms nothing else references it.
> 2. **`@types/node` resolves to two different versions** (22.19.19 vs 22.19.20) across packages — small size difference, but worth pinning to one version so type behavior stays consistent everywhere.
>
> `e2e/` has no `node_modules` installed, so it couldn't be measured — run `pnpm install` there if you want its numbers too.

Notice the summary **doesn't just repeat the table** — it explains which findings are worth acting on (the two flagged issues) versus which large numbers are simply expected and not worth chasing (Next.js's own footprint). That's the judgment call `SKILL.md` Step 3 asks for.
