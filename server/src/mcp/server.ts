/**
 * DevDigest stdio MCP server — the composition root for the MCP process (like
 * `server/src/app.ts` for the HTTP process, but builds NO Fastify app). It owns
 * the `Container`, the DB handle, and graceful shutdown.
 *
 * CRITICAL: stdout is the JSON-RPC channel. All logging goes to **stderr**
 * (`console.error`) — a stray `console.log` corrupts the protocol stream.
 *
 * Launch:  cd server && pnpm mcp   (needs Postgres up + ~/.devdigest/secrets.json)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpContainer } from './bootstrap.js';
import { registerAll } from './register.js';

/** stderr-only logger — never write to stdout in this process. */
function log(msg: string): void {
  process.stderr.write(`[mcp] ${msg}\n`);
}

async function main(): Promise<void> {
  const { container, close } = await buildMcpContainer();

  const server = new McpServer({ name: 'devdigest', version: '0.1.0' });
  registerAll(server, container);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('DevDigest MCP server started on stdio (4 tools + conventions resource).');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}, shutting down…`);
    try {
      await server.close();
    } catch (err) {
      log(`error closing server: ${(err as Error).message}`);
    }
    try {
      await close();
    } catch (err) {
      log(`error closing DB handle: ${(err as Error).message}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
