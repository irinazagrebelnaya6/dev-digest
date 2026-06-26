# client — implementation instructions

> Instructions for agents and developers working on this package.

## Adding a new page

1. Create `src/app/<route>/page.tsx` (Server Component by default)
2. Add data hooks in `src/lib/hooks/use-<resource>.ts` (TanStack Query)
3. API calls only through `src/lib/api.ts` — never raw `fetch`
4. Colocate component tests in `_components/<Name>/<Name>.test.tsx`
5. Add user-visible strings to `messages/<locale>/` via `useTranslations()`

## Adding a new hook

```ts
// src/lib/hooks/use-agents.ts
export function useAgents() {
  return useQuery({ queryKey: ['agents'], queryFn: () => api.get('/agents') })
}
```

## Testing checklist

- Mock `fetch` in tests — real API not needed
- Use `screen.getByRole` over `getByTestId`
- Test user interactions, not implementation details

## Specs

See [`specs/`](./specs/) for per-feature behaviour specifications.