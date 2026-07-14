# Module design: `untested-touch` (flag PRs touching files with no test coverage)

## Layer identification (Step 1)

- Deciding *whether* a set of changed files counts as "untested" is a pure rule — no framework/DB import needed → **domain**.
- Orchestrating "fetch PR's changed files, fetch repo's known files, run the rule, persist the verdict" → **application** (use case, depends only on ports).
- Reading the PR diff, reading the repo file index, writing the flag to Postgres, exposing it over HTTP → **adapters** (Drizzle, and calls into other modules' infra).

No LLM is involved — this is a deterministic convention check (`foo.ts` → does `foo.test.ts` / `foo.spec.ts` / `__tests__/foo.test.ts` exist in the repo's file list?), so there's no `LLMProvider` port and no grounding step. Keep it that simple; don't reach for the review pipeline.

## File layout

```
server/src/modules/untested-touch/
  domain/
    untested-touch-flag.entity.ts          # persisted verdict for one PR
    untested-touch-policy.ts               # pure rule, zero imports outward
    untested-touch-flag-repository.port.ts # persistence port
    pr-changed-files.port.ts               # port: "what files did this PR touch"
    repo-file-index.port.ts                # port: "what files exist in this repo@ref"
  application/
    compute-untested-touch.use-case.ts     # write path: run rule, persist
    get-untested-touch-flag.use-case.ts    # read path: for the UI badge
  adapters/
    db/
      postgres-untested-touch-flag.repository.ts  # implements the repo port
      untested-touch.mapper.ts                    # row <-> entity
    pulls/
      pr-changed-files.adapter.ts          # implements pr-changed-files.port by
                                            # delegating to the existing pulls module
    repo-intel/
      repo-file-index.adapter.ts           # implements repo-file-index.port by
                                            # delegating to the existing repo-intel index
    http/
      untested-touch.routes.ts             # Zod schemas + FastifyPluginAsyncZod
```

## Key signatures

### domain/untested-touch-flag.entity.ts
```ts
export class UntestedTouchFlag {
  constructor(
    readonly prId: string,
    readonly flagged: boolean,
    readonly untestedFiles: string[], // subset of changed files with no test counterpart
    readonly computedAt: Date,
  ) {}
}
```

### domain/untested-touch-policy.ts
```ts
export interface UntestedTouchInput {
  changedFiles: string[] // paths touched by the PR diff
  repoFiles: string[]    // all known file paths in the repo at this ref
}

export interface UntestedTouchVerdict {
  flagged: boolean
  untestedFiles: string[]
}

// Pure — no Drizzle, no Fastify, no I/O. Unit-testable with plain arrays.
export class UntestedTouchPolicy {
  evaluate(input: UntestedTouchInput): UntestedTouchVerdict
  private isTestableSource(path: string): boolean   // excludes .md, config, generated files, etc.
  private hasTestCounterpart(path: string, repoFiles: string[]): boolean // convention match
}
```

### domain/untested-touch-flag-repository.port.ts
```ts
import type { UntestedTouchFlag } from './untested-touch-flag.entity'

export interface UntestedTouchFlagRepository {
  findByPrId(prId: string, workspaceId: string): Promise<UntestedTouchFlag | null>
  save(flag: UntestedTouchFlag, workspaceId: string): Promise<void>
}
```

### domain/pr-changed-files.port.ts and domain/repo-file-index.port.ts
```ts
export interface PrChangedFilesPort {
  listChangedFilePaths(prId: string, workspaceId: string): Promise<string[]>
}

export interface RepoFileIndexPort {
  listFilePaths(repoId: string, ref: string): Promise<string[]>
}
```
These two are separate, narrow ports rather than one "give me everything" port — `ComputeUntestedTouchUseCase` depends on interfaces it actually needs, and each gets its own mock in tests. If the `pulls` module already exposes an equivalent "changed files for PR" capability, `PrChangedFilesPort` should mirror that shape so the adapter is a thin pass-through, not a re-implementation.

### application/compute-untested-touch.use-case.ts
```ts
import type { PrChangedFilesPort } from '../domain/pr-changed-files.port'
import type { RepoFileIndexPort } from '../domain/repo-file-index.port'
import type { UntestedTouchFlagRepository } from '../domain/untested-touch-flag-repository.port'
import { UntestedTouchPolicy } from '../domain/untested-touch-policy'
import { UntestedTouchFlag } from '../domain/untested-touch-flag.entity'

export class ComputeUntestedTouchUseCase {
  constructor(
    private prFiles: PrChangedFilesPort,
    private repoFiles: RepoFileIndexPort,
    private flags: UntestedTouchFlagRepository,
    private policy: UntestedTouchPolicy = new UntestedTouchPolicy(),
  ) {}

  async execute(prId: string, repoId: string, ref: string, workspaceId: string): Promise<UntestedTouchFlag>
}
```

### application/get-untested-touch-flag.use-case.ts
```ts
import type { UntestedTouchFlagRepository } from '../domain/untested-touch-flag-repository.port'

export class GetUntestedTouchFlagUseCase {
  constructor(private flags: UntestedTouchFlagRepository) {}
  async execute(prId: string, workspaceId: string) // -> UntestedTouchFlag | null, for the UI badge
}
```

### adapters/db/postgres-untested-touch-flag.repository.ts
```ts
import type { UntestedTouchFlagRepository } from '../../domain/untested-touch-flag-repository.port'
import { toDomain, toRow } from './untested-touch.mapper'
import { pullRequestsTable } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import type { DbClient } from '@/platform/db'

export class PostgresUntestedTouchFlagRepository implements UntestedTouchFlagRepository {
  constructor(private db: DbClient) {}
  async findByPrId(prId: string, workspaceId: string) { /* select, scoped by workspace_id, map via toDomain */ }
  async save(flag: UntestedTouchFlag, workspaceId: string) { /* update, scoped by workspace_id + prId, map via toRow */ }
}
```

**Persistence note (respects the "no new tables" rule):** the flag is per-PR, 1:1 data, so it belongs as new *columns* on the existing `pull_requests` table, not a new table:
- `untested_touch_flagged boolean not null default false`
- `untested_touch_files jsonb not null default '[]'`
- `untested_touch_computed_at timestamptz`

Add these via a normal ALTER TABLE migration, same pattern as other lesson migrations that only add columns.

### adapters/pulls/pr-changed-files.adapter.ts and adapters/repo-intel/repo-file-index.adapter.ts
```ts
export class PullsChangedFilesAdapter implements PrChangedFilesPort {
  constructor(private db: DbClient) {}
  async listChangedFilePaths(prId: string, workspaceId: string): Promise<string[]>
  // delegates to whatever the pulls module already uses to read diff file lists
  // (existing diff/files table or the pulls module's own repository) — this adapter
  // exists purely so `untested-touch` doesn't import pulls internals directly.
}

export class RepoIntelFileIndexAdapter implements RepoFileIndexPort {
  constructor(private db: DbClient) {}
  async listFilePaths(repoId: string, ref: string): Promise<string[]>
  // delegates to the repo-intel code index (server/src/modules/repo-intel/)
}
```

### adapters/http/untested-touch.routes.ts
```ts
import { z } from 'zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { getContext } from '@/modules/_shared'

export const untestedTouchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/prs/:prId/untested-touch', {
    schema: { params: z.object({ prId: z.string() }) },
  }, async (req) => {
    const { workspaceId } = getContext(req)
    return req.container.getUntestedTouchFlag.execute(req.params.prId, workspaceId)
  })

  app.post('/prs/:prId/untested-touch/recompute', {
    schema: { params: z.object({ prId: z.string() }) },
  }, async (req) => {
    const { workspaceId } = getContext(req)
    // repoId/ref for this PR come from the existing pulls context/service, not re-derived here
    const { repoId, ref } = await req.container.getPrRepoRef.execute(req.params.prId, workspaceId)
    return req.container.computeUntestedTouch.execute(req.params.prId, repoId, ref, workspaceId)
  })
}
```
`getContext(req)` is used on both routes so every query stays scoped to `workspace_id`, per the tenancy guard gotcha.

## Wiring into `server/src/platform/container.ts`

```ts
import { PostgresUntestedTouchFlagRepository } from '@/modules/untested-touch/adapters/db/postgres-untested-touch-flag.repository'
import { PullsChangedFilesAdapter } from '@/modules/untested-touch/adapters/pulls/pr-changed-files.adapter'
import { RepoIntelFileIndexAdapter } from '@/modules/untested-touch/adapters/repo-intel/repo-file-index.adapter'
import { ComputeUntestedTouchUseCase } from '@/modules/untested-touch/application/compute-untested-touch.use-case'
import { GetUntestedTouchFlagUseCase } from '@/modules/untested-touch/application/get-untested-touch-flag.use-case'

const untestedTouchFlagRepo = new PostgresUntestedTouchFlagRepository(db)
const prChangedFiles = new PullsChangedFilesAdapter(db)
const repoFileIndex = new RepoIntelFileIndexAdapter(db)

const computeUntestedTouch = new ComputeUntestedTouchUseCase(prChangedFiles, repoFileIndex, untestedTouchFlagRepo)
const getUntestedTouchFlag = new GetUntestedTouchFlagUseCase(untestedTouchFlagRepo)

export const container = {
  // ...existing entries
  computeUntestedTouch,
  getUntestedTouchFlag,
}
```

Register `untestedTouchRoutes` alongside the other route plugins where the Fastify app is assembled (same place `subscriptionsRoutes`-style plugins get registered) — not inside `container.ts` itself, which stays the pure composition root for use cases and adapters.

**Trigger point:** the design above exposes `computeUntestedTouch` as an explicit use case (callable from an HTTP route or a background job). If PRs should be flagged automatically on ingestion rather than on-demand, the *same* use case instance can simply be invoked as one more step at the end of the existing pulls ingestion flow — inject `computeUntestedTouch` into that flow via the container rather than duplicating the logic there.

## Test doubles

Add to `server/src/adapters/mocks.ts`:
```ts
export const mockUntestedTouchFlagRepository: UntestedTouchFlagRepository = {
  findByPrId: vi.fn(),
  save: vi.fn(),
}
export const mockPrChangedFilesPort: PrChangedFilesPort = {
  listChangedFilePaths: vi.fn(),
}
export const mockRepoFileIndexPort: RepoFileIndexPort = {
  listFilePaths: vi.fn(),
}
```
This lets `ComputeUntestedTouchUseCase` and `UntestedTouchPolicy` be unit-tested with zero DB/network, per the DI contract.

## Dependency direction (inward only)

```
adapters/http/untested-touch.routes.ts
        │  calls
        ▼
application/compute-untested-touch.use-case.ts
application/get-untested-touch-flag.use-case.ts
        │  imports (port interfaces only)
        ▼
domain/untested-touch-policy.ts
domain/untested-touch-flag.entity.ts
domain/*.port.ts
        ▲  implements
        │
adapters/db/postgres-untested-touch-flag.repository.ts
adapters/pulls/pr-changed-files.adapter.ts
adapters/repo-intel/repo-file-index.adapter.ts
```

Nothing in `domain/` imports Drizzle, Fastify, or another module's internals. The use case takes three ports as constructor args and never `new`s a concrete adapter — all wiring happens once, in `container.ts`.
