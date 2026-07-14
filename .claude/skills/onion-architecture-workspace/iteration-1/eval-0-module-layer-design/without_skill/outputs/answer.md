# Design: "untested-touch" PR flag

Goal: flag a PR when it touches source files that have no corresponding test
file, persist that verdict per PR, and let the UI badge it. Everything below
was checked against the actual codebase conventions (repo-intel facade,
`blast`/`brief` modules, `pull.repo.ts`, `container.ts`, `modules/index.ts`) —
not invented in a vacuum.

## Key design decisions (and why)

1. **No LLM involved → this is NOT `reviewer-core`.** `reviewer-core` is
   reserved for the review *engine* (prompt building, structured-output
   grounding, things that talk to an `LLMProvider`). Purely-deterministic
   composers that reshape already-fetched data for one feature live inside
   that feature's own server module — e.g. `modules/blast/blast.ts` and
   `modules/reviews/smart-diff.ts` are both "PURE — no LLM, no DB" and both
   live in `server/src/modules/<feature>/`, not in `reviewer-core/`. The
   untested-touch rule follows that same precedent.

2. **No new table, no new migration.** `server/CLAUDE.md`: "Schema is
   pre-created… Lessons add columns, never new tables. Do not write
   per-feature migrations." Looking at how the existing **Why+Risk Brief**
   feature (spec-04) persisted its own new shape, it did *not* add a column —
   it added a new sibling key inside the pre-existing generic blob:

   ```ts
   // server/src/db/schema/reviews.ts
   export const prBrief = pgTable('pr_brief', {
     prId: uuid('pr_id').primaryKey().references(() => pullRequests.id, { onDelete: 'cascade' }),
     json: jsonb('json').notNull(),   // generic slice store, keyed by feature
   });
   ```
   `pull.repo.ts`'s `upsertBrief`/`getBrief` shallow-merge into that `json`
   blob (`{ ...existing, ...newSlice }`), which is exactly how `risks` and
   `brief` coexist today. The untested-touch flag reuses this table with its
   own `coverage` key — zero migrations needed.

3. **No new adapter/port.** Existence-checking a candidate test path is just
   `container.git.readFile(repo, path)` (already on `GitClient`) wrapped in
   try/catch — no need to widen `CodeIndex` or add a new port.

4. **No new `Container` getter for the service itself.** Precedent
   (`BlastService`, `BriefService`): class-shaped feature services are
   constructed ad hoc inside `routes.ts` as `new XService(container)`, not
   stored on the container. Only *shared, cross-cutting* things get a
   container getter (`container.git`, `container.reviewRepo`, `container.db`)
   — and this feature needs none of those to be added, it reuses what's
   already there.

## File layout

```
server/src/modules/coverage/                     # NEW module
  rule.ts                                         # pure domain rule
  service.ts                                      # orchestration (I/O)
  routes.ts                                        # Fastify plugin (HTTP)

server/src/modules/reviews/repository/pull.repo.ts  # EDIT: + 2 functions
server/src/modules/reviews/repository.ts            # EDIT: + 2 facade methods

server/src/vendor/shared/contracts/coverage.ts     # NEW: Zod contract
server/src/vendor/shared/contracts/platform.ts     # EDIT: PrMeta.untested_touch
server/src/vendor/shared/index.ts                  # EDIT: export coverage.ts

server/src/modules/index.ts                        # EDIT: register `coverage` plugin
server/src/platform/container.ts                    # NO CHANGE (see decision #4)
```

## 1. Domain layer — `modules/coverage/rule.ts` (pure)

Zero DB, zero network, zero filesystem. Takes plain data in, plain data out —
this is the piece a unit test exercises with no mocks at all.

```ts
/**
 * Untested-touch rule (PURE). Decides, from an already-resolved per-file
 * "does a test exist for this?" answer, whether a PR should be flagged, and
 * folds that into one persistable verdict. Never does I/O itself — callers
 * (service.ts) resolve `hasTest` by probing the repo and pass in the result.
 */

export interface FileTestStatus {
  path: string;
  /** True when at least one candidate test path for `path` was found. */
  hasTest: boolean;
  /** Candidate test paths that were probed (kept for UI drill-down / debugging). */
  candidates: string[];
}

export interface UntestedTouchResult {
  flagged: boolean;
  /** Touched, test-relevant files with no matching test file. */
  untestedFiles: string[];
  /** Touched files the rule intentionally skipped (tests/config/docs/generated). */
  skipped: string[];
  /** PR head SHA this verdict was computed against (staleness check, mirrors Brief). */
  computedForSha: string;
}

/**
 * True when `path` itself needs a test at all — false for test files
 * themselves, config, docs, lockfiles, migrations, generated/build output.
 */
export function isTestRelevant(path: string): boolean;

/**
 * Pure, convention-based guesses at where `path`'s test could live
 * (colocated `.test`/`.spec`, `__tests__/`, mirrored `tests/` tree, per
 * extension). Returns `[]` when `isTestRelevant(path)` is false.
 */
export function candidateTestPaths(path: string): string[];

/** Fold per-file statuses into the persistable verdict. */
export function evaluateUntestedTouch(
  files: FileTestStatus[],
  headSha: string,
): UntestedTouchResult;
```

## 2. Application layer — `modules/coverage/service.ts` (orchestration)

Depends on the rule (inward, pure) and on **ports** (`GitClient` via
`container.git`, `ReviewRepository`), never on concrete adapter classes.

```ts
import type { Container } from '../../platform/container.js';
import { ReviewRepository } from '../reviews/repository.js';
import { NotFoundError } from '../../platform/errors.js';
import {
  isTestRelevant,
  candidateTestPaths,
  evaluateUntestedTouch,
  type UntestedTouchResult,
} from './rule.js';

export class CoverageService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    // Same convention as BlastService/BriefService: construct the shared
    // repo locally rather than adding a container getter just for this.
    this.repo = new ReviewRepository(container.db);
  }

  /** Serves the cached flag if fresh for the PR's current head SHA, else recomputes (mirrors Brief's getOrGenerate). */
  async getOrCompute(workspaceId: string, prId: string): Promise<UntestedTouchResult> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const stored = await this.repo.getCoverageFlag(pull.id);
    if (stored && stored.computedForSha === pull.headSha) return stored;
    return this.compute(pull);
  }

  /** Always recomputes and persists (mirrors Brief's `regenerate`). */
  async recompute(workspaceId: string, prId: string): Promise<UntestedTouchResult> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return this.compute(pull);
  }

  private async compute(pull: /* PullRow */ any): Promise<UntestedTouchResult> {
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Best-effort: make sure the local clone is checked out at this PR's
    // head before probing candidate paths (readFile reads the working tree).
    await this.container.git.fetchPullHead(repo, pull.number).catch(() => {});

    const files = await this.repo.getPrFiles(pull.id);
    const statuses = await Promise.all(
      files
        .map((f) => f.path)
        .filter(isTestRelevant)
        .map(async (path) => {
          const candidates = candidateTestPaths(path);
          const found = await Promise.all(
            candidates.map((c) =>
              this.container.git.readFile(repo, c).then(
                () => true,
                () => false,
              ),
            ),
          );
          return { path, candidates, hasTest: found.some(Boolean) };
        }),
    );

    const result = evaluateUntestedTouch(statuses, pull.headSha);
    await this.repo.upsertCoverageFlag(pull.id, result);
    return result;
  }
}
```

## 3. Persistence — extend `pull.repo.ts` + `ReviewRepository` facade

`server/src/modules/reviews/repository/pull.repo.ts` — add, right next to
`upsertBrief`/`getBrief`, following the exact same shallow-merge-into-blob
shape:

```ts
export async function upsertCoverageFlag(
  db: Db,
  prId: string,
  coverage: UntestedTouchResult,
): Promise<void> {
  const [existing] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
  const merged = { ...((existing?.json as Record<string, unknown>) ?? {}), coverage };
  await db
    .insert(t.prBrief)
    .values({ prId, json: merged })
    .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: merged } });
}

export async function getCoverageFlag(
  db: Db,
  prId: string,
): Promise<UntestedTouchResult | undefined> {
  const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
  return (row?.json as { coverage?: UntestedTouchResult })?.coverage;
}
```

`server/src/modules/reviews/repository.ts` (facade) — add two thin
delegating methods next to `getBrief`/`upsertBrief`:

```ts
getCoverageFlag(prId: string): Promise<UntestedTouchResult | undefined> {
  return pullRepo.getCoverageFlag(this.db, prId);
}
upsertCoverageFlag(prId: string, result: UntestedTouchResult): Promise<void> {
  return pullRepo.upsertCoverageFlag(this.db, prId, result);
}
```

## 4. Contract — `vendor/shared/contracts/coverage.ts` (NEW)

```ts
import { z } from 'zod';

export const UntestedTouchResponse = z.object({
  flagged: z.boolean(),
  untested_files: z.array(z.string()),
  skipped: z.array(z.string()),
  computed_for_sha: z.string(),
});
export type UntestedTouchResponse = z.infer<typeof UntestedTouchResponse>;
```

Export it from `vendor/shared/index.ts` alongside the other contract
barrels. Also extend `PrMeta` in `contracts/platform.ts` with one more
nullish field, same convention as `score`/`findings_breakdown` ("null until
computed"), so the PR **list** view can render the badge without a second
request:

```ts
// PrMeta
untested_touch: z.boolean().nullish(),
```

## 5. Interface layer — `modules/coverage/routes.ts`

```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { UntestedTouchResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CoverageService } from './service.js';

/**
 * coverage module — "untested-touch" rule.
 *   GET  /pulls/:id/coverage           → cached flag, or compute-on-first-view.
 *   POST /pulls/:id/coverage/recompute → force a fresh check (e.g. after new commits).
 */
export default async function coverageRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CoverageService(app.container);

  app.get(
    '/pulls/:id/coverage',
    { schema: { params: IdParams, response: { 200: UntestedTouchResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getOrCompute(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/coverage/recompute',
    {
      schema: { params: IdParams, response: { 200: UntestedTouchResponse } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.recompute(workspaceId, req.params.id);
    },
  );
}
```

## 6. Wiring — `modules/index.ts` (this IS the DI registration point)

```ts
import coverage from './coverage/routes.js';
// ...
export const modules: Record<string, FastifyPluginAsync> = {
  // ...existing entries...
  brief,
  coverage,   // NEW
};
```

## 7. `platform/container.ts` — no change

This is the answer to "how do I wire it into the container": **you don't
add anything to `Container` for this feature.** The precedent
(`BlastService`, `BriefService`) is that a class-shaped feature service is
instantiated per-request in `routes.ts` via `new CoverageService(container)`,
and it only needs two things the container already exposes:

- `container.git` (existing `GitClient` getter — used for
  `fetchPullHead`/`readFile`)
- `container.db`, wrapped by a locally-constructed `ReviewRepository`
  (same pattern `BlastService`/`BriefService` use)

If this were introducing a genuinely new **adapter** (e.g. a real coverage
tool integration — Istanbul/`lcov.info` parsing, a CI coverage-report
fetcher) *that* adapter would get an interface in `vendor/shared/adapters.ts`,
a concrete class in `server/src/adapters/coverage/<impl>.ts`, a
`ContainerOverrides.coverage?: CoverageReportReader` entry, and a lazy getter
on `Container` — mirroring `codeIndex`/`depgraph`/`tokenizer`. The
path-heuristic version described above doesn't need that; it's a good
extension point to note in the plan, though.

## Dependency direction (onion, inside out)

```
rule.ts            (domain)        — no imports of anything below
   ^
service.ts          (application)  — imports rule.ts; depends on GitClient /
   ^                                  ReviewRepository *interfaces* only
routes.ts           (interface)     — imports service.ts + shared Zod contract
   ^
modules/index.ts    (composition)   — imports routes.ts, registers the plugin
platform/container.ts (composition) — already provides the two ports used;
                                       untouched by this feature
```

Nothing points outward from `rule.ts`; `service.ts` never imports Drizzle
table definitions or the concrete `SimpleGitClient`/adapters directly — it
only touches `container.git` (typed as `GitClient`) and `ReviewRepository`
(typed as itself, but callers of *its* methods never see `t.prBrief`
directly either — the jsonb-blob shape is an implementation detail hidden
inside `pull.repo.ts`).

## Testing shape this implies

- `rule.test.ts` — pure unit tests, table-driven over paths
  (`src/foo.ts` → `src/foo.test.ts` exists → not flagged; `src/bar.ts` → no
  candidate exists → flagged; `migrations/0012_x.sql` → skipped, etc). No DB,
  no git, no mocks.
- `service.test.ts` — unit test with `container.git` mocked
  (`src/adapters/mocks.ts` convention) and a mock `ReviewRepository`/db.
- `coverage.it.test.ts` — integration test (real PG via testcontainers,
  per the `*.it.test.ts` convention) verifying the `pr_brief.json` merge
  round-trips the `coverage` slice without clobbering an existing `brief`/
  `risks` slice.
