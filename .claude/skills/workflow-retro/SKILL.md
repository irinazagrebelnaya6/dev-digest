---
name: workflow-retro
description: After a multi-agent run (the SDD pipeline — spec-creator → implementation-planner → implementer(s) → test-writer → architecture-reviewer → plan-verifier, plus nested researchers), analyze how it actually went — tokens (in/out/cache-read), cache-hit, tool-calls, durations, parallelism (incl. nested subagents the parent usage omits) — surface insights + concrete tuning actions, and append a trend row to docs/retros/ledger.md. Run manually with /workflow-retro; no hook.
---

# /workflow-retro — retrospective of a multi-agent run

Run this **manually** after a run worth dissecting. It answers: where did the tokens/time
go, what duplicated, what did we miss — and what to change next time. It is the first
touch of **observability** (L07) and **cost-engineering** (L08); its deep-mode token totals
are the input for the cost-report. No hook — you decide when a run is worth a retro.

Written output is **English** (repo convention).

---

## Step 1 — Choose a mode and collect per-agent metrics

Every subagent this session returned a `<usage>` block: `subagent_tokens`, `tool_uses`,
`duration_ms`. That is the cheap signal — but it **undercounts**:

> ⚠️ A parent agent's `<usage>` does **not** include the usage of subagents it itself
> spawned (e.g. an `implementer` or `spec-creator` that spawned a `researcher`). In-context
> totals therefore under-report — sometimes badly, for deep trees.

- **In-context mode (fast, default):** sum the `<usage>` blocks visible in this
  conversation + the parent's own usage. Flag it as a *lower bound* and name which agents
  have hidden nested children.
- **Deep mode (accurate — use when cost matters):** read each agent's on-disk transcript.
  Every async/background agent's transcript path is the `output-file` from its
  `task-notification` — a JSONL file at `<session-tmp>/tasks/<agentId>.output` (the
  `<session-tmp>` is the scratchpad's parent session dir). Parse the JSONL usage events to
  sum **input / output / cache-read tokens**, tool calls, and durations, **including nested
  subagents** the parent omitted. (If the run was driven by the `Workflow` tool instead of
  individual `Agent` calls, read `<transcriptDir>/journal.jsonl` + `agent-*.jsonl`.)
  Do **not** `Read` a `.output` symlink into context blindly — it can be a huge transcript;
  grep/parse for the usage lines with a Bash tool instead.

For each agent capture: **label/role · model · input · output · cache-read · cache-hit% ·
tool_calls · duration_ms · ran-in-parallel-with**.

## Step 2 — Aggregate

- **Totals:** input / output / cache-read tokens; total tool_calls.
- **Time:** wall-clock (first start → last finish) vs. summed agent duration → a
  **parallelism factor** (summed ÷ wall-clock).
- **Cache-hit rate** overall and per agent.
- **Cost estimate:** tokens × model price (load the `claude-api` skill for current pricing).
  Remember the tiering: reviewers (`architecture-reviewer`, `plan-verifier`) on **Sonnet**,
  authoring (`spec-creator`, `implementation-planner`) on **Opus**, `implementer`/`test-writer`
  on **Sonnet**.

Present a per-agent table sorted by output tokens (or cost), with a totals row.

## Step 3 — Insights → concrete actions

Read the run for:
- **Hard / retried work** — agents that looped, re-read files, or errored (visible as high
  tool_calls or long duration relative to output).
- **Context duplication** — the same file read by several agents → **pre-fetch once** and
  pass the path/summary into their briefs instead.
- **Late misses** — anything caught only in the fix loop or the `pr-self-review` gate that a
  sharper agent brief or an earlier reviewer would have caught.

Turn each into a **specific action**, e.g.: *tighten `implementer`'s brief to X · pre-fetch
`vendor/shared/*` and inject it · merge two agents whose scopes overlap · split an
overloaded agent · raise/lower concurrency · move an agent's model tier*.

## Step 4 — Append a trend row (the ledger)

Append **one line** to `docs/retros/ledger.md` (create the file with this header if missing)
so runs are comparable over time:

```markdown
# Workflow retro ledger
| Date | Run | Agents | In (k) | Out (k) | Cache-read (k) | Cache-hit% | Wall-clock | Parallelism | Est. cost | Top action |
|------|-----|--------|--------|---------|----------------|-----------|-----------|-------------|-----------|------------|
```

One row per run. Convert relative dates to absolute (YYYY-MM-DD). Keep it terse — it's a
trend line, not a report.

## Output

A short report: the per-agent table + totals, cache-hit, parallelism factor, estimated cost,
the top 3 insights→actions, whether the numbers are in-context (lower bound) or deep, and
confirmation of the ledger row appended.

## Notes
- **Manual only** — no hook; run it when a run is worth analyzing.
- In-context ≈ quick gut-check; **deep mode** is the one that feeds cost-engineering.
- Bridges to L07 (observability) and L08 (cost-engineering); the deep token totals are the
  cost-report input.
