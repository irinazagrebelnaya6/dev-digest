---
name: pr-self-review-skill
description: Plan for building the pr-self-review skill — a pre-push gate that classifies diff files into frontend/backend buckets, runs matching skills, and blocks the push on any CRITICAL finding.
---

# Plan: PR Self-Review Skill

## Goal

Produce a skill that runs automatically as a `pre-push` hook (or manually via `/pr-self-review`).
It reads the diff against `main`, routes each changed file to the appropriate set of existing skills,
collects all findings, and blocks the push if any CRITICAL finding is reported.

---

## Steps

### Step 1 — Define file classification rules (done)
- [x] Frontend bucket: `client/src/**`
- [x] Backend bucket: `server/src/**`, `reviewer-core/src/**`
- [x] Config/scripts bucket: everything else (secrets scan only)

**Deliverable:** classification table in SKILL.md

---

### Step 2 — Map skills to buckets (done)
- [x] Frontend: `react-best-practices`, `react-component-structure`, `next-best-practices`, `typescript-expert`
- [x] Backend: `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `typescript-expert`
- [x] All files: `security` (covers `dangerouslySetInnerHTML`, `VITE_*` leaks, A01/A02/A04/A05/A08)

**Deliverable:** skills-per-bucket table in SKILL.md

---

### Step 3 — Define severity thresholds (done)
- [x] CRITICAL → push blocked (non-zero exit)
- [x] HIGH + MEDIUM → warnings printed, push proceeds
- [x] All three levels shown in output

**Deliverable:** gate-decision section in SKILL.md

---

### Step 4 — Write output format (done)
- [x] Header: changed file count, bucket breakdown
- [x] Per-skill section: findings as `SEVERITY  file:line  skill › rule  description`
- [x] Footer: BLOCKED (with count) or WARNINGS or APPROVED

**Deliverable:** output example in SKILL.md

---

### Step 5 — Document hook registration (done)
- [x] Pre-push hook via `.git/hooks/pre-push`
- [x] Alternative: `PreToolUse` hook for `Bash` matcher in `.claude/settings.json`

**Deliverable:** hook-registration section in SKILL.md

---

### Step 6 — Register skill in catalog
- [ ] Add row to `.claude/skills/README.md`

---

## Out of Scope

- `react-testing-library` — test quality review, not a pre-push gate concern
- `postgresql-table-design` — schema migrations are a separate review step
- `mermaid-diagram`, `engineering-insights` — not code-quality gates
- Per-skill deep configuration (thresholds per rule) — use each skill's own severity tags as-is