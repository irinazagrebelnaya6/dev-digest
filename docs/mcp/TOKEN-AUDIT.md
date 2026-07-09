
# MCP Token Audit — worksheet

Goal: measure how MCP tool **schemas** inflate the chat context, and compare the
two levers that shrink it — **server-side toolset trimming** (Method A) vs
**Tool Search** (Method B) — then reason about the **facade** pattern.

The only measurement instrument is `/context` inside Claude Code. Run it after
each config change and record the numbers in the table below. `/context` reports
tokens *before your first message*, so it isolates pure schema cost.

> The DevDigest server (`.mcp.json` → `devdigest`) exposes **4 tools + 1
> resource**. A Resource costs **zero** startup tokens (it is not in
> `tools/list`), so it never shows up in this audit — that is the point of
> making `get_conventions` a Resource, not a tool.

---

## Prerequisites

- DevDigest MCP works standalone — see `docs/mcp/RUNNING.md` (Postgres up, seeded).
- Docker available (the official GitHub MCP runs as a container).
- A GitHub PAT exported in the shell that launches Claude Code — **never commit it**:
  ```bash
  export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx   # classic or fine-grained, read scopes
  ```
  `.mcp.json` passes it through via `${GITHUB_PERSONAL_ACCESS_TOKEN}` (no secret in the repo).
- Restart Claude Code (or `/mcp` → reconnect) after every `.mcp.json` edit so the
  change takes effect, then run `/context`.

---

## Results — fill these in

| # | Config | GitHub tools exposed | `/context` MCP tokens | Δ vs baseline |
|---|--------|:--------------------:|:---------------------:|:-------------:|
| 0 | Baseline: `devdigest` only (4 tools) | — | 0 † (≈0.8k eager) | — |
| 1 | + GitHub MCP, **default** toolsets | ~44 (≈160+ with all) | ______ | +______ |
| 2 | + GitHub MCP, **trimmed + read-only** (Method A) | ~15, read-only | ______ | +______ |
| 3 | GitHub MCP **default** + **Tool Search** (Method B) | ~44 (hidden) | ______ | ≈ −85% vs #1 |
| 4 | Tool Search on the **DevDigest** server too | 4 (hidden) | 0 (18 tools, on-demand) | ≈ −100% |

> † Measured 2026-07-06 via `/context`: **`MCP tools · loaded on-demand → 18 tools · 0 tokens`**.
> The `0` is the **Tool-Search-ON** reading — i.e. this is really the row-4 condition, not the eager
> baseline. Tool Search defers every tool's schema, so `/context` shows 0 regardless of how many
> servers are connected. To get a true row-0 (eager) number, disable Tool Search for `devdigest`
> (unset `ENABLE_TOOL_SEARCH`, or add the 4 tools to `alwaysLoad`), restart, and re-run `/context` —
> expect **~0.8k tokens** (the 4 DevDigest schemas total ~2,855 chars ≈ 700–850 tokens).

Reference magnitudes come from the lab; your absolute numbers will differ — what
matters is the **shape**: #1 explodes, #2 and #3 both collapse it, #4 confirms the
same lever works on your own server.

---

## Act 1 — see the bloat

1. Temporarily reduce `.mcp.json` to **only** the `devdigest` server (comment-out
   is not valid JSON — keep a copy, or just note the number with GitHub removed),
   restart, run `/context` → **row 0**.
2. Restore the `github` server but make it expose its **default** surface: set
   `GITHUB_TOOLSETS` to `all` (or remove the `GITHUB_TOOLSETS` / `GITHUB_READ_ONLY`
   lines entirely). Restart, `/context` → **row 1**.

Every tool description loads eagerly, so `/context` jumps by tens of thousands of
tokens before you type a word. You pay for ~44 descriptions and will use 2–3.

## Act 2 — Method A: server returns fewer tools

Put back the trimmed values (this is the committed default in `.mcp.json`):

```json
"GITHUB_TOOLSETS": "pull_requests,repos",
"GITHUB_READ_ONLY": "1"
```

Restart, `/context` → **row 2**. The server now advertises ~15 tools instead of
~44, and only the read ones. **Caveat:** this lever exists only because the
official GitHub server supports `toolsets`; a random community server ships
everything with no such knob.

## Act 3 — Method B: Tool Search

Leave every tool connected — cut nothing. Claude Code stops pre-loading their
descriptions, keeps a single "search tools" tool instead, and pulls only the few
descriptions it actually needs, by meaning, at call time. `/context` frees ~85%
with no code and no change to the GitHub server. In Claude Code it is on by
default; the threshold and exceptions are `ENABLE_TOOL_SEARCH` and `alwaysLoad`.
Measure GitHub-default + Tool Search → **row 3**, then confirm it also applies to
the DevDigest server → **row 4**.

**Tool Search is not magic — its limits:**
- Needs `tool_reference` blocks; does **not** work on Haiku; off by default on
  Vertex AI and via third-party proxies — a corp gateway may lose it.
- Each search is an extra step + a few thousand tokens per request. Keep a tool
  you use every time in `alwaysLoad`.
- False misses happen: the search can fail to find a deferred tool even by exact
  name, and the agent concludes it does not exist.
- It only fixes **bloated descriptions**. Large tool **responses** are a separate
  budget it never touches.

## Method A vs Tool Search — they are not the same

Both shrink `/context`, but differently:
- **Tool Search** only *hides* descriptions — every tool is still connected and
  callable, including `merge PR` or `push to repo`.
- **`GITHUB_READ_ONLY=1`** *removes* the dangerous tools for the session — what
  does not exist cannot be called.

So: want cheaper context → Tool Search is enough. Want the agent to be physically
unable to do harm → cut the dangerous tools with read-only.

## Act 4 — Facade

Instead of many tools, expose **one** that takes a text instruction and dispatches
to the right underlying tool — one schema in context instead of many.
- Pays off on **many homogeneous** operations (dozens on GitHub; ~2500 on
  Cloudflare — that is Code Mode).
- We deliberately did **not** fold DevDigest's tools into a facade — they are
  distinct responsibilities, folding would kill the discovery flow
  (`list_agents → run_agent_on_pr → get_findings`) and save pennies.
- "Tools on demand" is **Tool Search**, not a facade — do not conflate them.

---

## Self-check (lab completion)

- [ ] Inspector shows the DevDigest tools with descriptions (4 tools; conventions
      appears under **Resources**, not tools — by design).
- [ ] Discovery flow works: `list_agents → run_agent_on_pr → get_findings`, and
      Claude Code cites the findings.
- [ ] `/context` numbers recorded for every step: baseline → + GitHub MCP → trim →
      Tool Search → Tool Search on your own server (table above).
- [ ] You used Tool Search in Claude Code.
