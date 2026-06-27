# Run Cost Badge

**name:** run-cost-badge  
**description:** Show cost (USD) and token counts of each review run in the PR list (compact) and on the PR Detail verdict banner (detailed).

---

## What we build

| Location | Format | Example |
|---|---|---|
| PR list → COST column | compact | `$0.012` |
| PR Detail → verdict banner | detailed | `$0.014 · 8.2K→1.3K` |

## Constraints

- Zero extra LLM calls — data already exists: `tokensIn`/`tokensOut` in `agent_runs`, `PriceBook` in `container`
- `status !== 'done'` → `cost_usd = null` → renders `—`, never `$0.00`
- Format: ≥3 significant digits (`$0.012`, not `$0.01`)

---

## Data flow

```
agent_runs.tokensIn/tokensOut + agent_runs.model
  → container.priceBook.estimate(model, tokensIn, tokensOut)
  → cost_usd (number | null)
  → RunSummary.cost_usd  (run history endpoint)
  → PrMeta.cost_usd      (PR list endpoint — latest completed run per PR)
  → RunCostBadge (client component, 2 variants)
```

---

## Server changes

### 1. `review-api.ts` — add `cost_usd` to `RunSummary`

```ts
// server/src/vendor/shared/contracts/review-api.ts
export const RunSummary = z.object({
  ...
  cost_usd: z.number().nullable(),   // ← add
});
```

### 2. `service.ts` — compute cost in `listRuns()`

In `ReviewService.listRuns()`, after `this.repo.listRunsForPull()`, enrich each run:

```ts
const raw = await this.repo.listRunsForPull(workspaceId, prId);
return raw.map((run) => ({
  ...run,
  cost_usd:
    run.status === 'done' && run.tokensIn != null && run.tokensOut != null
      ? (this.container.priceBook.estimate(run.model, run.tokensIn, run.tokensOut) ?? null)
      : null,
}));
```

### 3. `platform.ts` — add `cost_usd` to `PrMeta`

```ts
export const PrMeta = z.object({
  ...
  cost_usd: z.number().nullish(),   // ← add; latest completed run's cost
});
```

### 4. `pulls/routes.ts` — query latest run cost per PR

After the existing `latestReviewByPr` query, add a similar query for `agent_runs`:

```ts
// Newest completed run per PR → cost for the COST column
const latestRunByPr = new Map<string, { model: string; tokensIn: number; tokensOut: number }>();
if (prIds.length > 0) {
  const runRows = await container.db
    .select({ prId: t.agentRuns.prId, model: t.agentRuns.model,
              tokensIn: t.agentRuns.tokensIn, tokensOut: t.agentRuns.tokensOut })
    .from(t.agentRuns)
    .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')))
    .orderBy(desc(t.agentRuns.ranAt));
  for (const r of runRows) {
    if (!latestRunByPr.has(r.prId)) latestRunByPr.set(r.prId, r);
  }
}
// Use in the return map:
const runData = latestRunByPr.get(r.id);
const cost_usd = runData
  ? (container.priceBook.estimate(runData.model, runData.tokensIn ?? 0, runData.tokensOut ?? 0) ?? null)
  : null;
```

---

## Client changes

### 5. `RunCostBadge` — new shared component

**File:** `client/src/components/RunCostBadge/index.tsx`

Props:
```ts
interface RunCostBadgeProps {
  costUsd: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: 'compact' | 'detailed'; // default: 'compact'
}
```

Renders:
- `null/undefined` → `—`
- `compact`: `$0.012`
- `detailed`: `$0.014 · 8.2K→1.3K`

Format rule: `$` + `toPrecision(3)` for values < $1, else `toFixed(2)`.

Token format: `n >= 1000 ? (n/1000).toFixed(1) + 'K' : String(n)`.

### 6. PR list — add COST column

**Files to touch:**
- `client/src/app/repos/[repoId]/pulls/_components/PRRow/` — add `costUsd` prop, render `<RunCostBadge>`
- `client/src/app/repos/[repoId]/pulls/constants.ts` (or wherever `COLUMN_KEYS` lives) — add `'cost'` column

### 7. VerdictBanner — add cost row

**File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/VerdictBanner.tsx`

Add props: `costUsd?: number | null`, `tokensIn?: number | null`, `tokensOut?: number | null`

Render `<RunCostBadge variant="detailed" .../>` below the score.

**File:** `FindingsTab` or `ReviewRunAccordion` — pass run data to VerdictBanner

Match `review.run_id → runs[]` (from `usePrRuns()`) to get tokensIn/tokensOut/cost_usd.

---

## Files touched

| File | Change |
|---|---|
| `server/src/vendor/shared/contracts/review-api.ts` | Add `cost_usd` to `RunSummary` |
| `server/src/vendor/shared/contracts/platform.ts` | Add `cost_usd` to `PrMeta` |
| `server/src/modules/reviews/service.ts` | Enrich runs with cost in `listRuns()` |
| `server/src/modules/pulls/routes.ts` | Query + expose latest run cost in PR list |
| `client/src/components/RunCostBadge/index.tsx` | **New** — 2-variant cost badge |
| `client/src/app/repos/[repoId]/pulls/_components/PRRow/` | Add cost column |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/VerdictBanner.tsx` | Add cost row |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/` | Wire run → verdict banner |

## Verification checklist (from slides)

- [ ] Cost figure matches the run log and OpenRouter dashboard (check on one real run)
- [ ] Format shows ≥3 significant digits (`$0.012` not `$0.01`)
- [ ] Stale/running/failed run → `—` shown, never `$0.00`
- [ ] Zero extra LLM calls made
