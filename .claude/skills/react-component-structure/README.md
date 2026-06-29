# React Component Structure Skill

## Motivation

React projects often grow into a flat `components/` dump where everything lives at the same level — API calls sit inside UI primitives, business logic is scattered across components, and reusable utilities are written as hooks even when they have no React dependency. The skill gives concrete, actionable rules for where each kind of code belongs, grounded in widely accepted community patterns.

## Sources

### Co-location and folder structure

- [Delightful React File/Directory Structure — Jack Herrington](https://www.jherr.dev/blog/delightful-react-file-directory-structure) — Feature-first co-location: keep files next to the feature that owns them, extract only when reused.
- [React Project Structure for Scale — Profy.dev](https://profy.dev/article/react-folder-structure) — Detailed walkthrough of `features/`, `components/ui/`, `hooks/`, `lib/` split and when to promote code between layers.
- [Screaming Architecture — Robert C. Martin](https://blog.cleancoder.com/uncle-bob/2011/09/30/Screaming-Architecture.html) — Foundational argument that a project's folder structure should reveal its domain, not its framework.

### Containers vs. presentational

- [Presentational and Container Components — Dan Abramov](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0) — Original formulation of the split. Abramov later qualified it (hooks changed things), but the core idea — separate data concerns from rendering — remains valid.
- [React component patterns — LogRocket](https://blog.logrocket.com/react-component-design-patterns-2022/) — Updated take on container/presentational, compound components, and render props in the hooks era.

### Custom hooks for business logic

- [Thinking in React — React docs](https://react.dev/learn/thinking-in-react) — Official guidance on separating state logic from rendering.
- [Making Sense of React Hooks — Dan Abramov](https://medium.com/@dan_abramov/making-sense-of-react-hooks-fdbde8803889) — Why hooks replace class-based lifecycle and the stateful logic can live outside components entirely.
- [How to write custom React hooks — Robin Wieruch](https://www.robinwieruch.de/react-custom-hook/) — Practical patterns for extracting data fetching and derived state into `use-<noun>.ts` hooks.

### `lib/` vs `hooks/` separation

- [You Might Not Need an Effect — React docs](https://react.dev/learn/you-might-not-need-an-effect) — Many things developers reach for `useEffect` for are better expressed as pure functions in `lib/`.
- [Where to put business logic in React — Khalil Stemmler](https://khalilstemmler.com/articles/client-side-architecture/layers/) — Layered client architecture: UI layer, application layer (hooks), domain layer (pure functions in `lib/`).

### Atomic / component hierarchy

- [Atomic Design — Brad Frost](https://atomicdesign.bradfrost.com/chapter-2/) — Conceptual basis for `atoms` (→ `ui/`), `molecules` (→ `shared/`), `organisms` (→ feature-level components).
- [Building a component library — Smashing Magazine](https://www.smashingmagazine.com/2021/03/building-component-library-react-typescript/) — Why UI primitives must be domain-agnostic to stay reusable.