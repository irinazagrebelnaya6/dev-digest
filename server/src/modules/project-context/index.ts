/**
 * Project Context Folder module barrel.
 *
 * `reader.ts` — doc discovery walk (screen + read-only listing).
 * `resolver.ts` — run-time resolve + traversal-guard + read + token-count;
 *   also the shared write-path guard primitives (`resolveWithinClone`,
 *   `assertWithinConfiguredRoot`, `hashContent`, `isUnderFixturesDir`).
 * `writer.ts` — write path (SPEC-02): create/update/upload/mkdir on the
 *   clone's working tree, no git.
 * `service.ts` — screen data + write endpoints' backing methods.
 * `routes.ts` — the Fastify plugin, registered in `modules/index.ts`.
 */
export * from './reader.js';
export * from './resolver.js';
export * from './writer.js';
export * from './service.js';
export { default as projectContextRoutes } from './routes.js';
