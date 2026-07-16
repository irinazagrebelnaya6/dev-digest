---
name: Export to CI
description: Let a maintainer export a configured DevDigest agent into a target repository's GitHub Actions workflow (via a 4-step wizard that opens a PR), and surface the resulting CI runs back in the studio.
---

# Spec: Export to CI  |  Spec ID: SPEC-06  |  Status: draft
Supersedes: none

## Problem & why
Today a DevDigest agent only runs locally in the studio — a maintainer cannot make it
review PRs automatically in a real repository. "Export to CI" closes that gap: a wizard
generates a self-contained agent manifest + a GitHub Actions workflow (plus the bundled
`agent-runner`), opens a PR against the target repo on a `devdigest/ci` branch, and the
agent then reviews every PR in that repo. The studio then shows those CI runs (`source='ci'`)
so the maintainer can track findings, cost, and status across every repository the agent is
installed in. Most of the machinery already exists (schema, shared Zod contracts, the
`agent-runner` package, GitHub commit/PR adapter methods); this feature builds the **studio
side** that generates the artifacts, opens the PR, records installations, and displays runs.

## Goals / Non-goals
- **Goals:**
  - A 4-step Export Wizard (**Target → Preview → Configure → Install**) reachable from an
    **"Add to CI" / "+ Add repository"** action on a new **CI tab** of the Agent editor.
  - A new server `ci` module (`server/src/modules/ci/`) that: generates the deterministic
    artifact bundle, validates the agent manifest against the shared `AgentManifest` Zod
    contract, records `ci_installations` (1 agent → N repos), opens a PR via the existing
    GitHub adapter, and reads back `ci_runs`.
  - A **CI tab** on the agent page listing installations per repository (Repository ·
    Platform · Status · Last run) plus a **Fail CI on** severity selector that, when changed,
    regenerates the manifest and opens a fresh `devdigest/ci` PR.
  - A new **CI Runs** page: table (Repository · Agent · Status · Findings · Cost · Duration ·
    Job link) with Repository/Agent filters, showing runs with `source='ci'`.
  - Enforce the workflow security contract: `permissions: contents:read + pull-requests:write`
    only, `OPENROUTER_API_KEY` sourced from repo Secrets (never inlined), and fork PRs run
    without the secret (analysis degraded or skipped, never leaking the key).
- **Non-goals:**
  - Building or modifying the `agent-runner` package — the CI-side runner already exists and
    is unchanged by this feature (it only **reads** the manifest this feature writes).
  - Adding new DB tables or migrations — `ci_installations`, `ci_runs`, and `agent_runs.source`
    already exist from migration 0000 (columns-only; see `## Design & contracts`).
  - Touching the multi-agent run service, the review PR/SSE stream, or the local review path —
    all export/CI logic stays inside `server/src/modules/ci/` (+ thin agent-editor wiring).
  - Configuring GitHub branch protection automatically (documented as a manual maintainer step).
  - Full CircleCI / Jenkins / Generic CLI generation — see Open questions Q7 (GitHub Actions is
    the only target the `agent-runner` supports today).

## User stories
- As a **maintainer**, I want to export a configured agent into a repo's GitHub Actions, so that
  it reviews every PR automatically without me running it locally.
- As a **maintainer**, I want the wizard to open a single reviewable PR with all the CI files,
  so that I can inspect and merge the integration through my normal review flow.
- As a **maintainer**, I want to install one agent across several repositories and see all their
  CI runs (status, findings, cost) in one place, so that I can monitor coverage centrally.
- As a **security-conscious maintainer**, I want the generated workflow to request minimal
  permissions and keep my API key in Secrets, and I want fork PRs never to receive that key.
- As a **maintainer**, I want to change the "Fail CI on" severity, so that the CI gate blocks
  merges at the threshold I choose.

## Acceptance criteria (EARS)
- **AC-1** — WHEN a maintainer opens an agent's **CI tab** and clicks **"Add to CI"**, the system
  shall launch the Export Wizard showing all four steps (Target, Preview, Configure, Install).
  _(verify: component (`*.test.tsx`) — wizard mounts with 4 navigable steps; e2e — button opens wizard)_
- **AC-2** — WHERE the selected target is **GitHub Actions**, the Preview step shall render the full
  editable artifact set: `.devdigest/agents/<agent-slug>.yaml` (manifest), one
  `.devdigest/skills/<slug>.md` per linked skill, `.devdigest/memory.jsonl`, and
  `.github/workflows/devdigest-review.yml` marked **editable**. _(verify: component — Preview lists
  each artifact path with its contents; the workflow entry is flagged editable)_
- **AC-3** — WHEN the manifest artifact is generated, the system shall produce a document that
  validates against the shared `AgentManifest` Zod contract (`name`, `provider`, `model`,
  `system_prompt`, `skills[]` as slugs, `strategy`, `ci_fail_on`) — the **same** contract the
  `agent-runner` parses at CI time. _(verify: unit — generated YAML parsed by `AgentManifest.safeParse` succeeds; a tampered field fails)_
- **AC-4** — WHEN the workflow file is generated, it shall declare `permissions:` limited to
  `contents: read` and `pull-requests: write` and shall reference `OPENROUTER_API_KEY` only via
  `${{ secrets.OPENROUTER_API_KEY }}` (never an inlined key value). _(verify: unit — generated YAML
  asserts exactly those two permissions and no literal key; snapshot check)_
- **AC-5** — WHEN the workflow file is generated, its `on: pull_request` trigger shall always include
  `opened` and `synchronize`, and shall include `reopened` only when the maintainer enabled it in
  Configure. _(verify: unit — default triggers contain opened+synchronize; toggling reopened adds/removes it)_
- **AC-6** — WHERE a pull_request originates from a **fork**, the generated workflow shall ensure the
  review job runs **without** `OPENROUTER_API_KEY` available (secret withheld), so the key never
  reaches fork-triggered runs. _(verify: unit — generated YAML gates the secret/job on
  `head.repo.fork == false` (or equivalent), asserted against a fork-context fixture; manual — fork PR shows no key)_
- **AC-7** — WHEN the maintainer chooses **"Open a PR with these files"** in Install and confirms,
  the system shall commit **all** generated artifacts as **one atomic commit** on branch
  `devdigest/ci` (created from the chosen base) and open a pull request titled for the DevDigest CI
  integration, returning the PR URL. _(verify: integration (`*.it.test.ts`) — `POST /agents/:id/export-ci`
  with `action:'open_pr'` calls the GitHub adapter's `commitFiles` once with the full file set + `openPullRequest`, and returns a non-null `pr_url`)_
- **AC-8** — WHEN a maintainer chooses **"Copy files as a zip"** (degraded path), the system shall
  provide the same artifact set as a downloadable bundle **without** any GitHub write. _(verify:
  integration — `action:'files'` returns the files and performs zero GitHub adapter calls)_
- **AC-9** — WHEN an export completes (either action), the system shall persist a `ci_installations`
  row (`agent_id`, `repo`, `target_type`) so one agent can hold **many** installations across
  distinct repositories. _(verify: integration — exporting the same agent to two repos yields two rows;
  re-exporting to the same repo does not create a conflicting duplicate — see Q6)_
- **AC-10** — The agent **CI tab** shall list every installation for that agent as a row of
  Repository · Platform · Status · Last run, and shall expose a **"+ Add repository"** action that
  launches the wizard. _(verify: component — rows render from the installations payload; button opens wizard;
  integration — `GET /agents/:id/ci/installations` returns the agent's rows)_
- **AC-11** — The agent **CI tab** shall render a **CI Runs** table of the latest runs for that agent
  (from `ci_runs` joined to the agent's installations). _(verify: integration — endpoint returns only
  runs tied to this agent's installations; component — table renders the rows)_
- **AC-12** — The **CI Runs** page shall render a table of Repository · Agent · Status · Findings ·
  Cost · Duration · Job link for runs with `source='ci'`, filterable by Repository and by Agent.
  _(verify: integration — `GET /ci/runs` returns only `source='ci'` rows; applying a repo/agent filter narrows the set;
  component — filters update the visible rows)_
- **AC-13** — WHEN the maintainer changes the **Fail CI on** severity (`never|critical|warning|any`,
  default `critical`) for an installation and confirms, the system shall regenerate the manifest with
  the new `ci_fail_on` and open a fresh `devdigest/ci` PR carrying it. _(verify: integration — changing
  the severity produces a manifest whose `ci_fail_on` matches and triggers a new export/PR)_
- **AC-14** — The system shall scope every CI read/write to the caller's workspace via `getContext()`;
  IF the referenced agent or installation does not belong to the caller's workspace, THEN the system
  shall respond not-found. _(verify: integration — a cross-workspace agent id on any `/agents/:id/ci/*`
  or `/ci/*` route returns the standard not-found `AppError`)_
- **AC-15** — WHEN the target repository slug is submitted, the system shall accept only a well-formed
  `owner/name` value and reject anything else with a validation error (422), never passing raw input
  into git/GitHub calls unchecked. _(verify: unit — the export input schema rejects `../evil`, empty,
  and shell-metacharacter slugs; integration — malformed slug → 422)_
- **AC-16** — IF opening the PR fails (GitHub error, missing token, permission denied), THEN the system
  shall surface a clear error and shall **not** leave a partial/dangling installation implying success.
  _(verify: integration — a GitHub adapter that throws on `openPullRequest` yields an error response and no
  "succeeded" installation state)_
- **AC-17** — The generated artifact bundle shall include the bundled runner
  (`.devdigest/runner/index.js`) that the workflow invokes, so the exported PR is self-executing in the
  target repo's CI. _(verify: unit — the generated file set contains the runner bundle path and the
  workflow references `node .devdigest/runner/index.js`; see Q3)_
- **AC-18** — WHEN Configure shows **Secrets expected**, it shall present `OPENROUTER_API_KEY` with a
  set/not-set indicator and `GITHUB_TOKEN` marked as auto-provided by Actions. _(verify: component —
  both secrets render with the correct status labels)_
- **AC-19** — WHEN Configure shows **Post results as**, the choice (`github_review` |
  `pr_comment` | `none`) shall be written into the export so the runner posts accordingly, defaulting to
  `github_review`. _(verify: unit — the chosen `post_as` flows into the generated workflow/manifest input;
  integration — the export input default is `github_review`)_
- **AC-20** — All export/CI server logic shall live within `server/src/modules/ci/` (plus a thin
  `export-ci` entry surfaced on the agents module) and shall not modify the multi-agent run service,
  the review SSE stream, or the local review executor. _(verify: manual/architecture review — new source
  is confined to `modules/ci/`; no diff to `reviews/run-executor.ts` multi-run or SSE code)_

## Edge cases
- **Agent with zero linked skills** — manifest `skills: []`; no `.devdigest/skills/*.md` files emitted; export still valid.
- **`devdigest/ci` branch / PR already exists** — re-publish reuses the open PR (adapter `findOpenPr`) and adds a commit rather than erroring (idempotent re-export; ties to Q6).
- **Missing `GITHUB_TOKEN` in the studio** — export via "Open a PR" fails clearly (AC-16); "Copy as zip" still works (no GitHub call).
- **Empty `memory.jsonl`** — on the lab the memory store is empty; the file is emitted empty (wizard uses whatever DevDigest currently holds).
- **Fork PR at CI runtime** — job runs without the key: either skipped or degraded, never leaking the secret (AC-6).
- **Malformed / injection-shaped repo slug** — rejected at validation (AC-15).
- **No installations yet** — CI tab and CI Runs page render an empty state, not an error.
- **CI run artifact absent / not yet ingested** — installation shows `pending`/no last run; runs table simply omits it (depends on Q1).
- **Non-GHA target selected** — behaviour undefined until Q7 is resolved (GHA is the only runner-supported target).

## Non-functional
- **Security / secrets:** the generated workflow must never inline `OPENROUTER_API_KEY` — only
  `${{ secrets.OPENROUTER_API_KEY }}` (AC-4); fork PRs must not receive it (AC-6); `GITHUB_TOKEN`
  is the Actions-provided token. The studio's own `GITHUB_TOKEN` (used to open the PR) flows through
  the existing `SecretsProvider` chokepoint — this feature reads no secret directly.
- **Security / tenancy:** every route is workspace-scoped via `getContext()` (AC-14).
- **Untrusted input:** the target repo slug is user-controlled and must be validated, never
  interpolated raw into git refs, commit content, or the workflow (AC-15). PR body/diff/comments at
  CI runtime are untrusted, but that is handled inside the already-built `agent-runner`
  (`wrapUntrusted` + `INJECTION_GUARD`); this feature must not add any keyword/text-trigger logic.
- **Abuse cases:** (a) a crafted repo slug attempting path traversal or command injection → rejected
  by AC-15; (b) a fork PR author trying to exfiltrate the review key → prevented by AC-6; (c) a
  malicious PR comment/body trying to steer or descope the review → neutralised by the runner's
  injection guard (out of this spec's build, but relied upon); (d) partial-failure masquerading as
  success → prevented by AC-16.
- **a11y:** wizard steps and the Fail-CI-on selector must be keyboard-navigable and labelled;
  status must not be conveyed by color alone (pair with text). Flagged for the UI track.

## Design & contracts
**Reuse — nothing new is invented.** The schema and contracts are pre-created:

- **Schema (columns only; migration 0000):**
  - `ci_installations { id, agent_id → agents (cascade), repo, target_type ∈ [gha,circle,jenkins,cli], installed_at }`
  - `ci_runs { id, ci_installation_id → ci_installations (set null), pr_number, ran_at, status, findings_count, cost_usd, github_url, source }`
  - `agent_runs.source ∈ ['local','ci']` (default `local`).
  - **NOTE / discrepancy with the request:** the request asked to add `ci_installation_id`,
    `github_job_url`, `github_pr_number` **columns to `agent_runs`**. The pre-created schema instead
    models CI runs in the dedicated **`ci_runs`** table (which already holds `ci_installation_id`,
    `github_url`, `pr_number`). This spec grounds on `ci_runs`; adding those columns to `agent_runs`
    would violate the columns-only / no-new-schema constraint and duplicate existing fields. See Q2.
- **Shared Zod contracts (`vendor/shared/contracts/eval-ci.ts`, both vendor copies must stay in sync):**
  `CiTarget`, `CiFile { path, contents, editable }`, `AgentManifest` (the studio↔runner contract),
  `CiExportInput { repo, target, action, post_as, triggers, base }`, `CiInstallation`,
  `CiExport { installation, files[], pr_url }`, `CiRun`, `CiResultArtifact`, `CiRunStatus`. `CiFailOn`
  (`never|critical|warning|any`) already lives on the agent (`knowledge.ts`) and the manifest.
- **GitHub adapter (already present + mocked):** `commitFiles` (atomic blobs→tree→commit→ref),
  `openPullRequest`, `findOpenPr`, `postReview`. No new adapter methods needed for the *export* path.
- **New server module** `server/src/modules/ci/` (register per the 2-step module convention): routes
  `POST /agents/:id/export-ci`, `GET /agents/:id/ci/installations`, `GET /agents/:id/ci/runs`,
  `GET /ci/runs` (workspace-wide, filterable) — plus deterministic **manifest** and **workflow**
  generators (pure, zero LLM). Add a `ciRepo` lazy getter to the container + `CiInstallationRow`/`CiRunRow`
  to `db/rows.ts` (columns-only).
- **Client:** a new **CI tab** in `client/src/app/agents/[id]/_components/AgentEditor` (register in
  `TABS` + `VALID_TABS`), an Export Wizard component, and a new **CI Runs** page/route under
  `client/src/app/` — all data via `src/lib/api.ts` + TanStack Query.

**Contract note (api-contract-reviewer):** this feature only **adds** routes and consumes
already-defined shared contracts — no existing response shape changes, so the change is
**additive / non-breaking**. Any edit to `eval-ci.ts` (if fields are needed) must be mirrored in both
vendor copies and flagged to the planner.

## Inputs (provenance)
- Agent config (name, provider, model, system prompt, strategy, `ci_fail_on`): **[reused: agents table]**.
- Linked skill bodies → `.devdigest/skills/<slug>.md`: **[reused: skills table via agent_skills]**.
- `.devdigest/memory.jsonl`: **[reused: memory store (L07)]** — empty on the lab; whatever DevDigest holds.
- Manifest + workflow files: **[deterministic: pure generators, zero LLM]** — validated by `AgentManifest`.
- Bundled runner `.devdigest/runner/index.js`: **[reused: agent-runner `dist/index.js`]** (see Q3).
- Installation record: **[new row: `ci_installations`]** (columns-only).
- CI runs shown in the studio: **[ingested: `ci_runs`, `source='ci'`]** — from GitHub CI artifacts
  (`CiResultArtifact`); ingestion mechanism is Q1.
- PR open / atomic commit: **[reused: GitHubClient `commitFiles` / `openPullRequest`]**.

## Untrusted inputs
- **Target repo slug** (`owner/name`) — user-controlled; validated to a strict `owner/name` shape and
  never interpolated raw into git refs, commit content, or the workflow (AC-15).
- **Edited workflow text** — the maintainer may edit the workflow in Preview; treated as data the
  system re-validates for the security invariants (permissions, no inlined secret) before export.
- **PR body / diff / comments at CI runtime** — untrusted, but handled by the already-built
  `agent-runner` (`wrapUntrusted` + `INJECTION_GUARD`); this feature adds no text-trigger logic.
- No secrets are read directly by this feature; the studio's `GITHUB_TOKEN` flows through the
  existing `SecretsProvider`.

## Answers to clarification questions

**Q1 (RESOLVED):** CI runs are ingested via new GitHub adapter method(s) that fetch Actions artifacts.
The studio will pull `devdigest-result.json` (`CiResultArtifact`) from completed workflow runs and
persist them into `ci_runs`. (Option a — new adapter methods for Actions artifacts.)

**Q2 (RESOLVED):** We ground on the existing `ci_runs` table. We do **NOT** add columns to `agent_runs`.
The `ci_runs` table already carries `ci_installation_id`, `github_url`, and `pr_number` — these are
sufficient and maintain the no-new-schema rule.

**[NEEDS CLARIFICATION — Q3]:** Confirm the exported commit includes the bundled runner
`.devdigest/runner/index.js` — i.e. the file set is manifest + N skill files + `memory.jsonl` +
workflow + runner bundle. (The request said "5 files"; the exact count depends on the skill count.)

**[NEEDS CLARIFICATION — Q4]:** "Fail CI on" — confirm the gate is driven by the manifest's `ci_fail_on`
(runner exits non-zero) and changing it regenerates the manifest → new PR (AC-13), with the workflow
YAML unchanged.

**[NEEDS CLARIFICATION — Q5]:** Confirm the single shared Zod contract is `AgentManifest` (studio↔runner),
and the workflow YAML is validated by assertion/snapshot, not by a Zod schema.

**[NEEDS CLARIFICATION — Q6]:** Re-export to an already-installed repo — upsert the `ci_installations`
row or insert new? Reuse the open `devdigest/ci` PR via `findOpenPr` or open a fresh one?

**[NEEDS CLARIFICATION — Q7]:** Are CircleCI / Jenkins / Generic CLI real targets in this lab, or is only
GitHub Actions generated (others shown as "coming soon"/disabled)?

**[NEEDS CLARIFICATION — Q8 (non-blocking)]:** Is the "Copy files as a zip" bundle assembled server-side
or client-side? (server INSIGHTS notes the manual ZIP parser only handles store-compressed entries.)
