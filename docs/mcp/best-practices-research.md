# MCP Server — Best Practices Research (2025–2026)

> Research compiled for the DevDigest MCP server (5 tools: `list_agents`, `run_agent_on_pr`,
> `get_findings`, `get_conventions`, `get_blast_radius` — the last is a stub for now).
> Focus: (1) general MCP server design, (2) **token efficiency at chat startup** — the primary concern.
> Sources: MCP spec (2025-11-25 / 2025-06-18), Anthropic engineering, AWS MCP design guidelines,
> Speakeasy, StackOne, MindStudio, TrueFoundry, Snyk, and community benchmarks.

## TL;DR for a 5-tool server

At 5 tools the startup schema cost is inherently low (~500–2,500 tokens depending on description
verbosity). Claude Code's automatic deferred loading likely will **not** trigger (below the ~10%
context-window / ~20K-token threshold), so all tools load inline — which is fine. The high-ROI levers
at this scale are **not** the fancy lazy-loading machinery but:

1. Terse, LLM-targeted descriptions (< ~100 tokens per tool).
2. Reference data (`get_conventions`) as an MCP **Resource**, not a Tool → zero startup tokens.
3. Compact, server-filtered tool responses (`get_findings` pre-aggregated by severity, paginated).
4. `resource_link` instead of inlining large payloads (diffs, full reports).

Overkill at 5 tools (defer for future growth): deferred/ToolSearch loading, dynamic `search_tools`
discovery, schema-compression proxies, tool allowlisting.

---

## Category 1 — General MCP Server Design

### 1. Single responsibility per server
Each server owns exactly one domain and one auth boundary. Kitchen-sink servers are hard to secure,
version, and reason about, and force clients to load irrelevant schemas. **Our case already satisfies
this** (one domain: review agents).
- Impact: fewer tools → fewer startup tokens; cleaner blast radius; independent scaling/auth.
- Sources: [MCP Best Practice Guide](https://mcp-best-practice.github.io/mcp-best-practice/best-practice/) ·
  [AWS MCP Design Guidelines](https://github.com/awslabs/mcp/blob/main/DESIGN_GUIDELINES.md)

### 2. Verb-noun tool naming, snake_case, ≤64 chars
`verb_noun` pattern (`list_agents`, `run_agent_on_pr`, `get_findings`). snake_case tokenizes most
efficiently for Claude/GPT. Names must start with a letter, be unique, avoid dots/spaces/brackets,
and stay under 64 chars (clients may prepend a namespace prefix). Consistent prefixes let the model
predict related tool names.
- Sources: [AWS MCP Design Guidelines](https://github.com/awslabs/mcp/blob/main/DESIGN_GUIDELINES.md) ·
  [MCP spec SEP-986](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/986) ·
  [Snyk](https://snyk.io/articles/5-best-practices-for-building-mcp-servers/)

### 3. Write descriptions for the model, not for humans
State, concisely and in this order: when to call it, what it returns, preconditions, side effects.
E.g. "Use to list all review agents in the workspace. Returns agent IDs + display names. No side
effects. Call before `run_agent_on_pr` to pick an agent_id." Flag hard constraints with `CRITICAL:` /
`IMPORTANT:` at the end. Poor descriptions are the #1 cause of wrong tool selection. Over-stripping
also hurts — keep preconditions.
- Impact: every word is loaded every turn; concise + accurate is the sweet spot.
- Sources: [Speakeasy — Tool Design](https://www.speakeasy.com/mcp/tool-design) ·
  [AWS MCP Design Guidelines](https://github.com/awslabs/mcp/blob/main/DESIGN_GUIDELINES.md)

### 4. Strict, typed input schemas (enums + constraints)
Enums for any fixed value set (e.g. `severity`), `minimum`/`maximum` for numerics,
`minLength`/`maxLength`/`pattern` for identifiers, explicit `required`. Validate at the boundary and
reject on first failure with a machine-readable code. Enums shrink the model's decision space and cut
hallucinated values; schema-level rejection avoids expensive retry loops.
- Sources: [AWS MCP Design Guidelines](https://github.com/awslabs/mcp/blob/main/DESIGN_GUIDELINES.md) ·
  [mcp-best-practice.github.io](https://mcp-best-practice.github.io/mcp-best-practice/best-practice/)

### 5. Tools vs Resources vs Prompts — use the right primitive
- **Tools** = executable actions the model invokes (side effects / live computation).
- **Resources** = read-only, URI-addressable data fetched on demand via `resources/read`; **not** in
  `tools/list`, so **zero startup tokens** until accessed.
- **Prompts** = reusable interaction templates.
Static reference data (conventions, runbooks, schemas) belongs in Resources — this is the native MCP
progressive-disclosure mechanism. **Directly relevant to `get_conventions`.**
- Sources: [MCP Spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) ·
  [Progressive Disclosure benchmark](https://matthewkruczek.ai/blog/progressive-disclosure-mcp-servers.html)

### 6. Structured output via `outputSchema` (spec 2025-06-18)
Declare an `outputSchema` (JSON Schema) and return `structuredContent` conforming to it; clients can
validate and type it without parsing prose. **Always include a human-readable text fallback** — client
support is still partial as of mid-2026.
- Sources: [ForgeCode — 2025-06-18 spec](https://forgecode.dev/blog/mcp-spec-updates/) ·
  [Socket.dev](https://socket.dev/blog/mcp-spec-updated-to-add-structured-tool-output-and-improved-oauth-2-1-compliance)

### 7. Cursor-based pagination on all list tools
Accept `limit` + `cursor`; return `next_cursor` (null/empty when exhausted) and `has_more`. Small
default page size (10–25). Never return unbounded lists. Cursor pagination is stable under concurrent
writes and far faster at depth than offset.
- Sources: [mcp-best-practice.github.io](https://mcp-best-practice.github.io/mcp-best-practice/best-practice/) ·
  [MindStudio](https://www.mindstudio.ai/blog/reduce-token-usage-ai-agents-mcp-optimization)

### 8. Transport: stdio local, Streamable HTTP for shared/production
stdio = zero network overhead (P50 0.3–1 ms), process isolation, client owns lifecycle — best for local
single-user (Claude Code). Streamable HTTP (spec 2025-03-26, replaces deprecated SSE) for multi-user /
remote / horizontally scaled / gateway-auth deployments. **SSE-only transport is deprecated — do not
implement it in new servers.**
- Sources: [TrueFoundry](https://www.truefoundry.com/blog/mcp-stdio-vs-streamable-http-enterprise) ·
  [MCP Transports spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

### 9. OAuth 2.1 + PKCE for HTTP transport (mandatory)
HTTP servers are OAuth 2.0 Resource Servers. Required: PKCE for all clients, short-lived tokens,
`resource` binding (RFC 8707), strict audience validation, **no token passthrough** to downstream APIs.
N/A for stdio-only (OS process isolation is the boundary).
- Sources: [Auth0](https://auth0.com/blog/mcp-specs-update-all-about-auth/) ·
  [ForgeCode](https://forgecode.dev/blog/mcp-spec-updates/)

### 10. Read-only by default; explicit write enablement + role/tenant filtering
Default all tools read-only; gate mutating tools (`run_agent_on_pr`) behind explicit role checks /
capability flags. Advertise only the tools a given principal/tenant can legitimately use. Sanitize tool
outputs against prompt injection — PR/issue text is untrusted input. Never echo secrets in results.
- Sources: [Snyk](https://snyk.io/articles/5-best-practices-for-building-mcp-servers/) ·
  [mcp-best-practice.github.io](https://mcp-best-practice.github.io/mcp-best-practice/best-practice/)

### 11. Idempotency keys + async handles for long operations
Accept a client-generated idempotency key on create/run operations so retries don't duplicate side
effects. For operations exceeding request timeouts, return a job/handle ID immediately and expose a
separate status/poll tool. **Directly relevant to `run_agent_on_pr`** (a review can be long-running).
- Sources: [mcp-best-practice.github.io](https://mcp-best-practice.github.io/mcp-best-practice/best-practice/)

### 12. Actionable, machine-readable errors
Return `{ code, message, retry }`: a machine-readable code (`REPO_NOT_FOUND`), a one-sentence human
message, and a retry hint. Distinguish client vs server/upstream errors. **Never return a bare "not
found"** — it makes the model ignore data actually returned in the same response.
- Sources: [Snyk](https://snyk.io/articles/5-best-practices-for-building-mcp-servers/) ·
  [mcp-best-practice.github.io](https://mcp-best-practice.github.io/mcp-best-practice/best-practice/)

### 13. Multi-layer testing: unit + contract + load
Test discovery/execution across more than one model. Contract tests for MCP protocol compliance
(JSON-RPC framing, capability negotiation, error envelope). Security tests (authz bypass, input
fuzzing, rate limits). Load tests vs SLOs.
- Sources: [modelcontextprotocol.info](https://modelcontextprotocol.info/docs/best-practices/) ·
  [The New Stack](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/)

---

## Category 2 — Token Efficiency at Chat Startup (primary concern)

**Scale of the problem:** GitHub's MCP server alone injects ~17,600 tokens of tool definitions. Three
servers (GitHub + Slack + Sentry, ~40 tools) consumed 143,000 of a 200,000-token window (72%) before
the first user message. Tool count and description verbosity are the primary levers.

### 14. Keep total tool count under ~30–40
LLM tool-selection accuracy degrades measurably beyond 30–40 simultaneously loaded tools (hallucinated
/ wrong tool calls). **5 tools is far under the cliff** — this is the ceiling for future growth, not a
current concern.
- Sources: [Speakeasy](https://www.speakeasy.com/mcp/tool-design) ·
  [AgentMarketCap](https://agentmarketcap.ai/blog/2026/04/08/mcp-context-bloat-enterprise-scale-tool-definitions-agent-context-budget)

### 15. Terse descriptions — target < ~100 tokens per tool
One sentence for what it does, one for when to call it (vs not); no examples, markdown, or marketing in
the top-level description (examples go in field-level `inputSchema` descriptions). At 100 tokens/tool a
5-tool server costs ~500 tokens; at 500 tokens/tool it's ~2,500 and starts competing with conversation
history. **Highest-ROI edit at this scale.**
- Sources: [MindStudio — Claude Code overhead](https://www.mindstudio.ai/blog/claude-code-mcp-server-token-overhead) ·
  [Progressive Disclosure benchmark](https://matthewkruczek.ai/blog/progressive-disclosure-mcp-servers.html)

### 16. Claude Code deferred / lazy tool loading (defer_loading) — automatic
Two-tier architecture (Claude Code ≥ v2.1.7, late 2025): always-loaded built-ins (Bash, Read, Edit,
Grep, ToolSearch) get full schemas; MCP extensions are deferred to name-only stubs, with full schema
fetched on demand via `ToolSearch` (~200 tokens/lookup). Auto-activates when deferred definitions exceed
~10% of the context window. Anthropic internal: ~77K → ~8.7K startup tokens (85% cut) on a 50-tool
setup. **For 5 tools this likely won't activate — all tools load inline, which is fine.** Nothing for us
to build; the client handles it.
- Sources: [Finisky Garden](https://finisky.github.io/en/claude-code-deferred-tools/) ·
  [Anthropic — Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use)

### 17. Dynamic toolset / search-first discovery (`search_tools`)
Expose `search_tools(query)` + `describe_tool(name)` + `execute_tool(name,args)` so the full catalog
never enters context. Speakeasy: 96% input-token reduction; StackOne: 91–98.5% at 400 tools; Anthropic:
Opus 4 accuracy 49% → 74%. Trade-off: +1–2 round trips, ~50% latency. **Overkill for 5 tools;** the
blueprint once a server grows past ~20 tools.
- Sources: [Speakeasy — Dynamic Toolsets](https://www.speakeasy.com/blog/how-we-reduced-token-usage-by-100x-dynamic-toolsets-v2) ·
  [StackOne](https://www.stackone.com/blog/mcp-token-optimization/)

### 18. Progressive disclosure via Resources / two-stage listing
Move sometimes-needed reference data (conventions, docs) into Resources fetched via `resources/read`
(zero startup tokens). Two-stage listing: `tools/list` returns names + one-liners; full schema fetched
only after the model commits to a tool. Reported 85–100x reductions for knowledge-heavy workflows.
- Sources: [Progressive Disclosure benchmark](https://matthewkruczek.ai/blog/progressive-disclosure-mcp-servers.html) ·
  [Solo.io](https://www.solo.io/blog/mcp-progressive-disclosure) ·
  [Anthropic — Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)

### 19. Return only needed fields (response filtering / compact encoding)
Tool results are injected wholesale, so return only fields the next step acts on. Add a `fields`
parameter or (better) design narrow tools (`get_pr_risk_summary`, not `get_pr_raw_json`). Compact
encoding ("TOON"): omit null/empty fields, short codes (`"sev":"H"`), positional arrays for tabular
data. Reported ~95% per-call reduction (StackOne); 90–98% for compact vs verbose JSON. **Directly
relevant to `get_findings`.**
- Sources: [StackOne](https://www.stackone.com/blog/mcp-token-optimization/) ·
  [MindStudio](https://www.mindstudio.ai/blog/reduce-token-usage-ai-agents-mcp-optimization)

### 20. Move computation server-side; no raw data dumps
Prefer `get_risk_summary` (pre-aggregated) over `get_all_findings` (raw records). Anthropic's
code-execution-with-MCP article: 150,000 → 2,000 tokens (98.7%) by keeping intermediates out of context;
server-side aggregation alone gives 80–90% response-token reduction on list-then-filter workflows.
- Sources: [Anthropic — Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) ·
  [MindStudio](https://www.mindstudio.ai/blog/reduce-token-usage-ai-agents-mcp-optimization)

### 21. `resource_link` instead of inlining large payloads (spec 2025-06-18)
Return a `resource_link` URI (~10–20 tokens) pointing at a resource instead of a multi-thousand-token
body (full diff, full report). The content enters context only if explicitly fetched — which in many
agent flows it never is. **Relevant to `get_blast_radius`** (link to raw diff rather than dumping it).
- Sources: [ForgeCode — 2025-06-18 spec](https://forgecode.dev/blog/mcp-spec-updates/) ·
  [MCP Spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)

### 22. Anthropic "just-in-time" context principle
Keep lightweight identifiers (IDs, paths, cursors, URIs) in context; hydrate full data only at the
moment it's needed. Applies to both tool-result shape (return IDs, not full objects, when passed to a
later call) and multi-step workflows (don't route large intermediates through context).
- Sources: [Anthropic — Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

### 23. Examples in schema fields, not in top-level descriptions
Embedding usage examples in `inputSchema` field descriptions (or an `examples` field) improved
parameter accuracy 72% → 90% (Anthropic advanced tool use) — and those tokens load only when the schema
is actually loaded, unlike top-level description text which loads every turn.
- Sources: [Anthropic — Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use)

### 24. Schema compression proxy — last resort, for servers you don't control
Proxies (e.g. Atlassian `mcp-compressor`) strip descriptions/enums/nested docs while preserving
parameter structure; GitHub's server drops 17,600 → ~2,200 tokens (87%) at high compression. Trade-off:
over-compression degrades selection accuracy for tools with similar parameter names. Tactical measure,
not a design principle. **Not needed — we control our schema.**
- Sources: [StackOne](https://www.stackone.com/blog/mcp-token-optimization/)

---

## Applicability to our 5 tools

| Tool | Recommendation |
|---|---|
| `list_agents` | Tool; terse description; cursor pagination if the agent list can grow. |
| `run_agent_on_pr` | Mutating → idempotency key; long-running → return a job/run id + poll via `get_findings`. |
| `get_findings` | Paginated + `severity` enum filter; return a pre-aggregated summary, not a raw array. |
| `get_conventions` | **Candidate for a Resource** (zero startup tokens) rather than a Tool — open decision. |
| `get_blast_radius` | **Stub for now**; return a compact structure (files + risk score), `resource_link` to raw diff. |

### Open decisions to lock before planning
1. `get_conventions`: **Resource** vs **Tool**? (Resource = cheaper tokens; some clients handle
   resources less well than tools.)
2. Transport: **stdio** (local Claude Code) vs **Streamable HTTP** (shared/remote)?
3. `run_agent_on_pr`: **synchronous** vs **async job + `get_findings` by run id**?
4. Deferred/ToolSearch pattern: **skip** for 5 tools? (recommended: yes.)

---

## Sources
- [MCP Best Practices — modelcontextprotocol.info](https://modelcontextprotocol.info/docs/best-practices/)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP 2025-06-18 Spec Update — ForgeCode](https://forgecode.dev/blog/mcp-spec-updates/)
- [AWS MCP Design Guidelines](https://github.com/awslabs/mcp/blob/main/DESIGN_GUIDELINES.md)
- [Speakeasy — Design MCP Tools](https://www.speakeasy.com/mcp/tool-design)
- [Speakeasy — Dynamic Toolsets 100x](https://www.speakeasy.com/blog/how-we-reduced-token-usage-by-100x-dynamic-toolsets-v2)
- [StackOne — 4 Token Optimization Approaches](https://www.stackone.com/blog/mcp-token-optimization/)
- [Anthropic — Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic — Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic — Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use)
- [Finisky Garden — Deferred Tool Loading](https://finisky.github.io/en/claude-code-deferred-tools/)
- [MindStudio — Claude Code MCP Token Overhead](https://www.mindstudio.ai/blog/claude-code-mcp-server-token-overhead)
- [MindStudio — Optimize MCP Server Token Usage](https://www.mindstudio.ai/blog/optimize-mcp-server-token-usage)
- [MindStudio — 10 Optimization Techniques](https://www.mindstudio.ai/blog/reduce-token-usage-ai-agents-mcp-optimization)
- [AgentMarketCap — MCP Context Bloat](https://agentmarketcap.ai/blog/2026/04/08/mcp-context-bloat-enterprise-scale-tool-definitions-agent-context-budget)
- [Progressive Disclosure Benchmark — Matthew Kruczek](https://matthewkruczek.ai/blog/progressive-disclosure-mcp-servers.html)
- [Solo.io — MCP Progressive Disclosure](https://www.solo.io/blog/mcp-progressive-disclosure)
- [TrueFoundry — stdio vs Streamable HTTP](https://www.truefoundry.com/blog/mcp-stdio-vs-streamable-http-enterprise)
- [Auth0 — MCP Spec Auth Update](https://auth0.com/blog/mcp-specs-update-all-about-auth/)
- [Snyk — 5 Best Practices for MCP Servers](https://snyk.io/articles/5-best-practices-for-building-mcp-servers/)
- [The New Stack — 15 Best Practices](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/)
