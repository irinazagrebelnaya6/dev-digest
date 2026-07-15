# Harness Self-Check

**name:** harness-self-check
**description:** Close the loop so a future session (or a PR) automatically re-checks a changed skill/agent/CLAUDE.md against its eval, without anyone having to remember to run it.

---

## Context

Two related asks, one goal — "the harness checks itself":

1. **Local loop:** `pnpm eval` is green. Write the self-check rule into `CLAUDE.md`/`AGENTS.md`
   itself: which command to run after which kind of change, so the *next* Claude Code session
   reads this file (per the existing "read INSIGHTS.md" convention already in `AGENTS.md`) and
   knows to eval before committing — the rule becomes harness state, not something only the user
   remembers.
2. **CI:** the same checks, enforced automatically on every PR that touches `.claude/skills/*`,
   `.claude/agents/*`, or any `AGENTS.md`/`CLAUDE.md` — so a contributor who *doesn't* know the
   local convention still gets caught by CI.

## Constraints (established by inspecting the existing harness)

- **Not every skill/agent has an eval yet** (only `dependency-checker` under `evals/skills/`, and
  `architecture-reviewer` + `architecture-reviewer-lite` under `evals/agents/` — 16+ other skills
  and 9+ other agents have none). CI must **skip with a visible log line**, never fail, when no
  eval exists for the thing that changed.
- **`EVAL_MODEL`/`EVAL_JUDGE_MODEL` are read once per process** (`evals/src/config.ts:9-10`), so
  different tiers can use different models simply by setting different env vars per CI step — no
  code change needed in the harness itself.
- **Tool tiers vs content tier matters for model choice.** Per `evals/README.md`'s own tier split:
  `agentTask`/`workflowTask` stay on the Claude Agent SDK (Anthropic wire protocol) and need the
  bundled LiteLLM proxy (`evals/proxy/`) to run a non-Anthropic model; `skillTask` is a direct
  OpenAI-compatible call and runs natively on OpenRouter, no proxy. `evals/scripts/litellm-proxy.sh`
  already recommends `google/gemini-2.5-flash` by name as the model that "survives the tool
  tiers" — the pick for `eval:agents`/`eval:workflow`. For the no-tool-use content tier
  (`eval:skills`), `deepseek/deepseek-chat` (the repo's own documented OpenRouter example, no proxy
  needed) is cheaper and sufficient.
- **`OPENROUTER_API_KEY` is already set** as a GitHub Actions secret in this repo — no new secret
  setup needed, just reference `secrets.OPENROUTER_API_KEY`.
- **Path convention:** `CLAUDE.md` is a symlink to `AGENTS.md` at every level (root, `server/`,
  `reviewer-core/`, `client/`, `e2e/`). Git only sees a diff on the real file, so path filters must
  watch `AGENTS.md` / `*/AGENTS.md`, not `CLAUDE.md`.
- `evals/agents/architecture-reviewer-lite/` is a *variant* suite for the same underlying
  `.claude/agents/architecture-reviewer.md` — the "does an eval exist" check must match by
  **prefix** (`evals/agents/<name>*`), not exact-dir-name, so variant suites aren't missed.

## Part 1 — `AGENTS.md` self-check rule

Edit root `AGENTS.md` (which `CLAUDE.md` symlinks to):

**`## Commands`** — add the evals commands alongside the existing per-package ones:
```bash
cd evals && pnpm eval:quality    # static gate — SKILL.md structure, no model call
cd evals && pnpm eval:skills     # skill content evals (LLM-judged)
cd evals && pnpm eval:agents     # subagent content evals (LLM-judged)
cd evals && pnpm eval:workflow   # systemic: skill activation, subagent dispatch, CLAUDE.md routing
```

**New section, `## Self-check before commit`** (placed right after `## Read when...`): a short
rule plus the change→eval table:

| You changed | Run before committing |
|---|---|
| `.claude/skills/<name>/**` | `cd evals && pnpm eval:quality && pnpm exec vitest run skills/<name>` — skip if `evals/skills/<name>*/` doesn't exist yet |
| `.claude/agents/<name>.md` | `cd evals && pnpm exec vitest run agents/<name>` — skip if `evals/agents/<name>*/` doesn't exist yet |
| `CLAUDE.md` / any `AGENTS.md` | `cd evals && pnpm eval:workflow` |

One line noting CI (`.github/workflows/harness-evals.yml`) runs the same checks automatically on
every PR touching these paths, so this table is the human/local mirror of that workflow, not a
separate source of truth.

## Part 2 — CI workflow

### New file: `.github/workflows/harness-evals.yml`

Mirrors the existing path-filtered convention (`reviewer-core.yml`): triggers on `pull_request`
with paths `.claude/skills/**`, `.claude/agents/**`, `AGENTS.md`, `server/AGENTS.md`,
`reviewer-core/AGENTS.md`, `client/AGENTS.md`, `e2e/AGENTS.md`, and the workflow file itself.

Single job, `ubuntu-latest`, working-directory `evals`, `permissions: contents: read`, standard
`concurrency` cancel-in-progress group. Steps:

1. Checkout with `fetch-depth: 0` (need `git diff` against the PR base to list changed files).
2. `actions/setup-node@v4` (node 22) + `pnpm install` in `evals/`.
3. **Plan step** — new script `evals/scripts/ci-plan.mjs base_sha head_sha`, run via
   `node scripts/ci-plan.mjs "${{ github.event.pull_request.base.sha }}" "${{ github.sha }}"`.
   It runs `git diff --name-only <base> <head>` and prints three GitHub Actions step outputs
   (`skills`, `agents`, `claudemd`) as JSON: distinct skill names touched under
   `.claude/skills/<name>/`, distinct agent names under `.claude/agents/<name>.md` (`.md`
   stripped), and a boolean for any `AGENTS.md` touched. Kept as a standalone script (not inlined
   bash) so it's also runnable locally (`node evals/scripts/ci-plan.mjs origin/main HEAD`) to
   preview what CI will do.
4. **Skills step** (`if: fromJson(steps.plan.outputs.skills)[0] != null`) — env:
   `EVAL_BACKEND=openrouter`, `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`,
   `EVAL_MODEL=deepseek/deepseek-chat`, `EVAL_JUDGE_MODEL=deepseek/deepseek-chat`. Loops the
   `skills` JSON array in bash; for each name, if `evals/skills/<name>*/` matches an existing dir,
   run `pnpm exec vitest run "skills/${name}"`; otherwise
   `echo "::notice::no eval for skill '${name}' — skipping"`. No proxy needed (content tier).
5. **Agents + workflow step(s)** (`if:` either agents changed or claudemd is true) — start the
   LiteLLM proxy first (`pnpm proxy:up`, reusing `evals/scripts/litellm-proxy.sh` — already blocks
   until healthy), env: `EVAL_BACKEND=openrouter`, `OPENROUTER_API_KEY` (secret),
   `OPENROUTER_BASE_URL=http://localhost:4000`, `EVAL_MODEL=google/gemini-2.5-flash`,
   `EVAL_JUDGE_MODEL=google/gemini-2.5-flash`.
   - For each changed agent name: same exists-or-skip loop as skills, against
     `evals/agents/<name>*/`, running `pnpm exec vitest run "agents/${name}"` when found.
   - If `claudemd` is true: `pnpm eval:workflow` (full systemic suite — a single CLAUDE.md change
     can affect routing anywhere, so this one always runs in full rather than being scoped).
   - `pnpm proxy:down` in an `if: always()` cleanup step.
6. Model names are plain `env:` values in the YAML (no `workflow_dispatch` input, nothing surfaced
   in any UI). Bumping the model later is a one-line YAML edit.

### Model summary (env per step)

| Tier | Command | Model | Proxy? |
|---|---|---|---|
| Skill content | `vitest run skills/<name>` | `deepseek/deepseek-chat` | no |
| Agent (tool tier) | `vitest run agents/<name>` | `google/gemini-2.5-flash` | yes |
| Workflow (tool tier) | `pnpm eval:workflow` | `google/gemini-2.5-flash` | yes |

## Verification

1. `node evals/scripts/ci-plan.mjs <some-older-sha> HEAD` locally — confirm it correctly lists the
   skills/agents touched by a given diff and flags `claudemd: true` when an `AGENTS.md` changed.
2. A PR that only touches `.claude/skills/dependency-checker/SKILL.md` (whitespace edit) — the
   workflow runs, scopes to that one skill, and skips all others.
3. A PR touching an agent with **no** eval (e.g. `brainstorm.md`) — the job logs
   `::notice::no eval for agent 'brainstorm' — skipping` and still passes (doesn't fail).
4. An `AGENTS.md`-only edit triggers the full `pnpm eval:workflow` step and the proxy starts/stops
   cleanly.
