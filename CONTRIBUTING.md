# Contributing

## Development setup

```bash
git clone https://github.com/en4ble1337/codex-pro-architect.git
cd codex-pro-architect
npm run ci
```

There are currently no runtime dependencies and no build step.

## Pull requests

Keep changes focused and include tests for behavior or security boundaries. Before opening a pull request, run:

```bash
npm run check
npm test
npm run pack:dry
```

## Design constraints

- Pro remains a read-only architecture specialist.
- Do not add arbitrary shell execution.
- Do not put API keys in Codex configuration, command arguments, logs, fixtures, or screenshots.
- Preserve explicit invocation for billable tools.
- Return concrete failures rather than silently substituting the outer Codex model.
- Keep token, time, output, and cost controls visible.

Discuss large changes—persistent sessions, write tools, network transports, or new providers—in an issue before implementation.
