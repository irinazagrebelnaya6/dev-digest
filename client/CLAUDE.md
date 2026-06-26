# client/ — context map

## Gotchas (not obvious from the code)

**`src/vendor/` are local copies, not node_modules** — `vendor/ui/` and `vendor/shared/` are source files edited in-place. Do not `pnpm install` to update them. tsconfig path aliases point to them.

**API calls only through `src/lib/api.ts`** — never raw `fetch` in components or hooks.

**TanStack Query for all remote data** — no `useState` for anything that comes from the API.

**`'use client'` as deep as possible** — push it to the leaf component, not the page. Pages are RSC by default.

**Feature logic is colocated** — `src/app/<route>/_components/<Name>/` with `<Name>.test.tsx`. No centralized `src/components/features/`.

**All user-visible strings go through `useTranslations()`** — messages live in `messages/<locale>/`. Hardcoded strings in JSX block localization.

## Read when...
- Route map + stack + testing → `client/README.md`
- Architecture decisions → `docs/client/README.md`
- Implementation instructions → `docs/client/INSTRUCTIONS.md`