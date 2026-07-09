---
name: Three new read-only Claude Code subagents (brainstorm, investigator, insight-curator)
description: Add three read-only agent-config Markdown files under .claude/agents/ and update the agents README with three sections plus a full 10-agent Mermaid interaction diagram, matching the existing agent conventions exactly.
---

# Three Read-Only Subagents — Development Plan

## Overview
Create three new Claude Code subagents as config Markdown files in `.claude/agents/`:
`brainstorm` (Best-of-N option generation before code), `investigator` (deep codebase
investigation + dependency tracing → report), and `insight-curator` (dedup + promotion
proposals for the per-module `INSIGHTS.md`). All three are **strictly read-only**
(`Read, Grep, Glob`; no Write/Edit/Bash) and restate the no-write constraint in prose.
The `.claude/agents/README.md` catalog is extended with three rows, three per-agent
sections (Behaviour / Based on / Sources), and a **new Mermaid `flowchart` interaction
diagram covering the full 10-agent roster** with its recommended pipeline order.

These are agent-config artifacts (Markdown), not product code, but are planned with the
same rigor as source: exact file paths, per-file skill/source lists, and a validation
strategy. This mirrors the completed `four-new-subagents` plan.

## Requirements / Acceptance Criteria
- Three new files exist: `.claude/agents/brainstorm.md`, `.claude/agents/investigator.md`,
  `.claude/agents/insight-curator.md`.
- Each file has valid YAML frontmatter with **exactly** the fields used by existing agents:
  `name` (kebab-case, matching filename), `description` (block-scalar `>` phrased as a
  **routing/trigger condition**, not a label), `model`, `tools` (a YAML list, one per line,
  with an inline `# … intentionally excluded` comment for the omitted write tools — mirror
  `researcher.md:14`, `architecture-reviewer.md:13`, `plan-verifier.md:13`).
- Model/tool scoping is exactly:
  - `brainstorm` — model `opus`; tools `Read, Grep, Glob` (NO Write/Edit/Bash).
  - `investigator` — model `opus`; tools `Read, Grep, Glob` (NO Write/Edit/Bash).
  - `insight-curator` — model `sonnet`; tools `Read, Grep, Glob` (NO Write/Edit/Bash).
- All three carry an explicit "you have no write tools — report/propose only" rule in the
  prompt body (defense in depth, mirroring `researcher.md:25-28` and `architecture-reviewer.md:25`).
- Each agent's numbered steps name the exact skills it applies and (via a `## Sources`
  block) the external sources it is based on — reproduced exactly as given, never invented.
- Body structure matches existing agents: `# <Name> Agent` → `You are a …` role sentence →
  `## Core Rules` (numbered) → numbered `## Step N —` sections → `## Output`/format
  → `## Definition of Done` → `## Sources`.
- `.claude/agents/README.md` is updated: Catalog table gets three new rows; each agent gets
  a `## <name>` section with **Behaviour**, **Based on**, **Sources** subsections (matching
  the existing `planner`/`architecture-reviewer` shape); the intended-flow prose is extended.
- README gains a **Mermaid `flowchart` interaction diagram of the FULL 10-agent roster**
  (researcher, investigator, brainstorm, planner, implementer, test-writer,
  architecture-reviewer, plan-verifier, doc-writer, insight-curator) showing the recommended
  pipeline order, with researcher/investigator able to feed any stage. Valid Mermaid syntax.
- All artifacts are in English (repo `CLAUDE.md` rule).

## Architecture Changes
New files (agent configs — Markdown, no product code):
- `.claude/agents/brainstorm.md`
- `.claude/agents/investigator.md`
- `.claude/agents/insight-curator.md`

Modified:
- `.claude/agents/README.md` — Catalog table (+3 rows), intended-flow paragraph update, a
  new `## Agent interaction pipeline` (or similar) section holding the Mermaid flowchart,
  and three new per-agent sections; optionally +rows in the "Design practices applied" table
  (Best-of-N / Verbalized Sampling, hypothesis-driven investigation, two-strikes promotion).

No source code, schema, DI, tenancy, grounding, or contract changes. No migrations.

### Conventions to reproduce (from recon — bake into every file)
- Frontmatter: block-scalar `description: >` phrased as a routing trigger ("Use when…" /
  "Use to…"), exactly as `researcher.md` / `architecture-reviewer.md` / `plan-verifier.md`.
- `tools:` as a YAML list, one entry per line, with an inline `# Write, Edit, Bash
  intentionally excluded — read-only` comment (pattern from `architecture-reviewer.md:13`,
  `plan-verifier.md:13`).
- Body: `# <Name> Agent` → role sentence → `## Core Rules` (numbered) → numbered `## Step N`
  → `## Output` format block → `## Definition of Done` → `## Sources` (bare "Title — URL" list).
- Read-only agents restate the no-write constraint in prose as Core Rule #1 (mirror
  `researcher.md:27` / `architecture-reviewer.md:25` / `plan-verifier.md:25`).
- Skills referenced by their catalog kebab-case names. English only.

### Known constraint discovered in recon (flag, do not block on)
- The `mermaid-diagram` skill is referenced by `doc-writer.md` but has **no file** under
  `.claude/skills/` (only `README.md` and `patern-abtipatern-skill-writer.md` exist). The
  README's Mermaid diagram must therefore be written to correct, self-contained Mermaid
  `flowchart` syntax directly (do not rely on the skill file existing). `brainstorm` may
  *reference* `mermaid-diagram` as an option-sketch skill exactly as `doc-writer` does —
  consistency with the existing convention wins over the missing file.

## Implementation Steps

1. `[Agent:brainstorm]` Write `.claude/agents/brainstorm.md` — files: `.claude/agents/brainstorm.md`; skills the AGENT applies: `onion-architecture`, `typescript-expert` (to ground options in our stack), `mermaid-diagram` (optional option-sketch, as `doc-writer` references it).
   - Frontmatter: `name: brainstorm`, model `opus`, tools `Read, Grep, Glob` with inline `# Write, Edit, Bash intentionally excluded — read-only, generates options not code`; `description` = trigger ("Use BEFORE any code/plan to generate and weigh multiple diverse solution approaches (Best-of-N), then hand off to `planner`").
   - Body: read-only role sentence + Core Rule #1 "you have no write tools — you produce a decision brief, never code or files"; Core Rule that it hands off to `planner` and never plans/implements itself.
   - Step — **Generate N=3–5 genuinely diverse options** (not minor variants): use Verbalized Sampling (ask for several approaches each with an assigned prior/probability), prompt-level diversity injection, and structurally different expert personas (systems-architect / security / product / junior-dev). Sources: Verbalized Sampling (arXiv 2510.01171), Perspectra (arXiv 2509.20553), N sweet-spot (arXiv 2502.11027).
   - Step — **Anti-anchoring**: restate the problem first; generate at least one option that contradicts the obvious one; sequential disclosure (options formed BEFORE any cross-comparison); a devil's-advocate pass arguing for the runner-ups. Sources: When Context Hurts (arXiv 2605.04361), Devil's Advocate (arXiv 2502.06251), Anchoring (arXiv 2505.15392).
   - Step — **Score/rank with a LOCKED rubric + pairwise comparison** (avoid batch position bias); criteria = effort × impact × reversibility-risk × complexity × dependency-surface, using QOC (Questions-Options-Criteria). Sources: RULERS (arXiv 2601.08654v1), QOC/BlockAI (blockai.medium.com QOC article).
   - Step — ground options in our stack via `onion-architecture` + `typescript-expert`; may sketch an option with `mermaid-diagram`.
   - Output = a **decision brief**: per-option `{summary, core mechanism, pros/cons, risks(likelihood+reversibility), effort t-shirt, score-by-criterion, incompatible-with, grafting note}` + a recommendation block `{winner, confidence, rationale, runner-up grafts, open-questions}`. The `open-questions` field is the explicit human/planner checkpoint. Sources: Explore-Execute-Chain (arXiv 2509.23946), Anthropic multi-agent research system.
   - Definition of Done: 3–5 diverse options, each scored against the locked rubric; a recommendation with confidence + open-questions; no files written; handoff note to `planner`.
   - `## Sources` block: all URLs listed above (reproduced exactly).
   - depends on: none
   - status: ▫ not started

2. `[Agent:investigator]` Write `.claude/agents/investigator.md` — files: `.claude/agents/investigator.md`; skills the AGENT applies: `typescript-expert`.
   - Frontmatter: `name: investigator`, model `opus`, tools `Read, Grep, Glob` with inline `# Write, Edit, Bash intentionally excluded — read-only investigation`; `description` = trigger ("Use for deep end-to-end codebase investigation, call-graph tracing, and root-cause analysis — produces a report only. Distinct from `researcher` (quick locator): investigator DIGS").
   - Body: read-only role sentence + Core Rule #1 no-write; Core Rule distinguishing it from `researcher` (locator vs. deep investigation/RCA).
   - Step — **Search funnel**: grep/glob for hypothesis generation → AST-level precision → confirm; grep BOTH directions for callers/callees when no code-graph exists. Sources: grep backbone (yage.ai), LocAgent (arXiv 2503.09089).
   - Step — **Method: hypothesis → evidence → confirm**: explore multiple hypotheses, do not commit before attempting to REFUTE the leading one; treat absence-of-evidence as signal; set a hypothesis-revision budget. Sources: RCA (arXiv 2605.03505v1), Think Locally (arXiv 2601.17915), SWE course-correct (arXiv 2509.02360).
   - Step — **Dependency & blast radius**: report DIRECT (immediate callers/callees) vs TRANSITIVE separately and ALWAYS state which depth was traced; flag cross-repo/shared-artifact blind spots. Note the repo's `repoIntel.*` facade (`getBlastRadius`, `getCallerSignatures`) whose results it may READ. Sources: Blast Radius (riftmap.dev), AEF (dev.to/irrindar).
   - Step — **Claim-level provenance**: every claim cites `file:line` with an exact excerpt + confidence; flag citation gaps rather than presenting unbacked claims. Sources: Claim-Level Auditability (arXiv 2602.13855), Provenance (arXiv 2605.17169).
   - Step — **Context discipline**: excerpt-over-whole-file (`file:start-end`), structural scouting before full reads, breadth-first at the hypothesis level. Sources: Context as a Tool (arXiv 2512.22087), Anthropic context engineering.
   - Output = **investigation report**: question, scope, method (tools/patterns used), findings (claim + `file:line` evidence + confidence), dependency map (direct/transitive + depth traced), open questions, gaps/caveats. Apply `typescript-expert` for accurate reading of types/exports/signatures.
   - Definition of Done: every claim backed by `file:line`; direct vs transitive depth explicitly stated; open questions + gaps listed; no files written.
   - `## Sources` block: all URLs above (reproduced exactly).
   - depends on: none
   - status: ▫ not started

3. `[Agent:insight-curator]` Write `.claude/agents/insight-curator.md` — files: `.claude/agents/insight-curator.md`; skills the AGENT applies: `typescript-expert` (reading source it cites); advisory-only.
   - Frontmatter: `name: insight-curator`, model `sonnet`, tools `Read, Grep, Glob` with inline `# Write, Edit, Bash intentionally excluded — advisory only, never edits INSIGHTS/skills/docs`; `description` = trigger ("Use to review the per-module INSIGHTS.md, deduplicate, and PROPOSE promotions to a skill / doc / ADR — advisory only, never edits").
   - Body: read-only role sentence + Core Rule #1 "advisory only — you never edit INSIGHTS.md, skills, or docs; you produce a proposal report"; Core Rule "treat memory as a hint, not a fact".
   - Step — **Read the per-module INSIGHTS**: `server/INSIGHTS.md`, `client/INSIGHTS.md`, `reviewer-core/INSIGHTS.md`; be aware skills live in `.claude/skills/`, docs in `docs/<package>/`, ADRs under `docs/adr/`. Ties into the repo's `/engineering-insights` end-of-session workflow (root `CLAUDE.md`).
   - Step — **Dedup by meaning, not string match**; classify overlaps as `temporal-update` vs `context-dependent` vs `actual-contradiction` — never silently merge a real contradiction. Sources: SemHash (medium.com/@sreeprad99), self-updating wiki (startupgtm.substack.com).
   - Step — **Promotion pipeline with a skill-eligibility gate**: promote only on the TWO-STRIKES rule (pattern recurs ≥2 independent times) + reusability/value/stability/precision; a decision tree for destination (skill vs doc vs ADR). Sources: Anthropic Agent Skills, groff.dev implementing CLAUDE.md agent skills.
   - Step — **Staleness**: flag entries with a CLOSED enum reason (`temporal_update | superseded_by | no_timestamp_too_old | contradicted_by`); memory is live data — prune, not append. Source: CLAUDE.md/AGENTS.md deep dive (redreamality.com).
   - Step — **Cross-module synthesis**: if ≥2 modules independently found the same thing, that is the strongest signal for ADR-level promotion. Source: Federation over Text (arXiv 2604.16778).
   - Output = **curation report**: dedupe candidates (cluster + proposed merge + confidence), promotion proposals (source→destination + recurrence evidence + rationale + confidence), stale-entry flags (reason enum + proposed action), synthesis opportunities. Every proposal shows the DIFF (existing text → proposed change/destination) but is never applied. Source: Galileo HITL (galileo.ai).
   - Definition of Done: dedupe clusters, promotion proposals (with two-strikes evidence), stale flags (with enum reason), and synthesis opportunities produced as a report; no files edited.
   - `## Sources` block: all URLs above (reproduced exactly).
   - depends on: none
   - status: ▫ not started

4. `[Agent:README]` Update `.claude/agents/README.md` — files: `.claude/agents/README.md`; skills: `mermaid-diagram` conventions (diagram authoring; note the skill file is absent, so write valid self-contained syntax).
   - Add three rows to the Catalog table (`| Agent | Role | Model | Tools | When to use |`): `brainstorm` (opus, `Read, Grep, Glob`), `investigator` (opus, `Read, Grep, Glob`), `insight-curator` (sonnet, `Read, Grep, Glob`) — each linking its file and noting read-only.
   - Extend the "intended flow" paragraph to mention where investigator/brainstorm/insight-curator sit.
   - Add a `## <name>` section per new agent with **Behaviour** (bullet summary of the prompt), **Based on** (design choices: Best-of-N/Verbalized Sampling + anti-anchoring; hypothesis-driven investigation + provenance; two-strikes promotion + advisory-only), and **Sources** (the full URL list from that agent's step) — matching the `planner`/`architecture-reviewer` section shape.
   - Add a `## Agent interaction pipeline` section containing a **Mermaid `flowchart` of the FULL 10-agent roster** and the recommended order: investigator/researcher (gather) → brainstorm (weigh options) → planner (plan) → implementer + test-writer (build) → architecture-reviewer + plan-verifier (review vs. quality & requirements) → doc-writer (document) → insight-curator (curate insights); with researcher/investigator able to feed ANY stage (edges from a gather node into multiple stages). Use `mermaid-diagram` conventions: `flowchart TD/LR`, stable node ids, grouped subgraphs (e.g. Gather / Design / Build / Review / Document / Curate), one directed edge per relationship, no node text collisions. Keep under ~20 nodes (10 agents + a few phase labels) so no split is needed.
   - Optionally extend the "Design practices applied (with sources)" table with: Best-of-N option generation / Verbalized Sampling, hypothesis-driven investigation with claim-level provenance, two-strikes insight promotion.
   - depends on: 1, 2, 3
   - status: ▫ not started

## Testing Strategy
These are Markdown config files, so "tests" = validation, not automated suites:
1. **Frontmatter validity** — each new file's YAML frontmatter parses (delimited by `---`;
   valid `name/description/model/tools`; `name` matches filename; `tools` is a well-formed
   YAML list). Visual/parse check.
2. **Tool-scoping check** — the `tools:` list of all three files contains ONLY `Read, Grep,
   Glob` (no `Write`, `Edit`, `Bash`); grep the three files to confirm no write tool leaked in.
3. **Registry appearance** — each new agent appears in the `.claude/agents/README.md` Catalog
   with a working relative link and a matching `## <name>` section.
4. **Mermaid render** — the README flowchart is valid Mermaid: it renders (e.g. GitHub
   preview or a Mermaid live editor); all 10 agents appear as nodes; edges reflect the
   documented pipeline order; researcher/investigator have fan-out edges into multiple stages.
5. **Convention conformance** — diff review that each file matches the existing structure
   (role sentence → Core Rules → numbered Steps → Output → Definition of Done → Sources),
   restates the no-write rule in prose, and is English-only. Sources reproduced verbatim.

## Risks
- **Blast radius: minimal.** Only files under `.claude/agents/` change; no product code,
  schema, DI, tenancy, or grounding paths touched. No migrations.
- **Unsupported frontmatter fields.** Advanced fields (`skills:` preload, `isolation`,
  `permissionMode`, hooks) may be ignored by the installed Claude Code version — so the
  read-only hard constraint is enforced in the **prompt body** (Core Rule #1), not only via
  frontmatter. Match only the four fields existing agents use.
- **Missing `mermaid-diagram` skill file.** The skill is referenced but has no file; the
  README diagram must be authored to correct, self-contained Mermaid syntax and not depend on
  the skill existing. `brainstorm` referencing it is intentional (matches `doc-writer`).
- **Model-name consistency.** Existing agents mix `claude-sonnet-4-6` and bare `opus`/`sonnet`;
  follow the task's stated values (`opus`, `opus`, `sonnet`) and stay consistent with the
  README Catalog Model column.
- **Source accuracy.** Reproduce every URL exactly as provided; do not invent or "correct"
  arXiv ids or links.
- **Overlap confusion.** `investigator` vs `researcher` must be clearly disambiguated in both
  the agent body and the README, so routing does not misfire (locator vs. deep dig).

## Success Checklist
- [ ] `.claude/agents/brainstorm.md` exists with `opus` + read-only tools, no-write Core Rule, Verbalized-Sampling/personas diversity, anti-anchoring (problem-restate + contradicting option + sequential disclosure + devil's-advocate), locked-rubric + pairwise + QOC scoring, decision-brief output with open-questions checkpoint, handoff-to-`planner`, and a Sources block.
- [ ] `.claude/agents/investigator.md` exists with `opus` + read-only tools, no-write Core Rule, disambiguation from `researcher`, grep→AST search funnel (both directions), hypothesis→refute→confirm method with a revision budget, direct-vs-transitive dependency mapping (depth stated) with `repoIntel.*` note, claim-level `file:line` provenance, context discipline, investigation-report output, and a Sources block.
- [ ] `.claude/agents/insight-curator.md` exists with `sonnet` + read-only tools, advisory-only no-edit Core Rule, reads all three module `INSIGHTS.md`, meaning-based dedup with contradiction classification, two-strikes promotion gate + skill/doc/ADR decision tree, staleness enum flags, cross-module synthesis → ADR signal, diff-showing curation-report output, and a Sources block.
- [ ] All three `description` fields are block-scalar routing triggers, each `name` matches its filename, and each `tools:` list is exactly `Read, Grep, Glob` with an inline exclusion comment.
- [ ] `.claude/agents/README.md` Catalog has three new rows and each new agent has a Behaviour / Based on / Sources section.
- [ ] `.claude/agents/README.md` contains a valid Mermaid `flowchart` covering all 10 agents in the recommended pipeline order, with researcher/investigator fanning out to multiple stages.
- [ ] Every artifact is in English and follows the existing role → Core Rules → Steps → Output → Definition of Done → Sources structure.
- [ ] Frontmatter of all three files parses as valid YAML using only `name/description/model/tools`.
