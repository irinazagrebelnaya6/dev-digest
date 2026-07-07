/**
 * `get_blast_radius` tool — STUB. Returns a stable `not_implemented` payload
 * with the final response shape so callers can integrate now. Validates input
 * shape (via the registered Zod schema) but does NOT resolve repo/pr — it just
 * echoes them back. `isError` is false: this is a successful, well-formed
 * "not yet implemented" response, not a failure.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Container } from '../../platform/container.js';
import type { GetBlastRadiusInput } from '../schemas.js';

export const GET_BLAST_RADIUS_DESCRIPTION =
  'Estimate the blast radius (impacted files/symbols) of a PR. NOT YET ' +
  'IMPLEMENTED — returns a stable `not_implemented` placeholder with the final ' +
  'response shape so callers can integrate against it now.';

const NOT_IMPLEMENTED_MESSAGE = 'Blast radius analysis is not yet implemented.';

export async function handleGetBlastRadius(
  _container: Container,
  input: GetBlastRadiusInput,
): Promise<CallToolResult> {
  const structuredContent = {
    status: 'not_implemented' as const,
    pr: { repo: input.repo, number: input.pr },
    impacted_files: [] as string[],
    impacted_symbols: [] as string[],
    risk_score: null,
    message: NOT_IMPLEMENTED_MESSAGE,
  };
  return {
    content: [{ type: 'text', text: `${NOT_IMPLEMENTED_MESSAGE} (${input.repo}#${input.pr})` }],
    structuredContent,
  };
}
