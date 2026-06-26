# Spec: Run Cost Badge

**Feature:** Show cost (USD) and token counts of each review run.  
**Scope:** L01 lab — server contract + two UI placements. Zero extra LLM calls.

---

## 1. Rendering locations

### 1a. PR list — COST column

Column header: `COST`  
Cell content: compact badge

| State | Renders |
|---|---|
| Latest completed run exists | `$0.012` |
| No completed run yet | `—` |
| Cost cannot be estimated (no pricing) | `—` |

Grid: add one column to `GRID` in `constants.ts`, add `"cost"` to `COLUMN_KEYS`.

### 1b. PR Detail — verdict banner

Inline row below the summary text, left-aligned with the summary.

| State | Renders |
|---|---|
| Run completed, cost known | `$0.014 · 8.2K→1.3K` |
| Run completed, cost unknown (no pricing) | `8.2K→1.3K` (tokens only, no `$`) |
| Run status ≠ `done` | nothing rendered (no row) |

---

## 2. Formatting rules

### Cost (USD)

```
cost_usd < 0.001   → $0.000123   (6 decimal places)
cost_usd < 0.01    → $0.0042     (4 decimal places)
cost_usd < 0.1     → $0.012      (3 decimal places)
cost_usd < 1.00    → $0.14       (2 decimal places)
cost_usd >= 1.00   → $1.23       (2 decimal places)
```

Rule: always ≥3 significant digits. Never `$0.00` for a non-zero cost.

### Tokens

```
n < 1000    → "842"
n >= 1000   → "8.2K"   (one decimal, always shown)
```

Separator between in/out: `→` (U+2192).

### Detailed format assembly

```
$0.014 · 8.2K→1.3K
```

- `·` (U+00B7) as separator between cost and tokens
- If cost unknown: `8.2K→1.3K` (no cost prefix, no `·`)

- If tokens unknown: `$0.014` (no token suffix)

---

## 3. Server contract changes

### 3a. `RunSummary` — add `cost_usd`

**File:** `server/src/vendor/shared/contracts/review-api.ts`

```ts
export const RunSummary = z.object({
  // ... existing fields ...
  cost_usd: z.number().nullable(),   // null when status !== 'done' or pricing unavailable
});
```

### 3b. `PrMeta` — add `cost_usd`

**File:** `server/src/vendor/shared/contracts/platform.ts`

```ts
export const PrMeta = z.object({
  // ... existing fields ...
  cost_usd: z.number().nullish(),   // cost of the latest completed run; absent = no runs
});
```

---

## 4. Server implementation

### 4a. `ReviewService.listRuns()` — enrich with cost

**File:** `server/src/modules/reviews/service.ts`

`listRunsForPull()` in the repo doesn't have access to `priceBook`. Compute cost in the service after fetching:

```ts
async listRuns(workspaceId: string, prId: string): Promise<RunSummary[]> {
  const raw = await this.repo.listRunsForPull(workspaceId, prId);
  return raw.map((run) => ({
    ...run,
    cost_usd:
      run.status === 'done' &&
      run.tokens_in != null &&
      run.tokens_out != null &&
      run.model != null
        ? (this.container.priceBook.estimate(run.model, run.tokens_in, run.tokens_out) ?? null)
        : null,
  }));
}
```

No change to `run.repo.ts`.

### 4b. `GET /repos/:id/pulls` — latest run cost per PR

**File:** `server/src/modules/pulls/routes.ts`

After the existing `latestReviewByPr` query, add a cost lookup:

```ts
// Newest completed run per PR → cost for the COST column
const latestRunCostByPr = new Map<string, number | null>();
if (prIds.length > 0) {
  const runRows = await container.db
    .select({
      prId: t.agentRuns.prId,
      model: t.agentRuns.model,
      tokensIn: t.agentRuns.tokensIn,
      tokensOut: t.agentRuns.tokensOut,
    })
    .from(t.agentRuns)
    .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')))
    .orderBy(desc(t.agentRuns.ranAt));

  for (const r of runRows) {
    if (!latestRunCostByPr.has(r.prId)) {
      latestRunCostByPr.set(
        r.prId,
        r.model && r.tokensIn != null && r.tokensOut != null
          ? (container.priceBook.estimate(r.model, r.tokensIn, r.tokensOut) ?? null)
          : null,
      );
    }
  }
}
```

In the `return rows.map(...)` block, add `cost_usd`:

```ts
cost_usd: latestRunCostByPr.get(r.id) ?? null,
```

---

## 5. Client: `RunCostBadge` component

**New file:** `client/src/components/RunCostBadge/index.tsx`

```ts
interface RunCostBadgeProps {
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: 'compact' | 'detailed'; // default: 'compact'
  style?: React.CSSProperties;
}
```

**Behavior:**

| `variant` | `costUsd` | `tokensIn/Out` | Renders |
|---|---|---|---|
| `compact` | number | — | `$0.012` |
| `compact` | null/undefined | — | `—` |
| `detailed` | number | numbers | `$0.014 · 8.2K→1.3K` |
| `detailed` | null | numbers | `8.2K→1.3K` |
| `detailed` | number | null | `$0.014` |
| `detailed` | null | null | nothing (render null) |

Style: `font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums;`

**Helper functions (co-located, not exported):**

```ts
function formatCost(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01)  return `$${usd.toFixed(4)}`;
  if (usd < 0.1)   return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}
```

---

## 6. Client: PR list — COST column

### `constants.ts`

```ts
// Update GRID: add 72px column after "score" (60px)
export const GRID = "1fr 132px 92px 60px 72px 118px 78px";

// Add to COLUMN_KEYS after "score"
export const COLUMN_KEYS: string[] = [
  "pullRequest", "author", "size", "score", "cost", "status", "updated",
];
```

### `PRRow.tsx`

Add after the score cell:

```tsx
<div style={s.costCell}>
  <RunCostBadge costUsd={pr.cost_usd} />
</div>
```

Add `costCell` to `styles.ts`:
```ts
costCell: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
```

### PR list page header

Add `cost` translation key to i18n file (`list.columns.cost = "Cost"`).

---

## 7. Client: VerdictBanner — cost row

### `VerdictBanner.tsx`

Add props:

```ts
costUsd?: number | null;
tokensIn?: number | null;
tokensOut?: number | null;
```

Render below `{summary && <p ...>}`:

```tsx
{(costUsd != null || (tokensIn != null && tokensOut != null)) && (
  <RunCostBadge
    variant="detailed"
    costUsd={costUsd}
    tokensIn={tokensIn}
    tokensOut={tokensOut}
    style={{ marginTop: 4 }}
  />
)}
```

### `ReviewRunAccordion.tsx`

Add `runSummary?: RunSummary | null` prop. Pass cost fields to `VerdictBanner`:

```tsx
<VerdictBanner
  verdict={review.verdict}
  summary={review.summary}
  score={review.score}
  findingsCount={findings.length}
  blockers={blockers}
  agentName={review.agent_name}
  costUsd={runSummary?.cost_usd ?? null}
  tokensIn={runSummary?.tokens_in ?? null}
  tokensOut={runSummary?.tokens_out ?? null}
/>
```

### `FindingsTab.tsx`

Build a lookup map and pass to each accordion:

```tsx
// Before the JSX return:
const runByReviewRunId = React.useMemo(() => {
  const m = new Map<string, RunSummary>();
  if (prRuns) for (const r of prRuns) m.set(r.run_id, r);
  return m;
}, [prRuns]);

// In the accordion render:
<ReviewRunAccordion
  ...
  runSummary={review.run_id ? (runByReviewRunId.get(review.run_id) ?? null) : null}
/>
```

---

## 8. Files changed summary

| File | Type |
|---|---|
| `server/src/vendor/shared/contracts/review-api.ts` | Add `cost_usd` to `RunSummary` |
| `server/src/vendor/shared/contracts/platform.ts` | Add `cost_usd` to `PrMeta` |
| `server/src/modules/reviews/service.ts` | Compute cost in `listRuns()` |
| `server/src/modules/pulls/routes.ts` | Query latest run cost per PR |
| `client/src/components/RunCostBadge/index.tsx` | **New** component |
| `client/src/app/repos/[repoId]/pulls/constants.ts` | Add cost column to GRID + COLUMN_KEYS |
| `client/src/app/repos/[repoId]/pulls/styles.ts` | Add `costCell` style |
| `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx` | Render cost cell |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/VerdictBanner.tsx` | Add cost props + row |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx` | Add `runSummary` prop |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx` | Build run lookup, pass to accordion |
| i18n file (client) | Add `list.columns.cost` key |

---

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Run status is `running` / `failed` / `cancelled` | `cost_usd = null` → `—` |
| Model not in PriceBook + no fallback | `estimate()` returns `null` → `—` |
| PR has never been reviewed | `cost_usd` absent from `PrMeta` → `—` |
| `tokens_in = 0, tokens_out = 0` | `cost = 0` — show `$0.00` (legitimate zero-token run is impossible; if it appears it's a data bug, not a UI concern) |
| Review has no linked run (`run_id = null`) | `runSummary = null` → no cost row in banner |
