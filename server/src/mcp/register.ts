/**
 * Registers every MCP capability on an `McpServer`: 4 Tools + 1 Resource.
 * Each tool wires name, description, input Zod shape, `outputSchema`, and the
 * handler — wrapped by the shared error mapper (`toMcpError`) so any thrown
 * `AppError` becomes an actionable `{ code, message, retry }` result instead of
 * crashing the transport. Conventions are registered as a Resource, never a
 * tool (so they never appear in tools/list).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Container } from '../platform/container.js';
import { toMcpError } from './errors.js';
import {
  ListAgentsInputShape,
  ListAgentsOutputShape,
  RunAgentOnPrInputShape,
  RunAgentOnPrOutputShape,
  GetFindingsInputShape,
  GetFindingsOutputShape,
  GetBlastRadiusInputShape,
  GetBlastRadiusOutputShape,
} from './schemas.js';
import { handleListAgents, LIST_AGENTS_DESCRIPTION } from './tools/list-agents.js';
import { handleRunAgentOnPr, RUN_AGENT_ON_PR_DESCRIPTION } from './tools/run-agent-on-pr.js';
import { handleGetFindings, GET_FINDINGS_DESCRIPTION } from './tools/get-findings.js';
import { handleGetBlastRadius, GET_BLAST_RADIUS_DESCRIPTION } from './tools/get-blast-radius.js';
import { registerConventionsResource } from './resources/conventions.js';

/**
 * Adapt a pure `(container, input) => CallToolResult` handler into an SDK tool
 * callback, catching any thrown error and mapping it to an MCP error result.
 */
function toolCallback<I>(
  container: Container,
  handler: (container: Container, input: I) => Promise<CallToolResult>,
): (input: I) => Promise<CallToolResult> {
  return async (input: I) => {
    try {
      return await handler(container, input);
    } catch (err) {
      return toMcpError(err);
    }
  };
}

export function registerAll(server: McpServer, container: Container): void {
  server.registerTool(
    'list_agents',
    {
      description: LIST_AGENTS_DESCRIPTION,
      inputSchema: ListAgentsInputShape,
      outputSchema: ListAgentsOutputShape,
    },
    toolCallback(container, handleListAgents),
  );

  server.registerTool(
    'run_agent_on_pr',
    {
      description: RUN_AGENT_ON_PR_DESCRIPTION,
      inputSchema: RunAgentOnPrInputShape,
      outputSchema: RunAgentOnPrOutputShape,
    },
    toolCallback(container, handleRunAgentOnPr),
  );

  server.registerTool(
    'get_findings',
    {
      description: GET_FINDINGS_DESCRIPTION,
      // Flat shape (NOT the .refine()'d schema) — the run_id-XOR-(repo+pr) rule
      // is enforced inside the handler so it surfaces as a structured
      // VALIDATION_ERROR rather than a transport-level parse rejection.
      inputSchema: GetFindingsInputShape,
      outputSchema: GetFindingsOutputShape,
    },
    toolCallback(container, handleGetFindings),
  );

  server.registerTool(
    'get_blast_radius',
    {
      description: GET_BLAST_RADIUS_DESCRIPTION,
      inputSchema: GetBlastRadiusInputShape,
      outputSchema: GetBlastRadiusOutputShape,
    },
    toolCallback(container, handleGetBlastRadius),
  );

  registerConventionsResource(server, container);
}
