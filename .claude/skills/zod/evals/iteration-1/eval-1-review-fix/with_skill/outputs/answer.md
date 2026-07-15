# Zod Review: `UserSchema` / `handleSignup`

The schema validates almost nothing, the hand-written `User` type has already drifted out of sync with the schema, and the handler crashes on bad input. Below is each problem, why it matters, and the corrected code.

## Problems

### 1. `id: z.any()` — bypasses the type system (CRITICAL · `schema-use-unknown-not-any`)
`z.any()` infers to `any`, which disables TypeScript checking for that field and accepts literally any value (numbers, objects, `null`). It also contradicts the hand-written type, which declares `id: string`. An ID is a known shape — validate it. Use `z.string().uuid()` (or `z.string().min(1)` if IDs aren't UUIDs). Never use `z.any()` for data whose shape you know; reach for `z.unknown()` only when the shape is genuinely unknown and you'll narrow it later.

### 2. `email: z.string()` — no format validation (CRITICAL · `schema-string-validations`)
Plain `z.string()` accepts `""`, `"not-an-email"`, and 10 MB payloads. Email is a boundary field feeding downstream systems, so validate its format with `.email()`.

### 3. `age: z.string()` — wrong primitive and type mismatch (CRITICAL · `schema-use-primitives-correctly`)
The schema says `age` is a **string**, but the hand-written `User` type says `age: number`. This is exactly the drift that manual types cause — the two are already lying to each other. Age is numeric, so model it as `z.number().int().positive()`. If the payload arrives as a string (HTML form / query string), use `z.coerce.number().int().positive()` instead so `"30"` becomes `30`.

### 4. `role: z.string()` — should be an enum (CRITICAL · `schema-use-enums`)
`role` has a fixed set of valid values, but `z.string()` accepts any string including typos like `"amdin"`. Use `z.enum([...])`, which validates the value, narrows the inferred type to a union, and gives autocomplete. Exporting the enum separately lets consumers reuse `.options`.

### 5. Hand-written `User` type duplicates the schema (HIGH · `type-use-z-infer` / `type-export-schemas-and-types`)
Maintaining a separate `type User` guarantees drift — and it has *already* drifted (see #1 and #3). Delete it and derive the type with `z.infer<typeof UserSchema>` so the schema is the single source of truth. Export both the schema and the inferred type.

### 6. `handleSignup` uses `.parse()` on untrusted input (CRITICAL · `parse-use-safeparse`)
`body` is `unknown` external input. `.parse()` throws a `ZodError` on invalid data; unhandled, that becomes a 500 with a stack trace instead of a clean 400. Use `.safeParse()` and branch on `result.success`. `flatten()` (`error-use-flatten`) turns the error into field-keyed messages ready for the client.

## Corrected code

```ts
import { z } from 'zod'

// Fixed value set → enum. Exported so callers can reuse UserRole.options.
export const UserRole = z.enum(['admin', 'user', 'guest'])
export type UserRole = z.infer<typeof UserRole>

export const UserSchema = z.object({
  id: z.string().uuid(),                       // was z.any() — validate a known shape
  email: z.string().email(),                   // was z.string() — enforce format
  age: z.number().int().positive(),            // was z.string() — correct primitive
  role: UserRole,                              // was z.string() — restrict to valid roles
  tags: z.array(z.string().min(1)).optional(), // reject empty tag strings
})

// Single source of truth — no hand-written type to drift.
export type User = z.infer<typeof UserSchema>
// { id: string; email: string; age: number; role: 'admin' | 'user' | 'guest'; tags?: string[] }

type SignupResult =
  | { success: true; user: User }
  | { success: false; fieldErrors: Record<string, string[] | undefined> }

export function handleSignup(body: unknown): SignupResult {
  const result = UserSchema.safeParse(body) // safeParse: no throw on bad input

  if (!result.success) {
    return { success: false, fieldErrors: result.error.flatten().fieldErrors }
  }

  return { success: true, user: result.data } // result.data is fully typed as User
}
```

### Note on `age` and input source
If the signup body comes from an HTML form or query string, `age` arrives as a string. In that case swap to coercion so the number field still parses:

```ts
age: z.coerce.number().int().positive(), // "30" → 30
```

Use plain `z.number()` for a JSON API body (where numbers stay numbers), and `z.coerce.number()` for form/query data.
