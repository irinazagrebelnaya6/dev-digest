---
name: semver-discipline
description: Activate when a diff contains breaking API changes — verify the version field in package.json or OpenAPI spec is bumped to the next major version.
type: convention
---

## Trigger

Activate when the diff contains at least one breaking API change (removed field, removed endpoint, required param added, type changed) — check that the version is bumped accordingly.

## Process

### Step 1 — Check package.json version

If the diff has a breaking change, `package.json` must show a major bump (e.g. `1.x.x → 2.0.0`).

```json
// BAD — breaking change shipped as patch
- "version": "1.4.2"
+ "version": "1.4.3"

// GOOD — breaking change shipped as major
- "version": "1.4.2"
+ "version": "2.0.0"
```

Why: SemVer lets clients pin `^1.0.0` expecting no breaking changes. A patch bump silently breaks them.

### Step 2 — Check OpenAPI `info.version` if present

If the repo has an OpenAPI spec file (`openapi.yaml`, `openapi.json`, `swagger.yaml`), its `info.version` must also be bumped to match.

```yaml
# BAD — spec version not updated
 info:
-  version: "1.4.2"
+  version: "1.4.3"   # should be 2.0.0

# GOOD
 info:
-  version: "1.4.2"
+  version: "2.0.0"
```

### Step 3 — Non-breaking changes don't require major bumps

New optional fields, new endpoints, and performance fixes are minor or patch — not breaking.

```ts
// GOOD — adding optional field is non-breaking (minor bump is fine)
+ agentId: z.string().optional(),
```

### Step 4 — Flag missing version bump

If the diff contains a breaking change but `package.json` is not modified, flag it.

```
// BAD — package.json not in the diff at all, but breaking changes exist
```

## Expected output

```
SEMVER VIOLATION — package.json not modified
  The diff removes `userId` from GET /users response (breaking change).
  Requires a major version bump (e.g. 1.4.2 → 2.0.0).
  Current version: 1.4.2 — no change detected.
```
