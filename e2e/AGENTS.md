# e2e/ — context map

## Gotchas (not obvious from the code)

**Always use the hermetic runner** — `./scripts/e2e.sh` spins up an isolated stack on alt ports (PG :5433, API :3101, web :3100). Running `npm test` directly against the dev DB fails flows 02/04/05 unless the dev DB has only the seeded repo.

**Never `docker compose down -v`** — `-v` deletes `devdigest_pgdata` with all your imported repos and reviews. Use `docker compose down` (no `-v`).

**No `agent-browser chat`** — only deterministic commands (`open`, `wait --url`, `wait --text`, `click`, `type`). The `chat` command calls an LLM; we don't use it.

**`wait --text` / `wait --url` ARE the assertions** — they time out and exit non-zero if the condition never holds. No separate `assert` needed for most steps.

**No shared imports** — `e2e/` has no tsconfig path aliases. It does not import server, client, or reviewer-core code.

## Read when...
- Flow format + run commands + coverage table → `e2e/README.md`
- Architecture decisions (why agent-browser, hermetic runner) → `docs/e2e/README.md`
- How to add a new flow → `docs/e2e/INSTRUCTIONS.md`