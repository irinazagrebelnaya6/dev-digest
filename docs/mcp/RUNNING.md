# Running the DevDigest MCP Server

The MCP server is a **standalone, on-demand process**. It is intentionally NOT started by
`./scripts/dev.sh` or any other aggregate script — you launch it yourself only when you need it.

- Transport: **stdio** (local, single-user). No HTTP, no auth.
- Integration: **in-process** — it builds its own DI `Container` and calls DevDigest services
  directly. It needs **Postgres** and **LLM secrets**, but does **not** need the API server (:3001)
  to be running.

> This runbook describes the server as designed in `.claude/plans/mcp-server.md`. Until the plan is
> implemented, `pnpm mcp` and `server/src/mcp/` do not exist yet.

---

## 1. Prerequisites (one-time)

You need `docker` and `pnpm` installed (same as the rest of DevDigest).

### 1a. Bring up the database (from scratch)

The MCP server talks to the same local Postgres the app uses. Start just the DB (no API, no client):

```bash
./scripts/dev.sh --db-only
```

This is idempotent — it starts the `devdigest-postgres` container, applies migrations, and seeds the
demo data (workspace `default`, repo `acme/payments-api`, PR `#482`). Re-run it any time to reset to a
known state. Postgres keeps running in the background after the script exits.

To confirm the DB is up:

```bash
docker inspect -f '{{.State.Health.Status}}' devdigest-postgres   # → healthy
```

### 1b. Provide LLM secrets

`list_agents`, `get_findings`, `get_conventions`, and `get_blast_radius` work **without** any keys.
`run_agent_on_pr` returns run handles immediately, but the background review will fail unless a
provider key is present.

Create `~/.devdigest/secrets.json` (mode `0600`):

```bash
mkdir -p ~/.devdigest
cat > ~/.devdigest/secrets.json <<'JSON'
{
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "OPENAI_API_KEY": "sk-...",
  "OPENROUTER_API_KEY": "sk-or-..."
}
JSON
chmod 600 ~/.devdigest/secrets.json
```

Include only the providers your configured agents use. `process.env` is a fallback if the file is
absent, but the file is the intended source.

### 1c. Install server deps (if not already)

```bash
cd server && pnpm install
```

---

## 2. Start the server

```bash
cd server && pnpm --config.verify-deps-before-run=false mcp
```

> **Why the `--config` flag?** By default pnpm runs an implicit `pnpm install` deps-check *before*
> any `pnpm <script>`. In this environment that check aborts on unapproved native build scripts
> (`ERR_PNPM_IGNORED_BUILDS` — esbuild/ssh2/…), which kills the MCP stdio process before it starts.
> `--config.verify-deps-before-run=false` skips that pre-check. (Setting it in `.npmrc` is **not**
> honored by pnpm 11 — it must be passed on the CLI.) If your environment has those builds approved
> (`pnpm approve-builds`), plain `cd server && pnpm mcp` also works.

- The process listens on **stdin/stdout** for JSON-RPC. It will look "stuck" — that is correct; it is
  waiting for a client on stdio.
- All human-readable logs go to **stderr** (stdout carries only the protocol).
- Stop it with `Ctrl-C` (it closes the transport and the DB handle gracefully).

You will rarely run `pnpm mcp` bare in a terminal except to check it boots — normally a client
(Inspector or Claude Code) spawns it for you (see §4).

---

## 3. Restart / reset

| You changed… | Do this |
|---|---|
| MCP server code (`server/src/mcp/**`) | `Ctrl-C`, then `pnpm mcp` again. (No watch mode — restart manually.) In a client, toggle/reconnect the `devdigest` MCP server so it re-spawns. |
| Want a clean DB (fresh seed) | `docker compose down` then `./scripts/dev.sh --db-only`. |
| DB container stopped | `./scripts/dev.sh --db-only` (starts the existing container + re-applies migrate/seed). |
| Secrets | Edit `~/.devdigest/secrets.json`, then restart the MCP process (secrets are read at boot / per LLM call). |

Full from-zero sequence:

```bash
docker compose down                 # optional: wipe running DB
./scripts/dev.sh --db-only          # Postgres + migrate + seed
cd server && pnpm --config.verify-deps-before-run=false mcp   # start MCP (or let a client spawn it)
```

---

## 4. Testing the server

### 4a. MCP Inspector — interactive (fastest manual check)

The Inspector spawns the server and gives you a web UI to browse and call tools/resources:

```bash
cd server && npx @modelcontextprotocol/inspector pnpm --config.verify-deps-before-run=false mcp
```

Then in the UI:
- Check **Tools** lists exactly 4: `list_agents`, `run_agent_on_pr`, `get_findings`,
  `get_blast_radius`.
- Check **Resources** lists conventions under `devdigest://acme/payments-api/conventions`
  (conventions must NOT appear as a tool).
- Call each tool with inputs and inspect the structured output + error codes.

### 4b. Claude Code — the real usage path

Add an MCP entry (project `.mcp.json` at the repo root, or `claude mcp add`):

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "pnpm",
      "args": ["--dir", "server", "mcp"]
    }
  }
}
```

Then, in a Claude Code chat, exercise the flow:

1. `list_agents` → pick an `agent_id` (or omit to run all enabled).
2. `run_agent_on_pr { "repo": "acme/payments-api", "pr": 482 }` → returns `run_id`s immediately.
3. `get_findings { "repo": "acme/payments-api", "pr": 482 }` → first `status:"running"`, then, after
   the background review completes, `status:"done"` with findings, score, and a severity breakdown.
4. Read the resource `devdigest://acme/payments-api/conventions`.

Because the run is asynchronous, calling `get_findings` right after `run_agent_on_pr` may return
`status:"running"`; call it again after a few seconds.

### 4c. Automated tests (what CI runs)

```bash
cd server && pnpm test
```

- **Unit** (`server/test/mcp/*.test.ts`, no DB): Zod input validation (repo pattern, the
  `run_id` XOR `repo+pr` rule), `toMcpError` code mapping, the `get_blast_radius` stub shape.
- **Integration** (`server/test/mcp/*.it.test.ts`, real Postgres via testcontainers): builds a
  `Container` with a mock LLM and calls the handler functions directly (no stdio transport), asserting
  against the seeded `acme/payments-api #482`.

---

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Inspector never reaches "Connected"; server exits immediately with `ERR_PNPM_IGNORED_BUILDS` / `Command failed: pnpm install` | pnpm's implicit pre-run deps-check aborts on unapproved native builds and kills the process before startup. Launch with `pnpm --config.verify-deps-before-run=false mcp` (already baked into `.mcp.json`), or run `pnpm approve-builds` once. |
| Client shows garbage / "failed to parse" | Something wrote to **stdout**. Only JSON-RPC may go to stdout; all logging must be on stderr. |
| `run_agent_on_pr` returns handles but findings never appear (`status:"failed"`) | Missing/invalid LLM key in `~/.devdigest/secrets.json` for the agent's provider (`ConfigError` in the background run). |
| `REPO_NOT_FOUND` / `PR_NOT_FOUND` | DB not seeded, or wrong identifier. Re-run `./scripts/dev.sh --db-only`; use `acme/payments-api` + `482`. |
| Connection refused to Postgres | DB container not running. `./scripts/dev.sh --db-only`. |
| Tool changes not reflected in the client | The client cached the old process. Reconnect/toggle the `devdigest` MCP server so it re-spawns `pnpm mcp`. |
