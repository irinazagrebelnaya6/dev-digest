# e2e — implementation instructions

## Adding a new flow

1. Create `e2e/specs/NN-name.flow.json`
2. Structure:
```jsonc
{
  "name": "Human-readable description of what the flow proves",
  "steps": [
    { "cmd": ["open", "{BASE}/your-route"],        "label": "navigate to page" },
    { "cmd": ["wait", "--url", "/your-route"],     "label": "URL confirms navigation" },
    { "cmd": ["wait", "--text", "Expected text"],  "label": "content visible" }
  ]
}
```
3. Run locally: `E2E_BASE_URL=http://localhost:3000 node run.ts` (with dev stack running + DB seeded)
4. Verify the flow passes before pushing

## Available agent-browser commands

| Command | What it does |
|---|---|
| `open <url>` | Navigate to URL |
| `wait --url <path>` | Wait until URL contains path |
| `wait --text <str>` | Wait until page contains text |
| `click <selector>` | Click element |
| `type <selector> <text>` | Type into input |

Full reference: `agent-browser --help`

## Debugging failures

- CI uploads failure screenshots as artifacts — check before reading logs
- Run `./scripts/e2e.sh` locally to reproduce the hermetic CI environment
- Add `"label"` to every step — it appears in failure output

## Specs

See [`specs/`](./specs/) for planned flow specifications.