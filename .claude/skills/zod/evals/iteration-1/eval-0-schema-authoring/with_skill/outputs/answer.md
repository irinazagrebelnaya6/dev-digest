# Signup body validation with Zod (Fastify + TypeScript)

This project pins **Zod v3.24** (`server/package.json`), so the code below uses the v3 API
(`required_error` / `invalid_type_error`, `z.coerce`, `error.flatten()`).

Design decisions, tied to the Zod best-practice rules:

- **`age` is coerced** — HTML forms send every field as a string, so `z.number()` would
  reject `"42"`. Use `z.coerce.number()` (`schema-coercion-for-form-data`).
- **`role` is an enum**, not a `z.string()`, so typos and stray values are rejected and the
  parsed type narrows to the union (`schema-use-enums`).
- **`bio` is `.optional()`** — present-or-absent, not nullable (`object-optional-vs-nullable`).
- **`safeParse` at the boundary** so bad input never throws inside the handler
  (`parse-use-safeparse`, `parse-validate-early`).
- **`error.flatten()`** turns the issue array into `fieldErrors` keyed by field name — exactly
  the shape a client needs, no raw error dump (`error-use-flatten`, `error-custom-messages`).
- **Export the schema and the inferred type** (`type-export-schemas-and-types`).

---

## 1. The schema

```typescript
// signup.schema.ts
import { z } from 'zod'

// Enum kept as a named schema so the values are reusable (Role.options, etc.)
export const Role = z.enum(['admin', 'editor', 'viewer'], {
  // One friendly message covers both "missing" and "not one of the allowed values".
  errorMap: () => ({ message: 'Role must be one of: admin, editor, viewer' }),
})
export type Role = z.infer<typeof Role> // 'admin' | 'editor' | 'viewer'

export const signupSchema = z
  .object({
    email: z
      .string({
        required_error: 'Email is required',
        invalid_type_error: 'Email must be text',
      })
      .trim()
      .min(1, 'Email is required')
      .email('Please enter a valid email address'),

    // Arrives as a string from the form → coerce to number, then constrain.
    age: z
      .coerce
      .number({
        required_error: 'Age is required',
        invalid_type_error: 'Age must be a number',
      })
      .int('Age must be a whole number')
      .min(13, 'You must be at least 13 years old')
      .max(120, 'Please enter a realistic age'),

    role: Role,

    // Optional free text. Absent is fine; when present it is trimmed and length-capped.
    bio: z
      .string()
      .trim()
      .max(500, 'Bio must be 500 characters or fewer')
      .optional(),
  })
  .strict() // reject unknown keys — catches typos and unexpected fields on a signup contract
```

> **`.strict()` note.** This rejects any field not in the schema, which is the safer posture
> for a signup endpoint. If your HTML form legitimately posts extra fields (CSRF token, submit
> button value, etc.), drop `.strict()` to fall back to Zod's default `strip` behaviour, which
> silently discards unknown keys (`object-strict-vs-strip`). Unknown-key errors surface under
> `formErrors`, not `fieldErrors`.

> **Coercion gotcha.** `z.coerce.number()` turns `""` into `0`, so a blank age field becomes
> `0` and is then rejected by `.min(13, ...)` with a friendly message rather than a type error —
> which is the behaviour you want here.

---

## 2. The exported TypeScript type

`z.infer` gives the **output** (post-coercion) type — this is the value your handler works with:

```typescript
export type SignupInput = z.infer<typeof signupSchema>
// {
//   email: string
//   age: number                       // <- coerced to number
//   role: 'admin' | 'editor' | 'viewer'
//   bio?: string | undefined
// }
```

Because `age` is coerced, the **input** shape differs from the output. If you ever need the
raw pre-coercion shape (e.g. to type the incoming form payload), use `z.input`
(`type-input-vs-output`):

```typescript
export type SignupRawInput = z.input<typeof signupSchema>
// age is accepted as the raw form value (string/unknown) before coercion
```

For the parsed value, use `SignupInput`.

---

## 3. Parse untrusted input + friendly field-by-field errors

A small reusable helper that returns a typed, discriminated result — never throws:

```typescript
// validate.ts
import { z } from 'zod'

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; fieldErrors: Record<string, string[]>; formErrors: string[] }

export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): ParseResult<z.infer<S>> {
  const result = schema.safeParse(body)

  if (result.success) {
    return { success: true, data: result.data }
  }

  // flatten() -> { formErrors: string[], fieldErrors: { [field]: string[] } }
  const { formErrors, fieldErrors } = result.error.flatten()
  return { success: false, fieldErrors, formErrors }
}
```

### Fastify route

```typescript
// signup.route.ts
import type { FastifyInstance } from 'fastify'
import { signupSchema, type SignupInput } from './signup.schema'
import { parseBody } from './validate'

export async function signupRoutes(app: FastifyInstance) {
  app.post('/signup', async (request, reply) => {
    // request.body is untrusted -> validate at the boundary with safeParse
    const parsed = parseBody(signupSchema, request.body)

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Some fields are invalid.',
        fieldErrors: parsed.fieldErrors, // { email: ['...'], age: ['...'], role: ['...'] }
        formErrors: parsed.formErrors,   // e.g. unknown-key errors from .strict()
      })
    }

    // parsed.data is fully typed as SignupInput — age is a number, role is the union.
    const user: SignupInput = parsed.data
    // ... create the user ...

    return reply.status(201).send({ email: user.email, role: user.role })
  })
}
```

### Example error response

For body `{ "email": "nope", "age": "abc", "role": "superadmin" }`:

```json
{
  "error": "ValidationError",
  "message": "Some fields are invalid.",
  "fieldErrors": {
    "email": ["Please enter a valid email address"],
    "age": ["Age must be a number"],
    "role": ["Role must be one of: admin, editor, viewer"]
  },
  "formErrors": []
}
```

Each field maps to its own friendly message — no stack trace, no raw `ZodError` dump.

---

## 4. Idiomatic alternative for this stack (optional)

This repo already uses `fastify-type-provider-zod`, which lets you attach the schema directly
to the route so validation and serialization share one source of truth. With that provider,
`signupSchema` goes in `schema.body` and a `setErrorHandler` translates the thrown `ZodError`
into the same `flatten()`-based payload centrally, instead of calling `safeParse` per handler:

```typescript
import { ZodError } from 'zod'

app.setErrorHandler((error, _req, reply) => {
  if (error instanceof ZodError) {
    const { fieldErrors, formErrors } = error.flatten()
    return reply.status(400).send({ error: 'ValidationError', fieldErrors, formErrors })
  }
  throw error
})
```

The manual `safeParse` version above is fully self-contained and works in any Fastify app; the
type-provider version is the more idiomatic fit once you're wiring many routes in this codebase.
