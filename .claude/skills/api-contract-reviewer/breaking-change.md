---
name: breaking-change
description: Activate when reviewing a diff that touches API routes, request/response types, or exported function signatures — flag any change that breaks existing callers without a migration path.
type: convention
---

## Trigger

Activate when the diff removes or renames fields, removes endpoints, changes HTTP methods, or makes optional params required.

## Process

### Step 1 — Scan for removed or renamed fields

Check every deleted line (`-`) in request/response types. A removed field = breaking unless it was never in the published contract.

```ts
// BAD — removes field callers depend on
- userId: string;

// GOOD — deprecate first, remove in next major
  userId: string;        // @deprecated use accountId
+ accountId: string;
```

Why: clients that read `userId` will get `undefined` silently — no compile error, runtime breakage.

### Step 2 — Check for removed endpoints

Any `app.delete` / route removal without a redirect or tombstone entry is breaking.

```ts
// BAD — route just disappears
- app.get('/repos/:id/summary', ...)

// GOOD — return 410 Gone with upgrade hint
+ app.get('/repos/:id/summary', () => { throw new GoneError('Use /repos/:id/context') })
```

### Step 3 — Check for changed HTTP method

Same path, different verb = breaking for all existing integrations.

```ts
// BAD
- app.get('/reviews/:id/approve', ...)
+ app.post('/reviews/:id/approve', ...)
```

### Step 4 — Check for newly required params

Adding a required field to a POST/PUT body is breaking for callers who don't send it.

```ts
// BAD — existing clients send no `strategy` field
+ strategy: z.enum(['single-pass', 'map-reduce'])   // no .optional()

// GOOD
+ strategy: z.enum(['single-pass', 'map-reduce']).optional().default('single-pass')
```

## Expected output

```
BREAKING CHANGE — server/src/modules/reviews/routes.ts:47
  Removed required field `reviewer_id` from POST /reviews body.
  Callers that omit it will get a 400 with no migration path.
  Fix: make optional with default, or bump major version.
```
