# Промпт для створення скіла engineering-insights

---

Create a Claude Code skill called `engineering-insights`.

## What this skill does

When triggered, it captures non-obvious learnings from the current session and appends them to the `INSIGHTS.md` file of the module that was touched during the task. This is not a wrap-up summary — it is a structured knowledge capture that the next session in this module will read before starting work.

## Where to write

Determine which module was touched during this session and write to its `INSIGHTS.md`:

- `client/INSIGHTS.md`
- `server/INSIGHTS.md`
- `reviewer-core/INSIGHTS.md`

If multiple modules were touched — write to each one separately. Each module has its own file. Knowledge lives next to the code it describes; the next session in that module reads only its own insights, not others.

**Mode: append-only.** Only add new entries, never overwrite existing ones.

## INSIGHTS.md file structure

Every INSIGHTS.md must have exactly these 7 sections (create them if missing):

```markdown
## What Works
Approaches and solutions that worked.

## What Doesn't Work
Dead ends and antipatterns. (This section is skipped most often — it is the most valuable.)

## Codebase Patterns
Conventions and architectural decisions specific to this module.

## Tool & Library Notes
Quirks and gotchas of dependencies used in this module.

## Recurring Errors & Fixes
Repeated mistakes + the fix that resolved them.

## Session Notes
Datestamped session summaries.

## Open Questions
What remained unresolved.
```

## Quality standard for every entry

Each entry must be **actionable "cold"**: an agent reads it and immediately knows what to do — without chasing the context.

**Entry format:**
```
[YYYY-MM-DD] [Section] Short statement. Evidence or location if relevant (file:line or function name).
```

**Test before writing:** "Would this be obvious to anyone reading the code?" Yes → do not write it.

**Bad entries (do not write):**
- `"Promises can be tricky"` — noise, not a lesson
- `"be careful with async"` — vague, not actionable
- `"error handling needs improvement"` — restates the obvious

**Good entries (write these):**
- `"Promise.all() on the ingestion pipeline times out after 30 items — use Promise.allSettled() with batches of 10 for this module"`
- `"checkout state flow always goes through Zustand (cartStore.ts) because 3 components share the cart; local state does not work here"`
- `"Prisma Accelerate has a 5MB response limit — use select, not include"`

## When to trigger

**Dual trigger:**
1. **At the end of any task** (wrap-up) — after every meaningful session >30 min where there was a problem, solution, or discovery
2. **Capture as you go** — immediately when something non-obvious happens, without waiting for the end

**Skip the wrap-up when:** the session was only trivial config edits with no discoveries.

**Quality over volume.** One precise entry beats five vague ones.

On L01: trigger manually by calling `/engineering-insights`. Note: auto-triggering is unreliable at this stage — a Stop-hook will make capture automatic starting from L06.

## Closing the loop — add to CLAUDE.md

After creating the skill, add two lines to the project's `CLAUDE.md`:

**At the start (Session Context section):**
```
Before starting any work, read INSIGHTS.md for the module you are working in.
Treat it as high-confidence guidance unless told otherwise.
Confirm you have read it by summarizing the top 3 most relevant points.
```

**At the end (End of Session section):**
```
At the end of every meaningful session, run /engineering-insights to update INSIGHTS.md.
Do not skip this step.
```

## Skill file format

The skill file itself must be concise: 5–8 lines of instructions + a YAML header with name and description trigger. The description is the discovery interface — write it in third person, include both "what it does" and "when to use it".

```yaml
name: engineering-insights
description: >
  Captures non-obvious technical learnings from the current session
  and appends them to INSIGHTS.md of the touched module.
  Use at the end of any session where a problem was solved,
  a decision was made, or a non-obvious pattern was discovered.
```

## What NOT to do

- Do not overwrite existing entries — append only
- Do not write generic statements that would be obvious to any developer reading the code
- Do not write session replays or chat history — extract the insight, not the story
- Do not let the file grow beyond ~200 entries — split into domain files (INSIGHTS-Auth.md, INSIGHTS-Database.md) if needed
- Do not treat INSIGHTS.md as truth — it is a draft under spot-check review; the LLM can mis-summarize, so a human should periodically review entries
- Do not write mutable data (URLs, versions, credentials) — those belong in CLAUDE.md or .env

## Quality control (monthly)

- Updated a library → old quirk notes became noise or even harmful advice → delete them
- Contradictory entries ("always do X" vs "X crashes here") → resolve explicitly
- Version entries in git so the team can see the evolution of knowledge and roll back a bad wrap-up

---

## Additions from research (2026-06-26)

### Forced active reading at session start

Passive file loading is not enough — Claude may "load" without processing.
Force active reading at every session start:

> "Before we begin, confirm you've read INSIGHTS.md and summarize the top 3 most relevant points for today's work."

This is both a forcing function and a sanity-check that the file was actually read.
Already added to `CLAUDE.md` (Session Context section).

### Marking wrong entries instead of deleting

Do not delete entries that turned out to be wrong — they carry negative knowledge.
Instead mark them:

```
[SUPERSEDED 2026-06-26] Old statement that was wrong. Replaced by: correct statement.
```

This preserves the history so the team knows why something changed.

### Roadmap for automation

| Lesson | Trigger mechanism |
|---|---|
| L01 (now) | Manual — `/engineering-insights` |
| L06 | Stop-hook — automatic at every session end, no human action needed |

Rationale: *"If it requires a human trigger, it won't happen consistently enough to be useful."* (MindStudio)