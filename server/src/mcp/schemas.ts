/**
 * MCP SDK API note (@modelcontextprotocol/sdk v1.29.0) — read this before
 * writing `register.ts` / `tools/*.ts` / `resources/*.ts` (next phase).
 * Verified directly against `server/node_modules/@modelcontextprotocol/sdk/
 * dist/{esm,cjs}/**\/*.d.ts` (both trees agree) on 2026-07-04.
 *
 * IMPORT SPECIFIERS
 *   The published `package.json#exports` map has NO dedicated
 *   `"./server/mcp"` / `"./server/stdio"` entries — only `"."`, `"./client"`,
 *   `"./server"`, `"./validation"`, `"./validation/ajv"`,
 *   `"./validation/cfworker"`, `"./experimental"`,
 *   `"./experimental/tasks"`, and a catch-all `"./*"` that maps to
 *   `dist/esm/*` (import) / `dist/cjs/*` (require). The deep paths below
 *   resolve via that wildcard and DO exist on disk (dist/esm/server/mcp.js,
 *   dist/esm/server/stdio.js, dist/esm/types.js) — this is the same import
 *   style used throughout the MCP ecosystem's examples and still works here:
 *     import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
 *     import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
 *     import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
 *
 * TOOL REGISTRATION — `McpServer#registerTool`
 *     server.registerTool(
 *       name: string,
 *       config: {
 *         title?: string;
 *         description?: string;
 *         inputSchema?: InputArgs;   // ZodRawShapeCompat | AnySchema | undefined
 *         outputSchema?: OutputArgs; // ZodRawShapeCompat | AnySchema
 *         annotations?: ToolAnnotations;
 *         _meta?: Record<string, unknown>;
 *       },
 *       cb: (args: ShapeOutput<InputArgs>, extra) => CallToolResult | Promise<CallToolResult>,
 *     ): RegisteredTool
 *
 *   ZOD-SHAPE-VS-OBJECT ANSWER: `ZodRawShapeCompat = Record<string, AnySchema>`
 *   — i.e. a PLAIN OBJECT whose values are Zod types (a "raw shape"), NOT a
 *   `z.object({...})` instance. BUT `inputSchema`/`outputSchema` are typed as
 *   `ZodRawShapeCompat | AnySchema` where `AnySchema = z3.ZodTypeAny |
 *   z4.$ZodType` — so a full composed `ZodObject` (or a `ZodEffects` produced
 *   by `.refine()`, needed for `get_findings`'s run_id-XOR-repo+pr rule) is
 *   ALSO accepted, since both are `ZodTypeAny`. Internally the SDK normalizes
 *   either form to an object schema via `normalizeObjectSchema()`
 *   (server/zod-compat.ts). Convention adopted here: export the plain RAW
 *   SHAPE (`*InputShape`) for every tool so `registerTool` can use it
 *   directly and get `ShapeOutput<Shape>` key-by-key inference; ALSO export a
 *   composed `z.object(...)` (`*Input`) for schemas that need cross-field
 *   validation (only `get_findings`) or for use outside tool registration
 *   (parsing in tests, handler-internal re-validation).
 *
 * HANDLER RETURN TYPE — `CallToolResult` (types.ts, `CallToolResultSchema`):
 *     {
 *       content: (TextContent | ImageContent | AudioContent | ResourceLink |
 *         EmbeddedResource)[];  // defaults to [] if omitted
 *       structuredContent?: Record<string, unknown>;
 *       isError?: boolean;
 *       _meta?: Record<string, unknown>;
 *     }
 *   Convention adopted here (per the plan's "outputSchema... with a
 *   human-readable text fallback" acceptance criterion): every handler
 *   returns BOTH `content: [{ type: 'text', text: <human summary> }]` AND
 *   `structuredContent` (matching this file's `*Output` schema) on success;
 *   `errors.ts#toMcpError` returns `{ isError: true, structuredContent: {
 *   code, message, retry }, content: [{ type: 'text', text }] }` on failure.
 *
 * RESOURCES (dynamic URI templates) — `McpServer#registerResource` +
 * `ResourceTemplate` (both from `.../server/mcp.js`):
 *     new ResourceTemplate(uriTemplate: string, { list: ListResourcesCallback | undefined, complete?: {...} })
 *     server.registerResource(
 *       name: string,
 *       uriOrTemplate: ResourceTemplate,
 *       config: ResourceMetadata,  // { title?, description?, mimeType?, ... } (Omit<Resource,'uri'|'name'>)
 *       readCallback: (uri: URL, variables: Variables, extra) => ReadResourceResult | Promise<ReadResourceResult>,
 *     ): RegisteredResourceTemplate
 *   `ReadResourceResult.contents: [{ uri, mimeType?, text } | { uri, mimeType?, blob }]`.
 *   The `list` callback returns `ListResourcesResult` (`{ resources: [{ uri,
 *   name, mimeType? }, ...] }`) — this is how `get_conventions`'s
 *   `resources/list` enumerates one entry per repo in the workspace.
 *
 * TRANSPORT — `StdioServerTransport` (`.../server/stdio.js`):
 *     const transport = new StdioServerTransport(); // reads stdin, writes stdout
 *     await server.connect(transport); // McpServer#connect(transport: Transport): Promise<void>
 *   stdout carries ONLY JSON-RPC — `server.ts` must never `console.log` /
 *   construct a Fastify app (which logs to stdout by default); log to
 *   stderr only (`console.error` / a pino instance configured with
 *   `destination: 2`).
 *
 * ZOD VERSION: this package (`server/`) depends on `zod@^3.24.1` (v3). The
 * SDK's `AnySchema` union (`z3.ZodTypeAny | z4.$ZodType`) accepts v3 schemas
 * directly (`zod-compat.ts` imports `zod/v3` types for exactly this) — no
 * shim / adapter needed to use this repo's regular `import { z } from 'zod'`
 * schemas as tool input/output schemas.
 *
 * Everything below is LOCAL to the MCP adapter — none of it is added to
 * `vendor/shared/` (see plan: "No new vendor/shared/ contracts; MCP I/O
 * schemas are defined locally under server/src/mcp/").
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives (mirror the vendor/shared `Severity`/`FindingCategory`
// enums value-for-value so MCP output stays wire-compatible with the rest of
// the app, without importing/re-exporting the shared schema objects
// themselves — this file must stay fully local).
// ---------------------------------------------------------------------------

export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type Severity = z.infer<typeof Severity>;

export const FindingCategory = z.enum(['bug', 'security', 'perf', 'style', 'test']);
export type FindingCategory = z.infer<typeof FindingCategory>;

/** `"owner/name"` — never a UUID. Resolved via `repos_ws_fullname_uq`. */
export const RepoFullName = z
  .string()
  .regex(/^[^/]+\/[^/]+$/, 'expected "owner/name", e.g. acme/payments-api')
  .describe('owner/name, e.g. acme/payments-api');

/** PR number (not a UUID). Resolved via `pr_repo_number_uq`. */
export const PrNumber = z.number().int().min(1).describe('PR number, e.g. 482');

/**
 * A single curated finding — 9 fields only (drops `id`, `review_id`, `kind`,
 * `trifecta_components`, `evidence`, `accepted_at`, `dismissed_at` from the
 * internal DTO). Shared by both the `run_agent_on_pr` blocking result and the
 * `get_findings` read, so it lives with the shared primitives (declared before
 * either tool's output schema references it).
 */
export const McpFinding = z.object({
  severity: Severity,
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  category: FindingCategory,
  title: z.string(),
  rationale: z.string(),
  suggestion: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type McpFinding = z.infer<typeof McpFinding>;

/**
 * A run's lifecycle state as surfaced to MCP callers. `agent_runs.status` is
 * `running | done | failed | cancelled`; `cancelled` collapses to `failed` and
 * a run/review that hasn't produced anything yet is `pending`.
 */
export const RunStatus = z.enum(['running', 'done', 'failed', 'pending']);
export type RunStatus = z.infer<typeof RunStatus>;

/** Pre-aggregated severity counts over ALL of a review's findings (computed
 *  before any `severity` filter / pagination is applied). */
export const SeverityBreakdown = z.object({
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
});
export type SeverityBreakdown = z.infer<typeof SeverityBreakdown>;

// ---------------------------------------------------------------------------
// 1. list_agents — Tool
// ---------------------------------------------------------------------------

export const ListAgentsInputShape = {
  enabled_only: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'true = only agents that would run when run_agent_on_pr omits `agent` (i.e. AgentsService.listEnabled).',
    ),
};
export const ListAgentsInput = z.object(ListAgentsInputShape);
export type ListAgentsInput = z.infer<typeof ListAgentsInput>;

export const McpAgent = z.object({
  agent_id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean(),
});
export type McpAgent = z.infer<typeof McpAgent>;

export const ListAgentsOutputShape = {
  agents: z.array(McpAgent),
  total: z.number().int(),
};
export const ListAgentsOutput = z.object(ListAgentsOutputShape);
export type ListAgentsOutput = z.infer<typeof ListAgentsOutput>;

// ---------------------------------------------------------------------------
// 2. run_agent_on_pr — Tool
// ---------------------------------------------------------------------------

export const RunAgentOnPrInputShape = {
  repo: RepoFullName,
  pr: PrNumber,
  agent: z
    .string()
    .optional()
    .describe('Agent id (UUID) to run. Omit to run ALL enabled agents.'),
  idempotency_key: z
    .string()
    .optional()
    .describe(
      'Client-generated key. ADVISORY ONLY — there is no dedup store yet; a repeated call with the same key still creates new runs.',
    ),
};
export const RunAgentOnPrInput = z.object(RunAgentOnPrInputShape);
export type RunAgentOnPrInput = z.infer<typeof RunAgentOnPrInput>;

/** The identity of a single agent's run (produced up front by `queueRuns`). */
export const McpRunHandle = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type McpRunHandle = z.infer<typeof McpRunHandle>;

/**
 * A completed run: its handle PLUS the settled outcome. `run_agent_on_pr` is
 * BLOCKING (see plan/decision) — it awaits every queued run and returns the
 * findings inline, so a caller gets "a completed result, not an operation" in
 * one round-trip. `status` is `done` on success, `failed` when the run errored
 * (e.g. a missing provider key), in which case `score` is null and `findings`
 * is empty. `get_findings` remains for cheap re-reads / pagination.
 */
export const McpRunResult = McpRunHandle.extend({
  status: RunStatus,
  score: z.number().nullable(),
  breakdown: SeverityBreakdown,
  findings: z.array(McpFinding),
});
export type McpRunResult = z.infer<typeof McpRunResult>;

export const RunAgentOnPrOutputShape = {
  runs: z.array(McpRunResult),
};
export const RunAgentOnPrOutput = z.object(RunAgentOnPrOutputShape);
export type RunAgentOnPrOutput = z.infer<typeof RunAgentOnPrOutput>;

// ---------------------------------------------------------------------------
// 3. get_findings — Tool
// ---------------------------------------------------------------------------

export const GetFindingsInputShape = {
  run_id: z.string().optional().describe('A specific run id from run_agent_on_pr.'),
  repo: RepoFullName.optional(),
  pr: PrNumber.optional(),
  severity: Severity.optional().describe('Filter to a single severity.'),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().optional().describe('Opaque pagination cursor from a previous response.'),
};

/**
 * Flat shape + a cross-field refine (MCP tool input must be a flat Zod
 * shape/object — no nested "oneOf" unions on the wire): exactly one of
 * `run_id` or (`repo` + `pr`) must be provided. Passed to `registerTool` as
 * `inputSchema` directly — the SDK accepts a full `ZodEffects` (a
 * `ZodTypeAny`), not just a raw shape; see the SDK note above.
 */
export const GetFindingsInput = z.object(GetFindingsInputShape).refine(
  (v) => {
    const hasRunId = v.run_id !== undefined;
    const hasRepo = v.repo !== undefined;
    const hasPr = v.pr !== undefined;
    if (hasRepo !== hasPr) return false; // exactly one of repo/pr set — invalid
    const hasRepoPr = hasRepo && hasPr;
    return hasRunId !== hasRepoPr; // XOR: exactly one of run_id | (repo+pr)
  },
  { message: 'Provide exactly one of `run_id` or both `repo` and `pr` (not neither, not both).' },
);
export type GetFindingsInput = z.infer<typeof GetFindingsInput>;

// `McpFinding`, `RunStatus`, `SeverityBreakdown` are declared in the Shared
// primitives block above (reused by `run_agent_on_pr`'s blocking result).

export const GetFindingsOutputShape = {
  status: RunStatus,
  score: z.number().nullable(),
  breakdown: SeverityBreakdown,
  findings: z.array(McpFinding),
  total: z.number().int(),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
};
export const GetFindingsOutput = z.object(GetFindingsOutputShape);
export type GetFindingsOutput = z.infer<typeof GetFindingsOutput>;

// ---------------------------------------------------------------------------
// 4. get_conventions — Resource (NOT a tool; no input/output Zod schema is
// registered with the SDK for resources the way tools are — see
// resources/conventions.ts in the next phase). `toConventionsMarkdown` in
// tools/mappers.ts renders the text body.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 5. get_blast_radius — Tool (STUB)
// ---------------------------------------------------------------------------

export const GetBlastRadiusInputShape = {
  repo: RepoFullName,
  pr: PrNumber,
};
export const GetBlastRadiusInput = z.object(GetBlastRadiusInputShape);
export type GetBlastRadiusInput = z.infer<typeof GetBlastRadiusInput>;

export const GetBlastRadiusOutputShape = {
  status: z.literal('not_implemented'),
  pr: z.object({ repo: z.string(), number: z.number().int() }),
  impacted_files: z.array(z.string()),
  impacted_symbols: z.array(z.string()),
  risk_score: z.null(),
  message: z.string(),
};
export const GetBlastRadiusOutput = z.object(GetBlastRadiusOutputShape);
export type GetBlastRadiusOutput = z.infer<typeof GetBlastRadiusOutput>;
