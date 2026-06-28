    

---
name: lesson-3-conventions-extractor
description: Conventions Extractor + API Contract Reviewer agent with skills (Lesson 3)
---

# Plan: Conventions Extractor + API Contract Reviewer

## Context

- `conventions` table already exists in DB schema (`server/src/db/schema/knowledge.ts:31`)
- `repoIntel.getConventionSamples(repoId, n)` already implemented — returns top-N ranked file paths
- Skills CRUD + agent linking implemented in Lesson 2
- Goal: full pipeline from "scan repo" to "linked skill on agent"

---




## Part A — Conventions Extractor

### Step 1 — Server: extend conventions table + add category/status columns

**Files:** `server/src/db/schema/knowledge.ts`, migration

Current `conventions` columns: `id, workspaceId, repoId, rule, evidencePath, evidenceSnippet, confidence, accepted`

Missing columns needed for the feature:
- `category` (text) — e.g. "naming", "error-handling", "imports", "testing"
- `status` (enum `'pending' | 'accepted' | 'rejected'`) — replaces boolean `accepted`
- `evidenceLine` (int) — line number within evidencePath (for GitHub link)
- `extractionRunId` (uuid, nullable) — groups candidates from one extraction run

**Verification:**
- [ ] `pnpm db:migrate` runs wit/hout error
- [ ] `accepted` boolean column dropped or coerced to new status enum (migration idempotent)

---

### Step 2 — Server: ConventionsRepository + ConventionsService

**Files:**
- `server/src/modules/conventions/repository.ts`
- `server/src/modules/conventions/service.ts`
- `server/src/modules/conventions/helpers.ts`
- `server/src/platform/container.ts` (add `conventionsRepo` lazy getter)

**Repository methods:**
- `listByRepo(workspaceId, repoId)` — all candidates, ordered by confidence DESC
- `listPending(workspaceId, repoId)` — status = 'pending'
- `insertBatch(rows[])` — bulk insert, returns inserted rows
- `updateStatus(workspaceId, id, status)` — accept / reject one candidate
- `deleteByRunId(runId)` — clear a previous extraction run before re-run
- `getById(workspaceId, id)`

**Service:** thin orchestration, no business logic directly in routes.

**Verification:**
- [ ] Unit tests in `test/conventions.test.ts` (mock DB via ContainerOverrides)
- [ ] `container.conventionsRepo` accessible, no `new ConventionsRepository()` in service

---

### Step 3 — Server: extraction pipeline POST /repos/:id/conventions/extract

**File:** `server/src/modules/conventions/routes.ts`

**Pipeline (no model in this step — pure code):**
1. Load config files: `eslint.config.*`, `.eslintrc.*`, `tsconfig*.json`, `prettier.config.*`, `.prettierrc`
2. Call `container.repoIntel.getConventionSamples(repoId, 12)` → top-12 file paths
3. Read file contents (via `container.git` or direct FS if cloned)
4. Build a single prompt: config snippets + file samples → ask cheap model for candidates
5. Model returns `{ category, rule, evidencePath, evidenceLine, confidence }[]`
6. **Grounding / evidence check (pure code, no model):**
   - Does `evidencePath` exist in the repo file list? → drop if not
   - Does the file contain `evidenceSnippet` (or the line at `evidenceLine`)? → drop if not
   - Candidates with `confidence < 0.5` → drop
7. `insertBatch()` the survivors, return `{ runId, total, kept, dropped }`

**Model choice:** use the cheapest configured model (`settings.featureModels.conventions` or fallback to `haiku`/`gpt-4o-mini`)

**Route schema (Zod):**
```ts
params: z.object({ id: z.string().uuid() })
body:   z.object({ force: z.boolean().optional() })  // force=true clears previous run
reply:  z.object({ runId, total, kept, dropped, candidates: ConventionCandidate[] })
```

**Verification:**
- [ ] Route registered in `modules/index.ts`
- [ ] Returns 400 if repo has no file index (repo-intel not synced)
- [ ] Evidence check drops at least 1 fictional path in a unit test
- [ ] `pnpm test` still 129+ passing

---

### Step 4 — Server: accept/reject + skill generation routes

**Routes to add:**
```
PATCH  /conventions/:id          body: { status: 'accepted' | 'rejected' }
GET    /repos/:id/conventions    list all candidates for a repo
POST   /repos/:id/conventions/build-skill  body: { agentId? }
```

**`build-skill` logic:**
1. Fetch all `status='accepted'` candidates for repoId
2. Render them as a markdown skill body:
   ```md
   # repo-conventions
   ## Naming
   - Rule: …  (evidence: src/foo.ts:12)
   ## Error Handling
   - Rule: …
   ```
3. `upsert` a skill named `repo-conventions` (source: `extracted`)
4. If `agentId` provided → call `agentsRepo.setSkillLinks(agentId, [skillId])`
5. Return `{ skill, linked: boolean }`

**Verification:**
- [ ] Rejected candidates do NOT appear in generated skill body
- [ ] Each candidate line includes `evidence: path:line`
- [ ] Skill `source` = `'extracted'` (immutable after creation per INSIGHTS)

---

### Step 5 — Client: Conventions Extractor page `/repos/:repoId/conventions`

**Files:**
- `client/src/app/repos/[repoId]/conventions/page.tsx`
- `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/`
  - `ConventionsView.tsx` — main layout
  - `CandidateCard.tsx` — single candidate with Accept/Reject buttons
  - `BuildSkillModal.tsx` — confirm + pick agent to link
- `client/src/lib/hooks/conventions.ts`
  - `useConventions(repoId)`
  - `useExtractConventions(repoId)`
  - `useUpdateCandidateStatus()`
  - `useBuildConventionsSkill(repoId)`

**UI flow:**
1. Empty state → "Run Extractor" button → `POST /repos/:id/conventions/extract`
2. Spinner while running (SSE or poll)
3. Card grid: each card shows category badge, rule text, evidence link (GitHub URL), confidence bar
4. Accept ✓ / Reject ✗ buttons per card
5. "Build skill from accepted" button → `BuildSkillModal`
6. Modal lets user pick an agent to link, confirm → `POST /repos/:id/conventions/build-skill`

**Evidence link format:**
```
https://github.com/{owner}/{repo}/blob/{branch}/{evidencePath}#L{evidenceLine}
```
Built from `repo.full_name` + `repo.default_branch` + candidate fields.

**Verification:**
- [ ] Clicking evidence link opens GitHub at the correct line
- [ ] Rejected candidates are visually struck-through or hidden (user choice via toggle)
- [ ] "Build skill" button disabled when 0 accepted candidates
- [ ] `error.tsx` added to conventions route
- [ ] `pnpm test` client 21+ passing

---

### Step 6 — Nav: add Conventions to sidebar

**File:** `client/src/vendor/ui/nav.ts`

Add to WORKSPACE group:
```ts
{ key: "conventions", label: "Conventions", icon: "ListChecks", href: "/repos/:repoId/conventions", gKey: "v" }
```

**Verification:**
- [ ] Active state highlights correctly when on `/repos/.../conventions`
- [ ] `activeKeyFor()` in helpers.ts returns `"conventions"` for that path

---

## Part B — API Contract Reviewer

### Step 7 — Write 4 skills as markdown files

Create under `.claude/skills/api-contract-reviewer/`:

**`breaking-change.md`**
- Detects: removal of required fields, renamed fields, removed endpoints, changed HTTP method
- Good/bad examples with before/after

**`response-schema.md`**
- Detects: field type changes (string→number), optional→required, new required fields, deleted fields
- Good/bad examples

**`semver-discipline.md`**
- Detects: breaking changes without major version bump in package.json/openapi version field
- Good/bad examples

**`deprecation-policy.md`**
- Detects: silent deletion instead of `@deprecated` annotation or `Deprecation` header
- Good/bad examples

Each skill file: frontmatter `name`, `description`, `type: convention`, then directive rules + good/bad pairs.

**Verification:**
- [ ] All 4 files parse correctly via `parseSkillMarkdown()`
- [ ] Each has at least 2 good/bad examples
- [ ] `type:` is a valid `SkillType` value

---

### Step 8 — Create API Contract Reviewer agent via UI

**Manual steps (UI):**
1. Go to `/agents` → Create agent
2. Name: `API Contract Reviewer`
3. System prompt: focused on API contract stability, breaking changes, semver
4. Model: pick available model
5. Go to Skills tab → Add skills:
   - `breaking-change` — create via "Create skill" form
   - `response-schema` — create via "Create skill" form
   - `semver-discipline` — **import via file** (covers the import path again)
   - `deprecation-policy` — create via "Create skill" form

**Verification:**
- [ ] Agent appears in `/agents` list
- [ ] Skills tab shows 4 linked skills in correct order
- [ ] `semver-discipline` has `source: 'community'` (imported)

---

### Step 9 — Experiment: run agent with and without skills

**Setup:** Create or find a PR that:
- Renames a response field (e.g. `user_id` → `userId`)
- Or removes an optional field
- Or changes a route path

**Run 1 — without skills:**
- Temporarily unlink all skills from the agent
- Run review on the PR
- Screenshot / record: agent misses or only vaguely mentions the breaking change

**Run 2 — with skills:**
- Re-link all 4 skills
- Run review on the same PR
- Screenshot / record: agent flags the breaking change with specific rule citation from the skill

**Verification:**
- [ ] Run 1 log shows no `[skill]` lines (0 skills loaded)
- [ ] Run 2 log shows `Loaded 4 skill(s): breaking-change, response-schema, …`
- [ ] Run 2 finding cites the skill rule by name

---

## Optional / Bonus

### Step 10 — Import skill from URL

Add to `ImportSkillModal.tsx`:
- New tab "From URL" alongside "From file"
- Input: raw GitHub URL to a `.md` skill file
- `fetch()` the URL → `parseSkillMarkdown()` → prefill form fields

**Verification:**
- [ ] Valid GitHub raw URL → prefills name/type/body
- [ ] Invalid URL → shows error message
- [ ] Same trust warning shown as file import

---

### Step 11 — Claude Code plugin packaging

Create `plugin.json` at repo root:
```json
{
  "name": "api-contract-reviewer-skills",
  "version": "1.0.0",
  "skills": [
    ".claude/skills/api-contract-reviewer/breaking-change.md",
    ".claude/skills/api-contract-reviewer/response-schema.md",
    ".claude/skills/api-contract-reviewer/semver-discipline.md",
    ".claude/skills/api-contract-reviewer/deprecation-policy.md"
  ]
}
```

Create `marketplace.json` (array with the plugin entry).

**Verification:**
- [ ] `plugin.json` valid JSON, version semver
- [ ] All skill paths exist and are readable

---

## Implementation Order

```
Step 1  DB schema changes
Step 2  Server: repo + service + container wiring
Step 3  Server: extract pipeline (LLM call + grounding)
Step 4  Server: accept/reject + build-skill routes
Step 5  Client: Conventions UI
Step 6  Client: nav entry
Step 7  Write 4 skills markdown
Step 8  Create agent via UI (manual)
Step 9  Run experiment (manual)
Step 10 URL import (bonus)
Step 11 Plugin packaging (bonus)
```

## Acceptance Checklist

- [ ] `POST /repos/:id/conventions/extract` returns candidates with evidence
- [ ] Each candidate has a working GitHub evidence link
- [ ] Accept/Reject works and persists across page reload
- [ ] "Build skill" produces a `repo-conventions` skill body with only accepted candidates
- [ ] `repo-conventions` skill can be linked to an agent and used in a review run
- [ ] 4 API Contract Reviewer skills exist and are linked to the agent
- [ ] Experiment recorded: run without skills misses breaking change, run with skills catches it
- [ ] All server tests pass (`pnpm test` in server/)
- [ ] All client tests pass (`pnpm test` in client/)
- [ ] PR opened with description of what was built + quality report on extractor findings
