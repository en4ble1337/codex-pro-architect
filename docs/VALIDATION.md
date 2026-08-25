# Validation and Acceptance Testing

## Automated validation

Run from a clean checkout:

```bash
npm ci
npm run ci
npm run pack:dry
npm audit --omit=dev
```

The CI matrix runs on Ubuntu and macOS with Node.js 20 and 22.

## Isolated setup verification

Use a temporary home directory before installing into your real Codex profile. The following test stores a non-production placeholder key and skips Codex registration:

```bash
sandbox="$(mktemp -d)"
HOME="$sandbox/home" \
XDG_CONFIG_HOME="$sandbox/home/.config" \
XDG_STATE_HOME="$sandbox/home/.local/state" \
OPENAI_API_KEY="sk-test-not-a-real-key" \
node src/cli.js setup --no-register

HOME="$sandbox/home" \
XDG_CONFIG_HOME="$sandbox/home/.config" \
XDG_STATE_HOME="$sandbox/home/.local/state" \
node src/cli.js status

find "$sandbox/home" -type f -maxdepth 6 -print
```

Expected results:

- config and credential files exist under `~/.config/codex-pro-architect/` with mode `0600`;
- the skill exists under `~/.agents/skills/pro-architect/`;
- `status` reports zero runs and no API request is made.

## Live Codex acceptance

This step requires an actual Codex installation and a funded OpenAI API project.

```bash
git clone https://github.com/en4ble1337/codex-pro-architect.git
cd codex-pro-architect
npm ci && npm run ci
npm install --global .

read -rsp "OpenAI API key: " OPENAI_API_KEY; echo
export OPENAI_API_KEY
codex-pro-architect setup
unset OPENAI_API_KEY

codex-pro-architect doctor
codex-pro-architect status
codex mcp list
```

Restart Codex and run the free check first:

```text
$pro-architect status
```

Then use a disposable repository for the first paid call:

```text
$pro-architect consult whether this repository should keep its current module
layout. Inspect the repository, do not modify files, and cap the estimated run
cost at $1.
```

Validate:

1. Codex asks for MCP approval before the paid tool runs.
2. Repository inspection is read-only.
3. The response footer includes token usage and estimated cost.
4. `codex-pro-architect usage --limit 5` records the run.
5. `git status --short` remains unchanged.

## Uninstall and rollback

```bash
codex mcp remove pro-architect
codex-pro-architect remove-skill
```

`setup` creates a timestamped backup before changing `~/.codex/config.toml`. Restore that backup if manual rollback is required.
