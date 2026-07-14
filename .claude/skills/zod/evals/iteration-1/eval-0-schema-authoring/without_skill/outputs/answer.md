# Signup body validation with Zod

Below is a complete, idiomatic Zod setup for a Fastify + TypeScript signup endpoint. It:

- defines a schema that coerces `age` from the form string into a real number,
- restricts `role` to a fixed set with `z.enum`,
- treats `bio` as optional,
- turns an untrusted body into a typed value with `safeParse`,
- returns friendly, field-by-field errors (never a raw error dump),
- and exports the parsed TypeScript type via `z.infer`.

## 1. The schema

```ts
// signup.schema.ts
import { z } from "zod";

export const signupSchema = z.object({
  email: z
    .string({ required_error: "Email is required." })
    .trim()
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),

  // HTML forms send everything as strings. z.coerce.number() runs
  // Number(value) before validating, so "27" becomes 27.
  age: z.coerce
    .number({ invalid_type_error: "Age must be a number." })
    .int("Age must be a whole number.")
    .min(18, "You must be at least 18.")
    .max(120, "Please enter a realistic age."),

  // z.enum both validates AND narrows the type to the literal union.
  role: z.enum(["admin", "editor", "viewer"], {
    errorMap: () => ({ message: "Role must be admin, editor, or viewer." }),
  }),

  // Optional: the key may be absent entirely. Trim + cap length when present.
  bio: z.string().trim().max(500, "Bio must be 500 characters or fewer.").optional(),
});
```

Notes on the choices:

- **`z.coerce.number()`** is the idiomatic way to accept the string an HTML form sends and get a real `number` out. It applies `Number()` first, so `"27"` parses to `27` while `"abc"` fails with `invalid_type_error`. Avoid a manual `.transform()` here — coercion is built for exactly this.
- **`z.enum([...])`** gives you both runtime validation and a compile-time literal union (`"admin" | "editor" | "viewer"`). Do not use `z.string()` plus a manual check.
- **`.optional()`** allows the field to be missing. Use `.optional()` (not `.nullable()`) because an absent form field is `undefined`, not `null`. If you also want to accept an empty string as "not provided", add `.or(z.literal("")).transform(v => v || undefined)` — but keep it simple unless you need it.

## 2. The exported TypeScript type

Infer the type from the schema so it can never drift from the validation. Because `age` is coerced, the inferred type is `number` (the parsed output), which is what your handler wants.

```ts
// signup.schema.ts (continued)
export type SignupInput = z.infer<typeof signupSchema>;
// {
//   email: string;
//   age: number;
//   role: "admin" | "editor" | "viewer";
//   bio?: string | undefined;
// }
```

## 3. Parse + friendly, field-by-field errors

Use `safeParse` (not `parse`) so a validation failure is a normal return value you handle, not a thrown exception. `error.flatten().fieldErrors` gives you a clean `{ field: [messages] }` object — perfect for a client form.

```ts
// signup.route.ts
import type { FastifyInstance } from "fastify";
import { signupSchema, type SignupInput } from "./signup.schema";

export async function signupRoutes(app: FastifyInstance) {
  app.post("/signup", async (request, reply) => {
    const result = signupSchema.safeParse(request.body);

    if (!result.success) {
      // fieldErrors: Partial<Record<"email"|"age"|"role"|"bio", string[]>>
      const { fieldErrors, formErrors } = result.error.flatten();

      return reply.status(400).send({
        message: "Validation failed.",
        errors: fieldErrors, // e.g. { age: ["You must be at least 18."] }
        formErrors,          // top-level, non-field errors (usually empty here)
      });
    }

    // Fully typed and coerced — result.data satisfies SignupInput.
    const input: SignupInput = result.data;

    // ... create the user with input.email, input.age (number), input.role, input.bio
    return reply.status(201).send({ ok: true });
  });
}
```

A failing request such as `{ email: "nope", age: "abc", role: "boss" }` produces a clean, client-friendly payload:

```json
{
  "message": "Validation failed.",
  "errors": {
    "email": ["Please enter a valid email address."],
    "age": ["Age must be a number."],
    "role": ["Role must be admin, editor, or viewer."]
  },
  "formErrors": []
}
```

## 4. Optional: make it fully idiomatic in Fastify

Rather than calling `safeParse` by hand in every handler, you can register `fastify-type-provider-zod` so the schema is used for both validation and response serialization, and validation errors are converted automatically. Both approaches are valid; the manual `safeParse` above is the most portable and makes the error shaping explicit.

```ts
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.withTypeProvider<ZodTypeProvider>().post(
  "/signup",
  { schema: { body: signupSchema } },
  async (request, reply) => {
    // request.body is typed as SignupInput and already validated/coerced.
    const input = request.body;
    return reply.status(201).send({ ok: true });
  },
);
```

## Summary

- **Schema:** `z.object` with `z.coerce.number()` for the string-typed `age`, `z.enum` for `role`, `.optional()` for `bio`, and per-rule custom messages.
- **Parsing:** `safeParse` returns a discriminated `{ success, data | error }` — no try/catch needed.
- **Errors:** `error.flatten().fieldErrors` yields a `{ field: string[] }` map you can drop straight into a form UI.
- **Type:** `z.infer<typeof signupSchema>` is the single source of truth for the parsed value's type.
