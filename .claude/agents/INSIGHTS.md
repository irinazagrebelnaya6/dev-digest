# .claude/agents/ INSIGHTS

> Engineering insights for the **agent fleet** — the custom subagents in
> `.claude/agents/*.md` and their pipeline. Append learnings here at the end of any
> meaningful session that changes an agent's contract, tools, or the pipeline wiring.

## What Works

[2026-07-07] Restricting a write-capable subagent to a directory is done by a **prompt rule + a `# comment` on the `Write` entry in frontmatter**, not by tool config — `tools:` cannot scope `Write` to a subpath (it is Write-or-nothing). Precedent: `implementation-planner` (writes only `.claude/plans/`), `spec-creator` (writes only a `specs/.../SPEC-NN-*.md`). Encode the restriction in Core Rules + the write step; add a PreToolUse hook only if a hard guarantee is needed.

## What Doesn't Work

[2026-07-07] "Ground a pre-code spec via the devdigest MCP" does not work today: the MCP tools are PR-review-oriented and `get_blast_radius` returns a `not_implemented` placeholder. A spec is written *before* code, so `spec-creator` grounds on repo-intel reads (real code / README / INSIGHTS) instead, cited in `## Inputs (provenance)` — not on MCP calls.

## Codebase Patterns

[2026-07-07] SDD is split across two agents: `spec-creator` owns **WHAT/why** (requirements, EARS acceptance criteria with stable `AC-N` ids), `implementation-planner` owns **HOW** (consumes requirements, never authors them). The `AC-N` ids are the traceability contract — the planner binds each task to an AC, and `plan-verifier` checks the code against them.

[2026-07-07] Spec file location follows **scope**: a single-module spec lives in that module's own `specs/` folder (`server/src/modules/<m>/specs/`, `client/src/app/<m>/specs/`, `reviewer-core/src/<m>/specs/`); a multi-module / cross-package spec lives in the **repo-root** `specs/`. Spec numbering is **global** — scan `Glob **/specs/SPEC-*.md` for the next `SPEC-NN`.

[2026-07-07] EARS acceptance criteria = one testable statement each (ubiquitous / `WHEN`-event / `WHILE`-state / `IF…THEN`-unwanted / `WHERE`-optional). The hard part is translation: every AC must turn a vague verb ("works well", "is fast") into a concrete trigger + concrete response that a test can check.

[2026-07-07] All agent artifacts, including generated specs, are **English** per root `CLAUDE.md`, regardless of the request's language — encode this as an explicit Core Rule in write-capable agents so they don't mirror a Ukrainian/Russian prompt.

## Tool & Library Notes

[2026-07-07] Mermaid node **ids** in `.claude/agents/README.md` are internal: relabeling a node (e.g. `planner["implementation-planner<br/>…"]`) renders correctly *without* renaming the id, but a stale id (`planner`) still trips a `grep` sweep. Rename ids too (`implplanner`) so rename passes come back clean.

## Recurring Errors & Fixes

[2026-07-07] `Edit` "String to replace not found" on an agent file often means a concurrent linter/session already applied the change — re-`grep` the file before assuming your edit is wrong; the fix may already be in place.

## Session Notes

[2026-07-07] Added `spec-creator` as the 8th agent (SDD stage 1) and renamed `planner` → `implementation-planner`, moving spec-authoring out of the planner into spec-creator. Updated `.claude/agents/README.md` (catalog row, pipeline prose + mermaid, per-agent section, write-capable legend). Trade-off: `spec-creator` runs **one-shot** (a Task subagent cannot hold a turn-by-turn dialogue) — it writes a `draft` spec with `[NEEDS CLARIFICATION]` markers + an `## Open questions` block, the human answers, then it is re-invoked to finalise.

## Open Questions

[2026-07-07] `spec-creator` defaults were assumed, not confirmed: run-mode (one-shot vs interactive), the exact **6 elicitation categories**, grounding source, and write-guard (prompt-only vs PreToolUse hook). Revisit with the user.

[2026-07-07] Should a PreToolUse hook hard-enforce the `spec-creator` / `implementation-planner` write scoping instead of relying on the prompt rule? Worth deciding before the first real SDD runs.
