# Architecture

## Objective

Codex Pro Architect gives an existing Codex session selective access to GPT-5.6 Pro for high-value architecture work without replacing the outer Codex model or reproducing the full Codex execution harness.

## Components

```text
User
  |
  | $pro-architect plan/review/consult
  v
Codex skill
  |
  | MCP tools/call
  v
Local stdio MCP server
  |
  | validated request + absolute repository root
  v
Pro Architect orchestration loop
  |                         |
  | Responses API           | fixed, read-only local functions
  v                         v
GPT-5.6 Pro            RepositoryInspector
  |                         |
  | function_call           +-- git ls-files
  |                         +-- bounded file reads
  |                         +-- ripgrep / git grep
  |                         +-- git status/diff/log/show
  +-------------------------+
  |
  | final Markdown + API usage
  v
Codex conversation
```

## Why an MCP specialist instead of a model-picker entry

A model-picker entry changes the model responsible for the entire Codex agent loop. That can spend Pro-mode reasoning on routine filesystem, patch, test, and Git operations. The MCP specialist makes the expensive reasoning boundary explicit and narrow.

The outer Codex model remains responsible for:

- user interaction and approvals;
- saving approved plan artifacts;
- source changes and patches;
- test execution;
- commits, pull requests, and deployments.

The inner Pro model is responsible for:

- repository-grounded analysis;
- architecture and tradeoff decisions;
- sprint decomposition;
- implementation review;
- concise handoff back to the execution model.

## Request lifecycle

1. The user explicitly invokes `$pro-architect`.
2. The skill selects one MCP tool.
3. The MCP server validates required fields and establishes cancellation state.
4. The service resolves the true Git root with `git rev-parse` and `realpath`.
5. The service calls the Responses API with `reasoning.mode=pro` and read-only function definitions.
6. Function calls are executed locally by `RepositoryInspector`.
7. All response output items and function results are appended to the next Responses API call.
8. The loop stops on a final assistant message, the tool-round cap, cancellation, timeout, or cost guardrail.
9. API-reported usage is accumulated and recorded locally.
10. The final Markdown and cost footer are returned through MCP.

## State

Version 0.1 is intentionally stateless across specialist invocations. Within one invocation, the complete Responses API item sequence is preserved so reasoning and function-call state remain coherent.

Persistent sessions will require:

- a stable project identity;
- explicit user-visible reset and resume controls;
- bounded retention and encryption decisions;
- migration behavior when model or prompt versions change;
- cost attribution across resumed sessions.

## Failure handling

| Failure | Behavior |
|---|---|
| Missing API key | MCP tool returns a concrete setup error |
| Non-Git path | Request fails before API use |
| Path escape | Tool call returns a bounded error to Pro |
| Missing `rg` | Falls back to `git grep` |
| OpenAI error | Tool returns an error; request ID is retained when supplied |
| Timeout or cancellation | Fetch and local subprocesses are aborted |
| Tool-round cap | Run fails without issuing another API request |
| Cost guardrail | Additional API rounds stop after the completed request that crossed the estimate |
| Empty final response | Run fails rather than fabricating an answer |

## Trust boundaries

1. **User and Codex host:** trusted to select a repository and authorize the paid call.
2. **Local MCP process:** trusted code with access to the selected repository and API credential.
3. **Repository content:** untrusted data, including instructions embedded in documentation or code.
4. **OpenAI API:** external processor receiving the task and selected repository excerpts.
5. **Outer Codex implementation phase:** separate from the read-only Pro specialist and governed by normal Codex approvals.
