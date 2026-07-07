/**
 * `list_agents` tool — read-only listing of the workspace's review agents.
 * Calls the APPLICATION layer (`AgentsService.list`) only; `enabled_only`
 * filters on the DTO's `enabled` flag (no repo access from the MCP layer).
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Container } from '../../platform/container.js';
import { AgentsService } from '../../modules/agents/service.js';
import { currentWorkspace } from '../context.js';
import { toMcpAgent } from './mappers.js';
import type { ListAgentsInput } from '../schemas.js';

export const LIST_AGENTS_DESCRIPTION =
  'List the review agents configured in this workspace. Returns each agent id, ' +
  'name, description, provider, model, and enabled flag. No side effects. Call ' +
  'this first to pick an `agent` id for run_agent_on_pr.';

export async function handleListAgents(
  container: Container,
  input: ListAgentsInput,
): Promise<CallToolResult> {
  const ws = await currentWorkspace(container);
  const service = new AgentsService(container);
  const all = await service.list(ws.id);
  const selected = input.enabled_only ? all.filter((a) => a.enabled) : all;
  const agents = selected.map(toMcpAgent);
  const structuredContent = { agents, total: agents.length };

  const text = agents.length
    ? `${agents.length} agent(s):\n` +
      agents.map((a) => `- ${a.name} (${a.provider}/${a.model})${a.enabled ? '' : ' [disabled]'} — ${a.agent_id}`).join('\n')
    : input.enabled_only
      ? 'No enabled agents in this workspace.'
      : 'No agents configured in this workspace.';

  return { content: [{ type: 'text', text }], structuredContent };
}
