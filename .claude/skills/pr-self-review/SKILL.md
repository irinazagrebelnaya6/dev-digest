---
name: pr-self-review
description: Run before every push or manually to review all diff changes — applies UI skills to frontend files, backend skills to backend files, and security to all files; blocks if any CRITICAL finding is found.
---

## Trigger

Activate when: `git push` fires the pre-push hook, or the user runs `/pr-self-review` manually.

---

## Process

### Step 1 — Collect the diff

```bash
git diff $(git merge-base HEAD main)...HEAD --name-only
```

Classify every changed file into a bucket:

| Bucket | Path pattern |
|---|---|
| **frontend** | `client/src/**` |
| **backend** | `server/src/**`, `reviewer-core/src/**` |
| **config** | everything else |

---

### Step 2 — Apply skills per bucket

**Frontend files** — load and apply in order:

| Skill | Focus |
|---|---|
| `react-best-practices` | Render factories, derive-don't-store, key prop, useEffect misuse, conditional rendering `&&` trap |
| `react-component-structure` | Misplaced components/hooks, fetch inside `components/ui/`, hooks in `lib/` |
| `next-best-practices` | Async Client Components, missing `'use client'`/`'use server'`, `params` not awaited (Next.js 15), RSC boundary violations |
| `typescript-expert` | Implicit `any`, unsafe `as` assertions, missing return types on public APIs |

**Backend files** — load and apply in order:

| Skill | Focus |
|---|---|
| `onion-architecture` | Outward imports (domain → adapter), concrete instantiation in use cases, missing mapper at boundary |
| `fastify-best-practices` | Routes without Zod schema, plugins in wrong scope, missing error handler, auth bypass via middleware order |
| `drizzle-orm-patterns` | Drizzle row types leaking past adapter, missing transactions for multi-step writes, raw SQL mixed with Drizzle |
| `zod` | `z.any()` at API boundaries, missing `.safeParse()` for external input, schemas defined inside handlers |
| `typescript-expert` | Same as frontend |

**All files (including config)** — always apply:

| Skill | Focus |
|---|---|
| `security` | A01 missing auth/ownership check, A02 `VITE_*` secret leaks + CORS wildcard, A04 hardcoded secrets + `jwt.decode()` instead of `verify()`, A05 injection via user input, A08 mass assignment via `req.body` spread, `dangerouslySetInnerHTML` without DOMPurify |

---

### Step 3 — Collect findings

Each finding must include:
- `SEVERITY` — CRITICAL / HIGH / MEDIUM
- `file:line`
- `skill › rule name`
- one-line description of the violation

Show all severity levels (CRITICAL, HIGH, MEDIUM) in output.

---

### Step 4 — Gate decision

```
≥ 1 CRITICAL  →  print BLOCKED, exit non-zero  (pre-push aborts)
0 CRITICAL    →  print WARNINGS with all HIGH/MEDIUM findings, exit 0
0 findings    →  print APPROVED, exit 0
```

---

## Expected Output

```
== PR Self-Review ==
Changed: 7 files  (frontend: 4 · backend: 3 · config: 0)

[frontend › react-best-practices]
  CRITICAL  client/src/features/pulls/PullList.tsx:34
            renderThing() — breaks reconciliation (render factory anti-pattern)
  MEDIUM    client/src/features/pulls/PullList.tsx:61
            useMemo on a boolean check — no measured perf issue

[backend › onion-architecture]
  CRITICAL  server/src/modules/reviews/domain/review.entity.ts:3
            imports drizzle/pg-core — domain layer must have zero framework imports

[all › security]
  HIGH      client/src/lib/api.ts:12
            dangerouslySetInnerHTML without DOMPurify sanitization (stored XSS risk, A05)

== RESULT: BLOCKED ==
2 CRITICAL findings must be resolved before pushing.
```

---

## Hook Registration

**Option A — git hook** (runs for every `git push` regardless of tool):

```bash
# .git/hooks/pre-push
#!/bin/sh
claude /pr-self-review || exit 1
```

```bash
chmod +x .git/hooks/pre-push
```

**Option B — Claude Code hook** (fires when Claude itself runs a Bash push):

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash(git push*)",
        "hooks": [{ "type": "command", "command": "claude /pr-self-review" }]
      }
    ]
  }
}
```

Use Option A if the team pushes via terminal. Use Option B if pushes always go through Claude Code sessions.