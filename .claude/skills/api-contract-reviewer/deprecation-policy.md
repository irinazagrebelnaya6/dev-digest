---
name: deprecation-policy
description: Activate when reviewing diffs that delete API fields, endpoints, or parameters — verify a deprecation notice was present in a prior version before the deletion lands.
type: convention
---

## Trigger

Activate when the diff deletes a field from a response schema, removes an endpoint, or removes a request parameter with no deprecation annotation in the same diff.

## Process

### Step 1 — Check for prior deprecation annotation

Before deleting a field or endpoint, a `@deprecated` JSDoc comment or inline note must have been present in the previous version. If the deletion and the `@deprecated` annotation appear in the same diff, that's a silent deletion — flag it.

```ts
// BAD — field deleted with no prior deprecation
- userId: z.string(),

// GOOD — field was annotated first, now safely removed
- /** @deprecated use accountId instead (since v2.1) */
- userId: z.string(),
```

### Step 2 — Check for `Deprecation` response header on removed endpoints

Routes that served real traffic should respond with a `Deprecation` header before removal so API clients can detect it via logs.

```ts
// BAD — route removed silently
- app.get('/v1/summary', ...)

// GOOD — route emits Deprecation header for one release cycle
  app.get('/v1/summary', async (_req, reply) => {
    reply.header('Deprecation', 'true');
    reply.header('Link', '</v2/summary>; rel="successor-version"');
    return legacyHandler();
  });
```

Why: HTTP clients (curl, Axios, fetch) can log `Deprecation: true` headers. Teams can find usages in logs before they break.

### Step 3 — Check for migration path in error body

When removing an endpoint entirely (returning 410 Gone), include a `message` with the replacement path so developers see it in logs.

```ts
// BAD — 410 with no guidance
throw new GoneError();

// GOOD — 410 with actionable message
throw new GoneError('Endpoint removed. Use POST /v2/reviews instead.');
```

### Step 4 — Allow same-diff deprecation if version is still in pre-release

If `package.json` version is `0.x.x`, semver pre-release rules allow breaking changes without prior deprecation. Skip this check.

## Expected output

```
DEPRECATION POLICY VIOLATION — server/src/modules/pulls/routes.ts:88
  GET /pulls/:id/diff removed with no prior @deprecated annotation.
  Policy: annotate with @deprecated for at least one release before deletion.
  Fix: restore the route, add @deprecated JSDoc, ship in next minor, then delete.
```
