# AGENTS.md

## Project objective

Maintain a small, auditable, dependency-free Codex MCP server that invokes GPT-5.6 Pro only as an explicit read-only architecture specialist.

## Required validation

Run before completing any change:

```bash
npm run check
npm test
npm run pack:dry
```

## Non-negotiable invariants

- No arbitrary shell tool exposed to the inner model.
- No repository writes from the inner model.
- No API key in command arguments, logs, fixtures, output, or repository files.
- All repository paths must be canonicalized and remain under the selected Git root.
- Billable tools remain explicit and report usage/cost.
- MCP stdout contains protocol messages only; diagnostics go to stderr.
- Do not silently fall back to the outer Codex model when the Pro call fails.

## Code style

- Modern ESM JavaScript targeting Node.js 20+.
- Prefer platform APIs over dependencies.
- Use `spawn` with `shell: false` for fixed local commands.
- Keep modules focused and functions testable.
- Add regression tests for security-relevant fixes.
