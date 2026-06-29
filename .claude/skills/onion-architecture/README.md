# Onion Architecture — Backend Skill

Best practices, articles, and anti-patterns for implementing Onion Architecture (also known as Clean / Hexagonal / Ports & Adapters Architecture) in Node.js + TypeScript backends.

---

## Core Principles

1. **Dependency Rule — always inward.** Dependencies may only point toward the center. Domain knows nothing about use cases; use cases know nothing about adapters or frameworks.
2. **Domain is the center, infrastructure is a detail.** Innermost ring = pure domain entities and business rules, zero framework imports.
3. **Ports are interfaces; adapters are implementations.** A Port is a TypeScript `interface` defining *what* needs to happen. An Adapter is the concrete class implementing it.
4. **Dependency Injection wires it together at startup.** Adapters are never instantiated inside services. A composition root constructs and injects them.
5. **Use Cases orchestrate domain logic.** One use case per business operation; no HTTP/DB-specific code inside.
6. **Domain models are not ORM entities.** Map between ORM rows and domain models at the adapter boundary.
7. **Design from the inside out.** Domain first → ports → adapters. Never start from the DB schema.

---

## Articles and Resources

### Foundational Reading

| Title | URL | What it Covers |
|---|---|---|
| Implementing Onion Architecture in Node.js with TypeScript and InversifyJS | https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad | Full Node.js/TS walkthrough using InversifyJS for DI, concrete folder layout, SOLID principles applied layer by layer |
| Domain-Driven Hexagon (TypeScript + NestJS) | https://dev.to/sairyss/domain-driven-hexagon-18g5 | Most comprehensive practical guide: DDD + Hexagonal, covers aggregates, ports, use cases, error handling, validation — all in TypeScript |
| GitHub: Sairyss/domain-driven-hexagon | https://github.com/Sairyss/domain-driven-hexagon | Reference implementation with extensive TypeScript code examples covering every layer with real patterns |

### Practical Implementation

| Title | URL | What it Covers |
|---|---|---|
| Clean Architecture with TypeScript: DDD + Onion | https://bazaglia.com/clean-architecture-with-typescript-ddd-onion/ | Concise guide combining DDD tactical patterns with Onion structure in TypeScript |
| Hexagonal Architecture — Complete Guide with TypeScript | https://generalistprogrammer.com/tutorials/hexagonal-architecture-complete-guide | Full TypeScript code example and explanation of ports/adapters wiring |
| Ports and Adapters with TypeScript | https://betterprogramming.pub/how-to-ports-and-adapter-with-typescript-32a50a0fc9eb | Focused walkthrough on the port/adapter pattern in TS and interface boundary design |
| Structuring a Node.js Project with Hexagonal Architecture | https://medium.com/@yecaicedo/structuring-a-node-js-project-with-hexagonal-architecture-7be2ef1364e2 | Practical folder structure and module organization for Node.js projects |
| Clean Architecture with Node.js and TypeScript | https://forsenior.dev/blog/nodejs/patterns/clean-architecture | Senior-level walkthrough of Clean Architecture patterns in Node.js |

### Tooling and Enforcement

| Title | URL | What it Covers |
|---|---|---|
| Enforce Clean Architecture with fresh-onion | https://dev.to/remojansen/enforce-clean-architecture-in-your-typescript-projects-with-fresh-onion-45pi | Static tooling to enforce layer boundaries in TypeScript projects at CI time |

### Architecture Comparison and Theory

| Title | URL | What it Covers |
|---|---|---|
| Hexagonal vs Clean vs Onion — Choosing the Right Architecture | https://programmingpulse.vercel.app/blog/hexagonal-vs-clean-vs-onion-architectures | Side-by-side comparison of the three variants to help pick the right framing |
| Onion Architecture — Going Beyond Layers | https://blog.ndepend.com/onion-architecture-layers/ | Deep structural analysis of the rings model; good conceptual grounding |
| Overengineering in Onion/Hexagonal Architectures | https://victorrentea.ro/blog/overengineering-in-onion-hexagonal-architectures/ | When the architecture adds cost without benefit and how to calibrate |
| Hexagonal Architecture in Node.js Microservices | https://medium.com/@shreevedhas/hexagonal-architecture-in-node-js-microservices-a-practical-guide-e3419f2c94b3 | Practical guide for applying hexagonal architecture in microservices context |

---

## Anti-Patterns to Avoid

| Anti-Pattern | Why It Breaks Things |
|---|---|
| Leaking infrastructure into the domain | `import { Column } from 'typeorm'` on a domain class breaks the dependency rule |
| Starting design from the database | Produces anemic domain models that are just DB row mirrors |
| Anemic domain models | Business rules end up in a service layer; domain is just a bag of fields |
| One giant repository interface | Violates ISP; prefer narrow, use-case-specific query interfaces |
| Instantiating adapters inside use cases | `new PostgresUserRepository()` inside a use case defeats DI and kills unit testing |
| Useless 1-to-1 interfaces | Interface for every class with a single implementation adds ceremony with no benefit |
| Controller calling repository directly | Bypasses the use case layer; collapses the application layer |
| Applying Onion to simple CRUD | If there is no real business logic, the overhead is not justified |
| No layer enforcement tooling | Cross-layer imports silently degrade the architecture without a linter guard |

---

## Node.js / TypeScript Specifics

- **No runtime layer enforcement** — use `eslint-plugin-boundaries` or `fresh-onion` in CI to enforce import direction at compile time.
- **`interface` is the natural Port type** — use `abstract class` only when DI metadata requires it (e.g., NestJS token injection).
- **DI options** — InversifyJS (standalone), NestJS DI (framework-bundled), or manual constructor injection with a composition root file. Manual injection avoids framework coupling.
- **Avoid `reflect-metadata` in domain code** — decorators tie your domain to a DI/ORM framework; keep the domain decorator-free.
- **Map at the boundary** — write explicit mapper functions at the adapter layer. Drizzle/Prisma/TypeORM row types must not leak past the adapter.
- **Zod belongs at the adapter boundary** — validate external input before it enters the use case; do not use Zod schemas as your domain model.
- **Test seams are the biggest benefit** — ports as interfaces → use cases unit-tested with in-memory mock adapters; integration tests test only adapter implementations against real infrastructure.

---

## Relevance to This Codebase (DevDigest)

DevDigest already applies several of these patterns:

- `server/src/modules/_shared/` — tenancy guard and context scoping (application layer concern)
- `src/adapters/` — concrete adapter implementations injected via `ContainerOverrides`
- `src/adapters/mocks.ts` — in-memory mock adapters for unit tests
- `src/adapters/secrets/local.ts` — the only file allowed to read secrets (adapter boundary)
- `reviewer-core/` — pure domain/engine functions with zero DB/network dependencies
- `fastify-type-provider-zod` — Zod used at the route/adapter layer, not in the domain