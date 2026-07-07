/**
 * MCP composition root helper. `server/src/mcp/server.ts` (next phase) IS the
 * composition root for the stdio process (mirrors `server/src/app.ts`), but it
 * builds no Fastify app — this module factors out just the `Container` +
 * `Db` wiring so both `server.ts` and integration tests can build a
 * `Container` on a (real or test) Postgres without duplicating `app.ts`'s
 * `loadConfig()` → `createDb()` → `new Container(...)` sequence.
 */
import { loadConfig } from '../platform/config.js';
import { createDb } from '../db/client.js';
import { Container, type ContainerOverrides } from '../platform/container.js';

export interface McpContainerHandle {
  container: Container;
  /** Disposes the DB handle this call created — mirrors `app.ts`'s `onClose`
   *  hook (`handle.close()`), so callers get the exact same teardown. */
  close: () => Promise<void>;
}

/**
 * Build a `Container` for the MCP process (or for `*.it.test.ts` handler
 * tests) exactly the way `app.ts` does, WITHOUT constructing a Fastify app —
 * the MCP server calls services in-process over stdio, never over HTTP.
 *
 * Tests pass `overrides` (e.g. `{ llm: { openai: mock, anthropic: mock,
 * openrouter: mock } }`, via `src/adapters/mocks.ts`) the same way
 * `buildApp({ overrides })` does.
 */
export async function buildMcpContainer(overrides?: ContainerOverrides): Promise<McpContainerHandle> {
  const config = loadConfig();
  const handle = createDb(config.databaseUrl);
  const container = new Container(config, handle.db, overrides);
  return { container, close: () => handle.close() };
}
