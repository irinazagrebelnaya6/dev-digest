# Rules for Writing Skills for Features

## Rules

- **Trigger first** — one phrase when the skill activates
- **Process, not result** — "first read spec, then write tests" not "write good code"
- **Explain why** — "wrap errors because without context the log is useless"
- **≤200 lines** — if more, split into two skills
- **Be specific** — use `fmt.Errorf("context: %w", err)` not "handle errors"
- **Include code examples** — one real example beats three abstract rules
- **Reference project files** — "see apps/server/handlers.go as a reference"
- **One skill = one responsibility zone**

## Anti-patterns

- ❌ "Always do X" without explaining why — agent ignores it
- ❌ Duplicating what's already in CLAUDE.md — pollutes context twice
- ❌ Writing a skill as documentation — it's an action instruction, not a reference
- ❌ Abstract advice like "write clean code" — not actionable
- ❌ Storing mutable data in a skill (versions, URLs, keys) — will go stale
- ❌ One monolithic skill for everything — loads context when not needed
- ❌ No output example — agent doesn't know what the result should look like