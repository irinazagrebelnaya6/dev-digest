/**
 * Project Context Folder (SPEC-01, Feature 1) module barrel.
 *
 * `reader.ts` — doc discovery walk (screen + read-only listing).
 * `resolver.ts` — run-time resolve + traversal-guard + read + token-count.
 * `service.ts` — screen data (`GET /repos/:id/project-context`).
 * `routes.ts` — the Fastify plugin, registered in `modules/index.ts`.
 */
export * from './reader.js';
export * from './resolver.js';
export * from './service.js';
export { default as projectContextRoutes } from './routes.js';
