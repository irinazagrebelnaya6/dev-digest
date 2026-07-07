/**
 * `get_conventions` — an MCP **Resource** (NOT a tool). Exposes each repo's
 * ACCEPTED conventions as markdown under `devdigest://{owner}/{name}/conventions`.
 * As a resource it costs zero startup tokens (never in tools/list); content
 * loads only when the client explicitly reads it (progressive disclosure).
 *
 * Onion: enumerates repos via `ReviewService.listRepos` and resolves the repo
 * via `ReviewService.resolveRepo` (application layer); reads accepted rules via
 * `ConventionsService.listAccepted`. No repository / Drizzle access here.
 */
import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { Container } from '../../platform/container.js';
import { ReviewService } from '../../modules/reviews/service.js';
import { ConventionsService } from '../../modules/conventions/service.js';
import { currentWorkspace } from '../context.js';
import { resolveRepoId } from '../resolvers.js';
import { toConventionsMarkdown } from '../tools/mappers.js';

const URI_TEMPLATE = 'devdigest://{owner}/{name}/conventions';
const MIME = 'text/markdown';

/** Coerce a template variable (`string | string[]`) to a single string. */
function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/**
 * `resources/list` body — one entry per repo in the workspace. Exported so it
 * is testable without spawning an `McpServer` / stdio transport.
 */
export async function listConventionResources(
  container: Container,
): Promise<{ resources: { uri: string; name: string; mimeType: string }[] }> {
  const ws = await currentWorkspace(container);
  const repos = await new ReviewService(container).listRepos(ws.id);
  return {
    resources: repos.map((r) => ({
      uri: `devdigest://${r.owner}/${r.name}/conventions`,
      name: `${r.fullName} conventions`,
      mimeType: MIME,
    })),
  };
}

/**
 * `resources/read` body — resolve `{owner}/{name}` → repoId → ACCEPTED
 * conventions rendered as markdown. Throws `REPO_NOT_FOUND` (via `resolveRepoId`)
 * for an unknown repo. Exported for direct testing.
 */
export async function readConventions(container: Container, uri: string, fullName: string): Promise<ReadResourceResult> {
  const ws = await currentWorkspace(container);
  const { repoId } = await resolveRepoId(new ReviewService(container), ws.id, fullName);
  const accepted = await new ConventionsService(container).listAccepted(ws.id, repoId);
  return {
    contents: [{ uri, mimeType: MIME, text: toConventionsMarkdown(accepted) }],
  };
}

export function registerConventionsResource(server: McpServer, container: Container): void {
  const template = new ResourceTemplate(URI_TEMPLATE, {
    list: () => listConventionResources(container),
  });

  server.registerResource(
    'conventions',
    template,
    {
      title: 'Repo conventions',
      description:
        'Accepted coding conventions for a repo, as markdown grouped by category. ' +
        'Only ACCEPTED conventions are exposed (pending/rejected are never surfaced).',
      mimeType: MIME,
    },
    (uri: URL, variables): Promise<ReadResourceResult> =>
      readConventions(container, uri.href, `${one(variables.owner)}/${one(variables.name)}`),
  );
}
