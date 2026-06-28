---
name: response-schema
description: Activate when reviewing changes to response types, Zod schemas, or serialized DTOs — flag type changes, removed fields, and optional-to-required promotions that break response consumers.
type: convention
---

## Trigger

Activate when the diff touches response Zod schemas, DTO interfaces, or serialized JSON shapes returned by API routes.

## Process

### Step 1 — Detect field type changes

A field changing type (e.g. `string → number`, `string → string[]`) breaks any client that uses the old type.

```ts
// BAD — was string, now number; clients parsing as string break
- score: z.string(),
+ score: z.number(),

// GOOD — add new field, keep old one temporarily
  score: z.string(),       // @deprecated
+ score_value: z.number(),
```

### Step 2 — Detect optional → required promotions

If a field was `nullish()` or `optional()` and is now required, clients that omit it receive a validation error.

```ts
// BAD — callers that never sent `description` now get 400
- description: z.string().optional(),
+ description: z.string(),

// GOOD — keep optional, add server-side default
+ description: z.string().optional().default(''),
```

### Step 3 — Detect new required fields in response

Adding a required field to a response schema can break clients that build their own DTOs from the schema type (TypeScript will complain at build time, but runtime JSON still validates fine). Flag it as a minor breaking change.

```ts
// BAD — response contract now demands a field all existing mocks lack
+ extractionRunId: z.string(),

// GOOD — mark nullable so existing serialized data is still valid
+ extractionRunId: z.string().nullable(),
```

### Step 4 — Detect deleted response fields

Any deleted field from a response schema breaks clients that read it.

```ts
// BAD — clients reading `full_name` get undefined
- full_name: z.string(),

// GOOD — keep for one release, mark deprecated in docs
  full_name: z.string(), // @deprecated — will be removed in v3
```

## Expected output

```
RESPONSE SCHEMA CHANGE — server/src/vendor/shared/contracts/platform.ts:141
  Field `clone_path` changed from `z.string()` to `z.string().nullable()`.
  Impact: low — narrowing to nullable is safe.

RESPONSE SCHEMA CHANGE — server/src/vendor/shared/contracts/knowledge.ts:130
  Field `evidence_files` removed from Skill response.
  Impact: HIGH — clients that destructure this field will break silently.
```
