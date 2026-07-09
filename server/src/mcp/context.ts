/**
 * MCP-process tenancy helper. The MCP server bypasses `modules/_shared`'s
 * `getContext(container, req)` by design — there is no `FastifyRequest` in a
 * stdio process. Every handler/resource still scopes to the single seeded
 * workspace via `container.auth.currentWorkspace()`.
 *
 * The `AuthProvider` interface types the argument as `req: unknown` (used by
 * the HTTP path to read a cookie/header); `LocalNoAuthProvider` ignores it and
 * returns the default workspace. We pass `undefined` to satisfy the signature.
 */
import type { AuthWorkspace } from '@devdigest/shared';
import type { Container } from '../platform/container.js';

export function currentWorkspace(container: Container): Promise<AuthWorkspace> {
  return container.auth.currentWorkspace(undefined);
}
