# Zod Code Review: `UserSchema` / `handleSignup`

## Problems found

### 1. `id: z.any()` disables validation entirely
`z.any()` accepts literally anything (including `undefined`, objects, functions) and infers as `any`, which poisons type safety downstream. The hand-written `User` type claims `id: string`, so the schema and the type already disagree. An `id` should be a validated string — ideally a specific format (UUID, cuid) so malformed IDs are rejected at the boundary.

### 2. `email: z.string()` does not validate an email
`z.string()` only checks that the value is a string. A signup handler must reject non-email inputs. Use the dedicated email validator (`z.email()` in Zod 4, or `z.string().email()` in Zod 3).

### 3. `age: z.string()` contradicts the declared type
The schema parses `age` as a **string**, but the `User` type declares `age: number`. After `parse()`, `user.age` is actually a `string` at runtime while TypeScript believes it is a `number` — a latent bug. `age` should be a `number` (constrained to a sensible range), or, if the input arrives as a string (e.g. an HTML form / query param), use `z.coerce.number()` to convert-and-validate.

### 4. The `User` type is hand-maintained and has already drifted
Declaring `type User` separately from the schema defeats Zod's biggest advantage: a single source of truth. The two are already out of sync (`id`, `age`). Derive the type from the schema with `z.infer<typeof UserSchema>` so it can never drift.

### 5. `role: z.string()` allows any string
A `role` is almost certainly a fixed set of values. An open `string` lets `"superadmin"` or typos through. Model it with `z.enum([...])` to constrain and to get a precise union type for free.

### 6. `handleSignup` uses `.parse()` on untrusted input
`.parse()` throws a `ZodError` on invalid input. For an external request body, prefer `.safeParse()` and return a structured result (or a typed error) instead of letting an exception propagate. If you do keep `parse()`, make sure a caller/error boundary translates the throw into a proper 4xx response — silently throwing is not "handling."

### 7. Minor: `tags` could be tightened
`z.array(z.string()).optional()` is fine, but if tags must be non-empty strings and unique, express that (`z.array(z.string().min(1))`, optionally deduped). Optional here also means "absent"; decide whether you also want to allow an empty array.

## Corrected version

```ts
import { z } from 'zod'

// Single source of truth. The TS type is derived, never hand-written.
export const UserSchema = z.object({
  // Validate the id's shape instead of accepting anything.
  id: z.uuid(), // Zod 3: z.string().uuid()

  // Real email validation.
  email: z.email(), // Zod 3: z.string().email()

  // A number, constrained to a realistic range.
  // If age arrives as a string (form/query), use z.coerce.number() instead.
  age: z.number().int().min(0).max(150),

  // Constrain role to known values -> precise union type.
  role: z.enum(['user', 'admin', 'moderator']),

  // Non-empty tags; still optional.
  tags: z.array(z.string().min(1)).optional(),
})

// Derived type — cannot drift from the schema.
export type User = z.infer<typeof UserSchema>
// => {
//   id: string
//   email: string
//   age: number
//   role: 'user' | 'admin' | 'moderator'
//   tags?: string[]
// }

export function handleSignup(body: unknown) {
  // safeParse: no throw; return a structured result the caller can branch on.
  const result = UserSchema.safeParse(body)

  if (!result.success) {
    return {
      ok: false as const,
      // z.treeifyError(result.error) in Zod 4, or result.error.flatten() in Zod 3
      errors: z.treeifyError(result.error),
    }
  }

  return { ok: true as const, user: result.data }
}
```

### Notes on Zod version
- **Zod 4** promotes formats to top-level helpers: `z.uuid()`, `z.email()`, and uses `z.treeifyError()` / `z.prettifyError()` for error formatting.
- **Zod 3** uses the method form: `z.string().uuid()`, `z.string().email()`, and `error.flatten()` / `error.format()`.

Both eliminate the core problems: no `z.any()`, real format validation, type↔runtime agreement, a single inferred type, a constrained `role`, and non-throwing handling of untrusted input.
