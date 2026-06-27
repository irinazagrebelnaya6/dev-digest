# client — architecture & decisions

> Single source of truth for non-obvious design decisions in `@devdigest/web`.
> The UI route map and stack details live in `client/README.md` — read that first.

## Key architectural decisions

### 1. All API calls through `src/lib/api.ts`
One typed fetch client, one place for error handling (`ApiError`), one place to change the base URL or add auth headers. Never call `fetch` directly in components or hooks — always go through `api.get()`/`api.post()`.

### 2. All server state in TanStack Query hooks
Remote data lives only in `src/lib/hooks/*`. No `useState` for anything that comes from the API. This makes cache invalidation, loading states, and optimistic updates consistent across the app.

### 3. `vendor/` are local copies, not node_modules
`src/vendor/ui/` (`@devdigest/ui`) and `src/vendor/shared/` (`@devdigest/shared`) are source files edited in-place. They are **not** installed from npm. Do not run `pnpm install` to "update" them — edit the files directly. tsconfig path aliases point to them.

### 4. Pages are Server Components by default
App Router pages are RSC unless they need hooks or browser APIs, in which case they get `'use client'`. TanStack Query's `useQuery` always requires `'use client'`. Keep `'use client'` boundaries as deep as possible — push them down to the leaf component that needs interactivity, not the whole page.

### 5. Feature logic is colocated, not centralized
Feature components live in `src/app/<route>/_components/<Name>/` alongside their tests (`<Name>.test.tsx`). Pages are thin shells that compose components. There is no `src/components/features/` directory.

### 6. i18n for all user-visible strings
`next-intl` is wired. All user-visible strings go in `messages/<locale>/` and are accessed via `useTranslations()`. Hardcoded strings in JSX are a bug — they block localization.

### 7. `g`-then-key shortcuts in app-shell
Keyboard shortcuts are registered in `src/components/app-shell/`. Check existing bindings before adding new ones. The pattern is `g` → navigation prefix, then a single letter.

## Extending the client

**New page:** `src/app/<route>/page.tsx` (RSC) + hook in `src/lib/hooks/` + strings in `messages/`.

**New hook:**
```ts
export function useResource() {
  return useQuery({ queryKey: ['resource'], queryFn: () => api.get('/resource') })
}
```

**New component:** colocate in `_components/<Name>/` with `<Name>.test.tsx`. Test with vitest + jsdom — no API, no browser needed.

## Specs
Per-feature behaviour specs → [`specs/`](./specs/)