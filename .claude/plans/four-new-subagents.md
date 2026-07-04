---
name: Four new Claude Code subagents (test-writer, architecture-reviewer, plan-verifier, doc-writer)
description: Add four agent-config Markdown files under .claude/agents/ and document them in the agents README, matching the existing agent conventions.
---

# Four New Subagents — Development Plan

## Overview
Create four new Claude Code subagents as config Markdown files in `.claude/agents/`:
`test-writer`, `architecture-reviewer`, `plan-verifier`, and `doc-writer`. Each mirrors
the existing agent-file conventions (frontmatter `name/description/model/tools`; English
only; role-declaration → core rules → numbered steps → output format → definition-of-done)
and encodes its skills, sources, and tool scoping. The `.claude/agents/README.md` catalog
and per-agent sections are updated so the registry stays authoritative.

These are agent-config artifacts (Markdown), not product code, but are planned with the
same rigor: exact file paths, per-file skill/source lists, and a validation strategy.

## Requirements / Acceptance Criteria
- Four new files exist: `.claude/agents/test-writer.md`, `.claude/agents/architecture-reviewer.md`,
  `.claude/agents/plan-verifier.md`, `.claude/agents/doc-writer.md`.
- Each file has valid YAML frontmatter with exactly the fields used by existing agents:
  `name` (kebab-case, matching filename), `description` (written as a **trigger/routing
  condition**, not a label), `model`, `tools` (as a YAML list, matching researcher/planner
  style, with an inline comment noting intentionally excluded tools where relevant).
- Model/tool scoping is exactly:
  - `test-writer` — model `sonnet`; tools `Read, Grep, Glob, Write, Edit, Bash`.
  - `architecture-reviewer` — model `opus`; tools `Read, Grep, Glob` (NO Write/Edit/Bash).
  - `plan-verifier` — model `opus`; tools `Read, Grep, Glob` (NO Write/Edit/Bash).
  - `doc-writer` — model `sonnet`; tools `Read, Grep, Glob, Write, Edit` (NO Bash).
- Read-only agents carry an explicit "you have no write tools" rule in the prompt body
  (defense in depth, mirroring `researcher.md`).
- `test-writer` write scope is constrained **in the system prompt** to test files only
  (`**/*.test.ts`, `**/*.it.test.ts`, client `*.test.tsx`); it must STOP and report a gap
  rather than edit any source/migration/config file, since frontmatter path-scoping may be
  unsupported in the installed version.
- Each agent's system prompt names the exact skills it applies (drawn from
  `.claude/skills/README.md`) and lists the external sources it is based on.
- `.claude/agents/README.md` is updated: the Catalog table gets four new rows, and each
  agent gets a `## <name>` section with **Behaviour**, **Based on**, and **Sources**
  subsections (matching the existing `planner` / `implementer` section shape).
- All artifacts are in English (repo CLAUDE.md rule).

## Architecture Changes
New files (agent configs — Markdown, no product code):
- `.claude/agents/test-writer.md`
- `.claude/agents/architecture-reviewer.md`
- `.claude/agents/plan-verifier.md`
- `.claude/agents/doc-writer.md`

Modified:
- `.claude/agents/README.md` — Catalog table + four new per-agent sections; optionally a
  new row or two in the "Design practices applied" table (read-only review agents;
  adversarial verification; Diátaxis doc-type selection).

No source code, schema, DI, or contract changes. No `docs/` content is authored by THIS
task — the `doc-writer` agent is a config that will later produce docs into the existing
`docs/<package>/README.md`, package `README.md`, module `README.md`, and `docs/adr/`
locations (confirmed present: `docs/{server,client,reviewer-core,e2e,agent-prompts}/README.md`).

### Conventions to reproduce (from recon — bake into every file)
- Frontmatter: block-scalar `description: >` like `researcher.md`/`planner.md`, or a plain
  one-liner — but always phrased as a routing trigger ("Use when…").
- `tools:` as a YAML list, one per line, with `# intentionally excluded` inline comments
  for omitted tools (pattern from `researcher.md` line 14 and `planner.md` line 13).
- Body structure: `# <Name> Agent` → `You are a …` role sentence → `## Core Rules` (numbered)
  → numbered `## Step N —` sections → `## Output` format → definition-of-done.
- English only; skills referenced by their catalog kebab-case names.
- Read-only agents restate the no-write constraint in prose (mirrors `researcher.md` lines 25–28).

## Implementation Steps

1. `[Agent:test-writer]` Write `.claude/agents/test-writer.md` — files: `.claude/agents/test-writer.md`; skills the AGENT applies: `react-testing-library, react-best-practices, fastify-best-practices, drizzle-orm-patterns, zod, typescript-expert`.
   - Frontmatter: `name: test-writer`, model `sonnet`, tools `Read, Grep, Glob, Write, Edit, Bash`; `description` = trigger ("Use when a change needs automated tests written for UI or backend…").
   - Body: role sentence; Core Rules including **WRITE SCOPE = TEST FILES ONLY** (`**/*.test.ts`, `**/*.it.test.ts`, client `*.test.tsx`) — never touch source/migrations/config; if a test can't pass without a source change, STOP and report the gap.
   - Step 0 — read `TESTING.md` + the module's `INSIGHTS.md` first (server → `server/INSIGHTS.md`; client → `client/INSIGHTS.md`; reviewer-core → `reviewer-core/INSIGHTS.md`). Weave in the repo split: unit lane excludes `**/*.it.test.ts`; integration lane selects `.it.test`; DB-backed tests importing `test/helpers/pg.ts` MUST use the `.it.test.ts` suffix; hermetic-by-default via `src/adapters/mocks.ts` (`MockLLMProvider`, `MockGitClient`) and `ContainerOverrides`.
   - Step 1 — skill routing table (UI → `react-testing-library`, `react-best-practices`; backend → `fastify-best-practices`, `drizzle-orm-patterns`; always → `zod`, `typescript-expert`).
   - Step 2 — bake in RTL practices: query priority `getByRole` → … → `getByTestId` last; `userEvent` not `fireEvent`; one behavior/assertion per test (avoid "Assertion Roulette"); no snapshot overuse. Backend: unit (DB-free, mock via `ContainerOverrides`/`mocks.ts`) vs integration `*.it.test.ts` (real PG via testcontainers, self-skip when Docker absent); assert `app.inject()` → `statusCode`, `.json()` shape, validation 400/422, persistence side-effect. Coverage philosophy: prioritize boundaries/error-states/edge cases over happy path; assert consequences not restated computation; mutation-score mindset over line coverage (aligns with `TESTING.md` "typological, not exhaustive").
   - Step 3 — Verify-before-done: run the matching suite (`cd client && pnpm test` / `cd server && pnpm test` / `cd reviewer-core && npm test`; server split per `TESTING.md`) and finish only when green.
   - Output/DoD + Sources block (Kent C. Dodds; Fastify Testing; Augment Code mutation testing; K2View; alexop.dev).
   - depends on: none
   - status: ▫ not started

2. `[Agent:architecture-reviewer]` Write `.claude/agents/architecture-reviewer.md` — files: `.claude/agents/architecture-reviewer.md`; skills the AGENT applies: `onion-architecture` (primary), `typescript-expert`.
   - Frontmatter: `name: architecture-reviewer`, model `opus`, tools `Read, Grep, Glob` with inline `# Write, Edit, Bash intentionally excluded — read-only review`; `description` = trigger ("Use to review already-written code for architectural soundness — layer/dependency/coupling/DI violations — never to fix them").
   - Body: read-only role sentence + explicit "you have no write tools; report findings only" rule (mirror `researcher.md`).
   - Checklist section: layer violations; dependency direction (inward-only); coupling (circular / excessive cross-module imports); cohesion / SRP; DI (`platform/container.ts`, no `new Repo()` in services); module boundaries (the `server/src/modules/` map); deviation from established project patterns. Reference repo gotchas: tenancy guard, grounding gate, `vendor/shared/` sync, schema-columns-only.
   - Output format: **every finding cites `file:line` + severity (critical/warning/suggestion) + a concrete mitigation in prose — never a code patch/diff.**
   - "What NOT to flag" section + confidence gating: no style nitpicking; defer to `CLAUDE.md` / project conventions (consistency within project over abstract ideals); suppress low-confidence findings.
   - Sources block (DeepWiki architecture-reviewer; arXiv 2602.07609; Qt code-review skills; Cloudflare AI code review; Augment Code high-quality review agent).
   - depends on: none
   - status: ▫ not started

3. `[Agent:plan-verifier]` Write `.claude/agents/plan-verifier.md` — files: `.claude/agents/plan-verifier.md`; skills the AGENT applies: `typescript-expert` (reading code); relies on the planner's plan format (Requirements / Acceptance Criteria + Success Checklist).
   - Frontmatter: `name: plan-verifier`, model `opus`, tools `Read, Grep, Glob` with inline `# no write tools — verification only`; `description` = trigger ("Use after implementation to verify every plan requirement/acceptance-criterion was actually built; NOT for style or architecture review").
   - Body: read-only role + no-write rule.
   - Core: input = a plan (`.claude/plans/<slug>.md`, its Requirements/Acceptance Criteria + Success Checklist) plus the already-written code. Scope = **requirements/spec traceability & completeness ONLY** — style and architecture are explicitly OUT of scope (defer to `architecture-reviewer` / `pr-self-review`).
   - Grounding rule: confirm each requirement by reading actual file contents (`Read`/`Grep`), never trust a self-report or summary.
   - Output: per-requirement table — Requirement | PASS / PARTIAL / FAIL | Confidence | Evidence (quoted `file:line`).
   - Stance: independent/adversarial — optimize for finding gaps, not confirming completion. Include an explicit "difference from architecture-reviewer / code review" framing (traceability vs. quality).
   - Sources block (MindStudio LLM-as-judge; SDD arXiv 2602.00180; PolicyGuard arXiv 2606.29225).
   - depends on: none
   - status: ▫ not started

4. `[Agent:doc-writer]` Write `.claude/agents/doc-writer.md` — files: `.claude/agents/doc-writer.md`; skills the AGENT applies: `mermaid-diagram` (primary), `typescript-expert` (reading code accurately).
   - Frontmatter: `name: doc-writer`, model `sonnet`, tools `Read, Grep, Glob, Write, Edit` with inline `# Bash intentionally excluded`; `description` = trigger ("Use to document already-written functionality, turn an implementation plan into docs, or convert provided material into structured docs with diagrams").
   - Step: doc-type selection via **Diátaxis** (tutorial / how-to / reference / explanation) — choose the mode BEFORE writing.
   - Placement rules (must know WHERE to write, from `CLAUDE.md` "Read when…"): package `README.md`; `docs/<package>/README.md` (present: `docs/{server,client,reviewer-core,e2e,agent-prompts}/README.md`); module-level README (e.g. `server/src/modules/<x>/README.md`, cf. existing `server/src/modules/repo-intel/README.md`); ADRs under `docs/adr/`. Docs-as-code: same branch as the feature.
   - Anti-hallucination rules: document only what exists in code; quote error strings/types exactly; cite source files; never invent APIs/signatures.
   - Diagrams: Mermaid embedded in markdown; choose type by intent (flowchart / sequence / ER / class / state); split diagrams larger than ~20 nodes. Apply the `mermaid-diagram` skill.
   - Output/DoD + Sources block (Diátaxis; Spotify docs-as-code; DEV/AWS anti-hallucination; GitHub Blog Mermaid).
   - depends on: none
   - status: ▫ not started

5. `[Agent:README]` Update `.claude/agents/README.md` — files: `.claude/agents/README.md`; skills: none (documentation edit).
   - Add four rows to the Catalog table (`| Agent | Role | Model | Tools | When to use |`) for the new agents, linking each file and stating tool scoping (note read-only for reviewer/verifier; test-file-scoped write for test-writer).
   - Add a `## <name>` section per new agent with **Behaviour** (bullet summary of the prompt), **Based on** (design choices), and **Sources** (the full URL list from that agent's plan step) — matching the existing `planner`/`implementer` section shape and populating the required "Sources".
   - Optionally extend the "Design practices applied (with sources)" table with: read-only review scoping, adversarial verification (judge finds gaps), Diátaxis doc-type selection, and grounding-before-verdict.
   - depends on: 1, 2, 3, 4
   - status: ▫ not started

## Testing Strategy
These are Markdown config files, so "tests" = validation, not automated suites:
1. **Frontmatter validity** — each new file's YAML frontmatter parses (delimited by `---`,
   valid `name/description/model/tools`; `name` matches filename; `tools` is a well-formed
   YAML list). Visual/parse check.
2. **Registry appearance** — each agent appears in the Agent registry and is listed in the
   updated `.claude/agents/README.md` Catalog with a working relative link.
3. **Smoke invocation** — a minimal invocation of each agent confirms it loads and behaves
   in-scope: `test-writer` refuses to edit a non-test file; `architecture-reviewer` and
   `plan-verifier` produce a report and attempt no writes; `doc-writer` selects a Diátaxis
   mode and writes to a valid docs location.
4. **Convention conformance** — diff review that each file matches the researcher/planner/
   implementer structure (role → rules → steps → output → DoD) and is English-only.

## Risks
- **Blast radius: minimal.** Only files under `.claude/agents/` change; no product code,
  schema, DI, tenancy, or grounding paths are touched. No migrations.
- **Unsupported frontmatter fields.** Advanced fields (`skills:` preload, `isolation`,
  `permissionMode`, hooks) may be ignored by the installed Claude Code version — so all
  hard constraints (read-only, test-file-only write scope) are enforced in the **prompt
  body**, not just frontmatter. Match only the fields existing agents use (`name`,
  `description`, `model`, `tools`).
- **Tool-scoping enforcement gap.** Frontmatter path-scoping for `test-writer` may be
  unsupported; the STOP-and-report rule in the prompt is the real guard.
- **Model-name consistency.** Existing agents mix `claude-sonnet-4-6` and bare `opus`/
  `sonnet`; follow the task's stated `model` values (`sonnet`/`opus`) and stay internally
  consistent with the README Catalog column.
- **Source accuracy.** Sources must be reproduced exactly as provided; do not invent or
  "correct" URLs.

## Success Checklist
- [ ] `.claude/agents/test-writer.md` exists with `sonnet` + `Read, Grep, Glob, Write, Edit, Bash`, a test-file-only write-scope rule, TESTING.md/INSIGHTS-first step, RTL + backend + coverage practices, verify-before-done, and a Sources block.
- [ ] `.claude/agents/architecture-reviewer.md` exists with `opus` + read-only tools (no Write/Edit/Bash), an explicit no-write rule, the architecture checklist, `file:line` + severity + prose-mitigation output, a "What NOT to flag" section, and a Sources block.
- [ ] `.claude/agents/plan-verifier.md` exists with `opus` + read-only tools, per-requirement PASS/PARTIAL/FAIL table with confidence + quoted evidence, grounding-by-reading rule, adversarial stance, difference-from-reviewer framing, and a Sources block.
- [ ] `.claude/agents/doc-writer.md` exists with `sonnet` + `Read, Grep, Glob, Write, Edit` (no Bash), Diátaxis doc-type selection, placement rules, anti-hallucination rules, Mermaid diagram guidance, and a Sources block.
- [ ] All four `description` fields are phrased as routing/trigger conditions, and each `name` matches its filename.
- [ ] `.claude/agents/README.md` Catalog table has four new rows and each new agent has a Behaviour / Based on / Sources section.
- [ ] Every artifact is in English and follows the existing role → rules → steps → output → DoD structure.
- [ ] Frontmatter of all four files parses as valid YAML using only the fields existing agents use.
