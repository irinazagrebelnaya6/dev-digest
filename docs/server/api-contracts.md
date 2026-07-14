# server — API/route contract conventions

> Architecture decisions live in [`README.md`](./README.md) — decision #1 covers *why* Zod is the
> dual schema. This doc covers the *how*: where contracts live, how routes wire them, and the rule
> for adding a new one.

## Where contracts live

`server/src/vendor/shared/contracts/*.ts` — one file per domain, re-exported from the
`@devdigest/shared` barrel:

```
contracts/
  brief.ts          findings.ts       knowledge.ts
  eval-ci.ts        observability.ts  platform.ts
  productionize.ts  review-api.ts     trace.ts        why.ts
```

Each file groups the Zod schemas (and their inferred types) for one feature surface. `review-api.ts`,
for example, extends the core `Review`/`Finding` contracts with the persisted/transport shapes the
review endpoints actually return (`FindingRecord`, `ReviewRecord`) — distinct from the raw
LLM-output `Finding` shape reviewer-core produces.

## The rule: routes never skip the response schema

Every route declares `params` / `body` / `response` Zod schemas via `fastify-type-provider-zod`.
This is one schema doing two jobs:

- **Request side** — invalid input is rejected with `422` *before* the handler body runs. Handlers
  never hand-roll `Schema.parse(req.body)`.
- **Response side** — the serializer strips any field not declared in the response schema before
  it reaches the client. A handler that calls `reply.send()` without a response schema loses this
  protection entirely — accidental fields (internal IDs, secrets, unpublished columns) go out as-is.

**Never add a route without a response schema**, even for an endpoint that "just returns what's in
the DB." The schema is what guarantees the wire shape doesn't silently drift from what the schema
says it is.

## Adding a new contract file

1. New domain → new file in `contracts/`, not a new export bag in an existing file. Keep the
   one-file-per-feature-surface split so a contract's owner and its consumers are easy to trace.
2. If the contract extends an existing core shape (like `FindingRecord` extends `Finding`), import
   and `.extend()` it rather than redeclaring fields — this is how `review-api.ts` avoids drift
   between the LLM-output shape and the persisted/transport shape.
3. A short header comment naming which lesson/feature owns the file and what it adds over the
   shapes it extends (see the top of `review-api.ts`) — this is the one place worth a comment,
   since "who owns this and why does it exist" isn't obvious from the schema itself.
4. Re-export from the `@devdigest/shared` barrel so both `server/` and `client/` resolve it from
   one import path.
