# Eval harness concepts — quick explainer

A condensed answer to four recurring questions about the `evals/` package. For the full picture
(commands, env vars, CI wiring, statistics) see [`../README.md`](../README.md); this doc only
covers the conceptual "how does it work" layer.

## What `evals/` can do

It's a test harness for the quality of Claude Code **artifacts** — skills (`.claude/skills/*`),
subagents (`.claude/agents/*`), and workflow-level behavior (`CLAUDE.md` + on-disk config) — not a
test suite for product code. It runs real headless Claude Agent SDK sessions and scores the result
either deterministically (substring coverage) or with an LLM judge (binary PASS/FAIL per practice,
each requiring a verbatim evidence quote).

Three tiers, one below the other:

1. **Static gate** (`pnpm eval:quality`) — checks SKILL.md structure/frontmatter, no model call.
2. **Quality evals** — isolate one artifact's content and judge it (`skillTask` / `agentTask`).
3. **Workflow evals** — load the real on-disk harness and check systemic behavior: does a skill
   activate, does a subagent get dispatched, does `CLAUDE.md` change what gets read (`workflowTask`).

On top sit three statistical tools that all read the same `results/records.jsonl`: `eval:repeat`
(stability of one thing over N runs), `eval:delta` (diff two labeled repeat runs — the
before/after-an-edit workflow), and `eval:benchmark` (with-artifact vs without-artifact — measured
lift, not a feeling that a skill "seems to help").

## `skillTask` vs `workflowTask`

Defined in `evals/src/tasks.ts:1-9`. The difference is **where the configuration comes from**:

- **`skillTask`** (and `agentTask`) inject the artifact's content (SKILL.md + `references/*.md`,
  or the agent file) directly as the `systemPrompt`, and load **no** on-disk config
  (`settingSources: []`, `run-claude.ts:69-70`). The model sees only the artifact's text, isolated
  from the real CLAUDE.md, other skills, or the real repo tree. This measures the artifact's
  *content* in isolation — is the SKILL.md text itself clear and complete enough. It's also why
  `skillTask` runs with **no tools**: the case's prompt inlines a synthetic dataset standing in for
  what `Read`/`Bash`/`Grep` would normally gather (see the comment at the top of
  `evals/skills/dependency-checker/dependency-checker.cases.ts:3-6`).

- **`workflowTask`** loads the **real** harness (`settingSources: ["project"]`) — actual
  `CLAUDE.md`, actual project skills/agents on disk — and hands the model a read-only tool
  allow-list (`Read, Grep, Glob, Task, Agent, Skill`, `config.ts:24`). This is the *systemic* tier:
  does the model decide on its own to activate the right skill for a prompt, dispatch the right
  subagent, actually read `CLAUDE.md`. A content-only eval can't observe any of that. `WorkflowCase`
  even has a `"contrast"` kind that runs the same prompt twice — once against the real repo, once
  in an empty tmpdir with no config — to isolate exactly what CLAUDE.md/the skill contributed.

In short: `skillTask` asks "is this SKILL.md well written"; `workflowTask` asks "does the system as
a whole behave correctly with this SKILL.md sitting in the project."

## What `*.cases.ts` is

The data file for a set of test scenarios — an array of `SkillCase` / `AgentCase` / `WorkflowCase`
objects (types in `evals/src/dsl/case.ts:23-69`). Each case carries a prompt, the practices the
judge should check for (`practices`), an optional deterministic "grounding" gate (required
substrings, `grounding`), a pass threshold, and a turn limit.

The paired `*.eval.ts` is a thin wrapper — it just hands the cases to
`runSkillCases`/`runAgentCases`/`runWorkflowCases`:

```ts
import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./dependency-checker.cases.js";

describeSkill("dependency-checker", () => runSkillCases("dependency-checker", cases));
```

The split is deliberate: `dsl/case.ts` owns the single measure → record → assert loop (model call
+ scorers in a `try`, `record()` in `finally`, `expect` strictly after) so case authors never
reimplement that logic — `*.cases.ts` is pure data/fixtures for one artifact.

Scoring is two-tier (`case.ts:94-107`): the cheap `patternMatch` grounding gate runs first (must
equal `1.0`, i.e. every required substring present) and, only if it passes, the more expensive
`llmJudge` runs and scores each practice independently with a verbatim-quote requirement.

## Why the API key is stripped from the environment

`evals/src/runtime/env.ts:17-19, 38-39`. The Claude Agent SDK prioritizes an `ANTHROPIC_API_KEY` /
`ANTHROPIC_AUTH_TOKEN` in the environment over the Claude Code subscription login, if either is
present. Without stripping them, every eval run would silently bill per-token API usage instead of
riding the subscription. `subscriptionEnv()` copies `process.env` and deletes both variables
before handing it to the SDK's child process, guaranteeing every default-backend run goes through
the subscription for free.

The one exception is `EVAL_BACKEND=openrouter`: there the key isn't deleted, it's *replaced* —
`ANTHROPIC_AUTH_TOKEN` becomes the OpenRouter key and `ANTHROPIC_BASE_URL` points at OpenRouter (or
a local LiteLLM proxy), so the SDK still speaks the Anthropic wire protocol but the inference is
routed elsewhere. This lets the same eval cases run against cheap non-Anthropic models without any
test code changes.
