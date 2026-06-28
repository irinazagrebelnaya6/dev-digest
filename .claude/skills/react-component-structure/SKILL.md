---
name: react-component-structure
description: Use when deciding where to place React components, hooks, utilities, or business logic — covers folder layout, co-location rules, and separation of concerns for the client/ package.
---

# React Component Structure

## Trigger

Use this skill when the user asks where to put a new component, hook, or utility, or when reviewing code for misplaced logic.

## Folder layout — `client/src/`

```
client/src/
├── app/                  # Next.js App Router pages and layouts only
│   └── (routes)/
├── components/
│   ├── ui/               # Dumb, reusable primitives (Button, Input, Badge)
│   │   └── button.tsx
│   ├── shared/           # Composed reusable components used in 2+ features
│   │   └── UserAvatar.tsx
│   └── <feature>/        # Feature-specific components, co-located with their feature
│       └── ReviewCard.tsx
├── features/             # One folder per product feature
│   └── reviews/
│       ├── ReviewList.tsx        # Container — calls hooks, passes data down
│       ├── ReviewCard.tsx        # Presentational — props only, no data fetching
│       ├── use-reviews.ts        # Data fetching hook (TanStack Query)
│       ├── reviews.schema.ts     # Zod schemas for API responses
│       └── reviews.types.ts      # TS types derived from schemas
├── hooks/                # Shared hooks used in 2+ features
│   └── use-debounce.ts
├── lib/                  # Pure functions with no React dependency
│   ├── format-date.ts
│   └── cn.ts             # className utility
└── types/                # Global shared types (not feature-specific)
```

## Rules

### 1. Co-locate first, extract when reused

Put a component next to the feature that owns it. Only move it to `components/shared/` or `hooks/` when a second feature needs it.

```
❌ components/ui/ReviewCard.tsx   ← not a primitive
✅ features/reviews/ReviewCard.tsx
```

### 2. Business logic belongs in hooks, not components

Never call `fetch`, transform API data, or compute derived state inside JSX. Put it in a `use-<noun>.ts` hook.

```tsx
// ❌ logic inside component
function ReviewList() {
  const [reviews, setReviews] = useState([]);
  useEffect(() => {
    fetch('/api/reviews').then(r => r.json()).then(setReviews);
  }, []);
  return reviews.filter(r => r.score > 0.5).map(r => <ReviewCard key={r.id} {...r} />);
}

// ✅ logic in hook, component is pure presentation
function ReviewList() {
  const { reviews } = useReviews();
  return reviews.map(r => <ReviewCard key={r.id} {...r} />);
}

// features/reviews/use-reviews.ts
function useReviews() {
  return useQuery({ queryKey: ['reviews'], queryFn: fetchReviews });
}
```

### 3. Containers vs. presentational

- **Container** (`ReviewList.tsx`) — calls hooks, handles loading/error states, composes layout.
- **Presentational** (`ReviewCard.tsx`) — receives props only, no `useQuery` / `useState` for async data, easy to test and Storybook.

Why: presentational components can be tested with RTL without mocking the network.

### 4. `lib/` = pure functions, no React

Anything without `use*`, JSX, or React imports goes in `lib/`. These are fully unit-testable.

```
❌ lib/use-format-date.ts   ← hooks don't belong in lib
✅ lib/format-date.ts
✅ hooks/use-debounce.ts
```

### 5. `components/ui/` = zero business logic

UI primitives must not know about API shape, feature state, or routing. They receive only generic props (children, className, variant, size).

```tsx
// ❌ ui component aware of domain
function Badge({ review }: { review: Review }) { ... }

// ✅ generic primitive
function Badge({ variant, children }: BadgeProps) { ... }
```

### 6. Feature Zod schemas live in `features/<name>/<name>.schema.ts`

Parse API responses at the boundary, not scattered across components.

```ts
// features/reviews/reviews.schema.ts
export const ReviewSchema = z.object({ id: z.string(), score: z.number() });
export type Review = z.infer<typeof ReviewSchema>;
```

## Anti-patterns

- ❌ Fetching data inside a `components/ui/` or `components/shared/` component
- ❌ Sharing state by lifting it all the way to `app/layout.tsx` instead of using context or a feature-level hook
- ❌ Dumping every new component into `components/` without a feature subfolder
- ❌ Writing helpers like `truncateText()` as hooks (`useTruncate`) — functions don't need the hook wrapper

## Decision tree

```
Is it a one-off, feature-specific component?
  → features/<feature>/
Is it used by 2+ features?
  → components/shared/
Is it a generic primitive (Button, Input)?
  → components/ui/
Is it async data + transforms?
  → features/<feature>/use-<noun>.ts
Is it a shared stateful pattern (debounce, media query)?
  → hooks/
Is it a pure function with no React?
  → lib/
```