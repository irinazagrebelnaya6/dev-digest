---
name: engineering-insights
description: >
  Captures non-obvious technical learnings from the current session and appends
  them to INSIGHTS.md of the touched module (client/, server/, reviewer-core/).
  Use at the end of any session >30 min where a problem was solved, a decision
  was made, or a non-obvious pattern was discovered. Also use immediately when
  something non-obvious happens mid-session. Trigger with /engineering-insights.
---

## Language rule

**All entries in INSIGHTS.md, plans, and tasks (todos) must be written in English.**
This ensures consistency across sessions and keeps the content searchable and readable by all contributors.

## What to do

1. Identify which module(s) were touched: `client/`, `server/`, `reviewer-core/`
2. For each module, append new entries to its `INSIGHTS.md` (create with all 7 sections if missing)
3. At the end, summarize what was written — one line per module

## INSIGHTS.md structure (7 sections, create if missing)

```
## What Works
```
Approaches, patterns, and solutions that worked and are worth repeating.
Example: "Batching DB writes in chunks of 50 eliminates timeout errors on bulk import."

```
## What Doesn't Work
```
Dead ends that were tried and failed — to avoid repeating them.
Example: "Using prisma.$transaction for >500 rows causes memory spike — avoid."

```
## Codebase Patterns
```
Non-obvious conventions and architectural decisions specific to this module.
Example: "All route handlers must call getContext() first — skipping it breaks tenancy isolation."

```
## Tool & Library Notes
```
Quirks of specific libraries/tools that aren't obvious from their documentation.
Example: "fastify-type-provider-zod requires z.object at the top level — z.union breaks serialization."

```
## Recurring Errors & Fixes
```
Errors that keep coming back, and their exact fix.
Example: "Error: Cannot find module '@devdigest/reviewer-core' — check tsconfig path alias, not node_modules."

```
## Session Notes
```
Context from specific sessions: what changed, why, what trade-offs were made.
Example: "2025-06-10: removed per-PR cost tracking — decision made to keep only model pricing for simplicity."

```
## Open Questions
```
Unresolved questions worth investigating in the future.
Example: "Is the map-reduce threshold of 400 lines optimal? No benchmarks yet."

## Entry format

```
[YYYY-MM-DD] Short actionable statement. file:line or function name if relevant.
```

Place each entry under its matching section.

## Quality gate — ask before every entry

**"Would this be obvious to anyone reading the code?"** → Yes: skip it.

**Bad** (do not write):
- `"Promises can be tricky"` — vague, not actionable
- `"be careful with async"` — noise

**Good** (write these):
- `"Promise.all() on the ingestion pipeline times out after 30 items — use Promise.allSettled() with batches of 10"` — actionable cold
- `"checkout state always goes through Zustand (cartStore.ts) because 3 components share the cart; local state breaks it"` — explains the why

## Rules

- **Append only.** Never overwrite. Correct with a dated note.
- **Skip trivial sessions** (quick config edits with no discoveries).
- **One precise entry beats five vague ones.**
- If the file grows beyond ~200 entries, split into domain files (INSIGHTS-Auth.md, INSIGHTS-Database.md).

## Monthly maintenance (human task, not automated)

- Updated a library → delete old quirk notes for it (stale = harmful advice)
- Contradictory entries ("always do X" / "X crashes here") → resolve explicitly with a dated note
- Entries that turned out wrong → don't delete, mark `[SUPERSEDED YYYY-MM-DD]` so history is preserved
- Version INSIGHTS.md in git so bad wrap-ups can be rolled back

## Reading confirmation (at session start)

Before starting work in a module, read its INSIGHTS.md and confirm:
> "I've read INSIGHTS.md. The 3 most relevant points for this task are: …"

This forces active processing, not silent loading, and is a sanity-check that the file was actually read.