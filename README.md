# Codex Pro Architect

Invoke **GPT-5.6 Pro as an explicit, metered architecture specialist inside Codex** while leaving normal implementation work on your selected Codex model.

```text
Codex App / CLI — GPT-5.6 Sol Medium
                |
                |  $pro-architect plan ...
                v
       local stdio MCP server
                |
                |  OpenAI Responses API
                v
     GPT-5.6 + reasoning.mode=pro
                |
                |  bounded read-only repository tools
                v
 architecture + sprints + acceptance criteria
                |
                v
      same Codex conversation
                |
                |  implement Sprint 1
                v
 Codex App / CLI — GPT-5.6 Sol Medium
```

The model dropdown remains on the cost-effective implementation model. Pro is invoked only when a planning, review, or architecture decision justifies separate API spend.

> **Alpha:** This project is usable and tested, but the OpenAI GPT-5.6 surface and Codex/MCP integration can evolve. Review the security model and run `codex-pro-architect doctor` before using it on sensitive repositories.

## Why this exists

Changing the Codex model to Pro for an entire implementation session would spend premium reasoning on routine reads, edits, tests, and Git operations. Codex Pro Architect instead exposes Pro as a specialist:

- `$pro-architect plan ...` — architecture and sprint decomposition
- `$pro-architect review ...` — implementation and diff review
- `$pro-architect consult ...` — one focused technical decision
- `$pro-architect status` — configuration and estimated API usage without an API call

After the specialist returns, the outer Codex model continues normally.

## Design goals

- **Native Codex workflow:** a Codex skill backed by a local MCP server.
- **Official transport:** OpenAI Responses API; no browser automation or ChatGPT session scraping.
- **Explicit billing:** the skill disables implicit invocation, Codex prompts before MCP tool execution, and every paid run reports estimated cost.
- **Read-only specialist:** no file writes, arbitrary shell, SSH, Git push, or deployment tools are exposed to Pro.
- **Repository-grounded output:** Pro inspects the actual tree, source, diffs, and history rather than relying on a lossy summary from the outer model.
- **Minimal supply chain:** zero runtime npm dependencies; Node.js provides `fetch`, stdio, and process isolation.

## Requirements

- Linux or macOS
- Node.js 20.11 or newer
- Git
- OpenAI API access to GPT-5.6 Pro mode
- Codex CLI installed and signed in; the Codex desktop app and CLI share MCP configuration
- `ripgrep` recommended; the server falls back to `git grep`

A ChatGPT/Codex subscription does **not** include API usage. Pro Architect uses the OpenAI API key configured on the local machine.

## Install

```bash
# Clone after the public repository is available.
git clone https://github.com/en4ble1337/codex-pro-architect.git
cd codex-pro-architect

# No runtime dependencies are downloaded; this installs the CLI globally.
npm install --global .

# Read the key without placing it in shell history, then store it in a 0600 file.
read -rsp "OpenAI API key: " OPENAI_API_KEY; echo
export OPENAI_API_KEY
codex-pro-architect setup
unset OPENAI_API_KEY
```

`setup` performs four actions:

1. writes configuration under `~/.config/codex-pro-architect/`;
2. installs the skill and metadata under `~/.agents/skills/pro-architect/`;
3. registers the local stdio MCP server through `codex mcp add`;
4. raises the MCP tool timeout above the configured Pro request timeout, after backing up `~/.codex/config.toml`.

The skill metadata sets `allow_implicit_invocation: false`, and setup configures the MCP server to prompt before tool execution. This keeps paid Pro calls explicit even though Codex can see the registered MCP tools.

Restart the Codex app after setup.

### Validate

```bash
codex-pro-architect doctor
codex-pro-architect status
codex mcp list
```

Inside Codex:

```text
$pro-architect status
```

The status command is free and does not call OpenAI.

## Usage

### Plan a feature

```text
$pro-architect plan the interruptible-rental accepted-rate correction.

Inspect the current pricing, rental-state, API, and UI paths. Produce an
implementation-ready architecture, ordered sprints, tests, acceptance criteria,
rollout, and rollback. Do not modify code.
```

### Review an implementation

```text
$pro-architect review the current HEAD diff against
.codex/plans/interruptible-rental-rate.md.

Prioritize correctness, compatibility, stale-state handling, and test gaps.
Do not implement fixes.
```

### Consult on one decision

```text
$pro-architect consult whether telemetry reconciliation should use a durable
queue or a database-backed lease. Ground the decision in this repository's
current architecture and operational constraints.
```

### Continue with the outer Codex model

After approving the result:

```text
Save the approved plan under .codex/plans and .codex/sprints, then implement
Sprint 1 only. Run its acceptance criteria and stop before Sprint 2.
```

No further Pro API usage occurs unless `$pro-architect` is invoked again.

## MCP tools

| Tool | API call | Repository access | Purpose |
|---|---:|---|---|
| `architect_plan` | Yes | Read-only | Architecture, implementation plan, sprints |
| `architect_review` | Yes | Read-only | Diff and architecture conformance review |
| `architect_consult` | Yes | Read-only | Focused technical decision |
| `architect_status` | No | None | Config and recent usage summary |

The Pro model can use only these internal repository functions:

- `repo_tree`
- `read_file`
- `search_code`
- `git_status`
- `git_diff`
- `git_log`
- `git_show`

Every subprocess uses a fixed executable and argument array with `shell: false`.

## Cost controls

Current defaults are stored in `~/.config/codex-pro-architect/config.json`:

```json
{
  "model": "gpt-5.6",
  "reasoningMode": "pro",
  "reasoningEffort": "medium",
  "maxToolRounds": 24,
  "maxOutputTokens": 32000,
  "requestTimeoutMs": 1200000,
  "maxRunCostUsd": 10
}
```

Reconfigure:

```bash
codex-pro-architect configure --effort high --max-cost 5
```

A lower per-run guardrail can also be passed by the MCP caller, but it cannot exceed the configured ceiling.

Each run appends a local JSONL entry to:

```text
~/.local/state/codex-pro-architect/usage.jsonl
```

Inspect it with:

```bash
codex-pro-architect usage --limit 20
```

Cost is estimated from API-reported token usage and configured rates. OpenAI billing remains authoritative. The default rate table is dated in the config because API prices can change.

## Security model

The service is local and stdio-only. It does not open a TCP listener.

Key controls:

- repository root is resolved with Git and `realpath`;
- absolute tool paths, lexical traversal, symlink escapes, and Git object/path revision syntax are rejected;
- common credential paths such as `.env`, private keys, cloud credentials, kubeconfig files, and Terraform state are denied across tree, read, search, status, diff, and history tools;
- Git hooks, fsmonitor commands, external diff/text-conversion helpers, pagers, and repository attributes are neutralized for inspection commands;
- provider credentials and generic secret-bearing environment variables are removed from child processes;
- file size, line count, JSON-RPC message size, output, search, tree, tool-round, timeout, and estimated-cost limits are enforced;
- MCP and inner repository-tool arguments are validated before paid work;
- repository content is explicitly treated as untrusted prompt-injection data;
- no write, patch, arbitrary command, network browsing, SSH, credential, or deployment tool is available to the inner Pro model;
- non-completed Responses API results fail closed rather than returning a partial plan as success;
- the API key is loaded from `OPENAI_API_KEY` or a user-only credentials file and is never returned by MCP tools;
- MCP diagnostics go to stderr so stdout remains protocol-only.

Read [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md) before expanding the tool surface.

## Configuration and credentials

Paths follow XDG conventions:

| Purpose | Default path |
|---|---|
| Configuration | `~/.config/codex-pro-architect/config.json` |
| API credential | `~/.config/codex-pro-architect/credentials.json` |
| Usage ledger | `~/.local/state/codex-pro-architect/usage.jsonl` |
| Codex skill | `~/.agents/skills/pro-architect/SKILL.md` |

Environment overrides:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_ORGANIZATION`
- `OPENAI_PROJECT`
- `XDG_CONFIG_HOME`
- `XDG_STATE_HOME`

## Development

```bash
npm ci
npm run ci
npm run pack:dry
npm audit --omit=dev
```

The focused suite covers:

- real stdio MCP initialization, protocol negotiation, cancellation, input limits, and argument validation;
- repository inspection, unusual filenames, deleted files, traversal/symlink defenses, sensitive-path filtering, and malicious Git configuration;
- child-process credential stripping;
- Responses API tool loops, encrypted reasoning replay, and fail-closed incomplete responses;
- Codex TOML patching, configuration validation, usage-ledger recovery/permissions, and cost accounting.

See [docs/VALIDATION.md](docs/VALIDATION.md) for the isolated setup test and live Codex acceptance procedure.

## Known limitations

- Version 0.1 runs each Pro call as a new specialist session. Persistent project-level Pro sessions are planned.
- Setup edits only the existing `[mcp_servers.pro-architect]` section and creates a timestamped Codex config backup; unusual hand-written TOML layouts may require manual timeout configuration.
- The MCP implementation targets the established newline-delimited stdio protocol used by Codex. Future MCP protocol revisions may require an adapter update.
- Cost enforcement is reactive: it prevents additional API rounds after the configured estimate is exceeded, but cannot undo the cost of a request already completed.
- The sensitive-path policy is defense in depth, not a complete secret scanner. Nonstandard secret filenames or secrets embedded in ordinary source files can still be sent to OpenAI. Review the repository before invoking paid tools.
- Generated architecture is advisory. The user and outer Codex agent remain responsible for validation and implementation.
- Linux and macOS are the initial targets; Windows path and global-install behavior need dedicated validation.

## Official references

- [OpenAI GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [GPT-5.6 Sol model and pricing](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [Codex skills](https://developers.openai.com/codex/skills)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp)

## Project status and roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). The next priorities are persistent sessions, plan artifact schemas, architecture-drift review, Windows validation, and evaluation tooling that compares Pro with standard reasoning on the same repository tasks.

## Independence and acknowledgement

This is an independent project and is not affiliated with or endorsed by OpenAI. `Codex`, `GPT`, and `OpenAI` are trademarks of their respective owner.

The high-level idea was informed by community experiments that make premium ChatGPT reasoning available from Codex, including `miuuyy/codex-chatgpt-web`. This repository does not copy that implementation: it uses the official OpenAI API, an original read-only agent loop, and no browser automation. See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).

## License

MIT
