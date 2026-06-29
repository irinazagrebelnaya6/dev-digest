---
name: onion-architecture-skill
description: Plan for building the onion-architecture skill covering layers, ports/adapters, DI, domain purity, and enforcement tooling for Node.js/TypeScript backends.
---

# Plan: Onion Architecture Skill

## Goal

Produce a self-contained skill that gives any AI agent (or developer) enough context to correctly apply Onion Architecture in a Node.js / TypeScript backend — covering layer design, port/adapter pattern, DI wiring, domain model purity, anti-patterns, and CI enforcement.

---

## Steps

### Step 1 — Research and article curation (done)
- [x] Search for authoritative articles on Onion / Clean / Hexagonal Architecture in TypeScript
- [x] Collect URLs, titles, and descriptions
- [x] Identify Node.js-specific guidance
- [x] Identify common anti-patterns from real-world experience

**Deliverable:** `README.md` — curated article list with anti-patterns table

---

### Step 2 — Core skill content (done)
- [x] Write `SKILL.md` with frontmatter (name, description, metadata tags)
- [x] Document the four rings with ASCII diagram
- [x] Write the five core rules with TypeScript code examples (good vs bad)
- [x] Anti-pattern table with fixes
- [x] Recommended folder structure
- [x] Layer enforcement tooling snippets (eslint-plugin-boundaries, fresh-onion)
- [x] DevDigest alignment table (map patterns to existing codebase locations)

**Deliverable:** `SKILL.md`

---

### Step 3 — Code examples file (next)
- [x] Write `examples.md` with full end-to-end worked example:
  - Domain entity (value objects, business rule method)
  - Port interface
  - Use case class
  - Adapter implementation (Drizzle-based)
  - Mapper functions
  - Composition root wiring
  - Fastify route handler delegating to use case
- [x] Include a "bad version" and "good version" side-by-side for the most common mistakes

**Deliverable:** `examples.md`

---

### Step 4 — Register skill in catalog
- [x] Add row to `.claude/skills/README.md` catalog table
- [x] Verify frontmatter `description` is searchable / triggerable by the agent

**Deliverable:** Updated `README.md` catalog

---

### Step 5 — Validation
- [x] Read SKILL.md as if seeing it for the first time — does it answer: "where does this class go?"
- [x] Confirm all article URLs are reachable
- [x] Confirm folder structure matches the DevDigest `server/src/modules/` conventions
- [x] Confirm anti-pattern table covers the most common issues seen in this codebase

---

## Out of Scope

- DDD tactical patterns (aggregates, domain events, bounded contexts) — separate skill if needed
- NestJS-specific DI patterns — covered by NestJS docs
- Event sourcing / CQRS — separate skill