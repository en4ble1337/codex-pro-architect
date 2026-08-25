---
name: pro-architect
description: Explicitly invoke the metered GPT-5.6 Pro Architect MCP specialist for repository-grounded architecture planning, sprint decomposition, implementation review, or a focused technical decision. Use only when the user names $pro-architect or explicitly requests Pro Architect because each call incurs separate OpenAI API charges.
---

# Pro Architect

Use this skill only when the user explicitly invokes `$pro-architect` or explicitly asks to use **Pro Architect**. It incurs OpenAI API charges outside the user's ChatGPT/Codex subscription.

## Invocation modes

Interpret the first requested action as one of these modes:

- `plan`: architecture, implementation plan, sprint decomposition, acceptance criteria, rollout, and rollback.
- `review`: review the current implementation or diff against an objective or approved plan.
- `consult`: answer one difficult architecture or technical decision using repository evidence.
- `status`: report local Pro Architect configuration and recent estimated API usage without calling OpenAI.

Default to `plan` only when the user clearly asks for planning. Do not silently invoke a billable tool for a routine implementation request.

## Repository root

Determine the absolute Git repository root for the active Codex workspace. Prefer the active working directory and verify it with `git rev-parse --show-toplevel` when needed.

## Required MCP use

Call the corresponding tool from the `pro-architect` MCP server:

- `architect_plan`
- `architect_review`
- `architect_consult`
- `architect_status`

Do not imitate or replace the MCP call with the current outer Codex model. If the MCP server or API credential is unavailable, return the concrete setup error instead of generating a substitute architecture answer.

## Planning behavior

For `plan`:

1. Pass the user's complete objective and hard constraints.
2. Tell the tool about compatibility, security, rollout, operational, or scope boundaries already established in the conversation.
3. Do not edit application code during the planning call.
4. Present the Pro Architect output without weakening its risks, assumptions, or blockers.
5. After the user approves the result, the outer Codex model may save durable plan artifacts or implement a named sprint.

Recommended durable paths after approval:

- `.codex/architecture/<feature>.md`
- `.codex/plans/<feature>.md`
- `.codex/sprints/<feature>-01.md`

## Review behavior

For `review`:

1. Pass the implementation objective.
2. Use `diff_scope=head` unless the user specifically limits the review to staged or working changes.
3. Include applicable architecture/plan paths.
4. Do not implement fixes during the Pro review.
5. Return findings ordered by severity and preserve repository evidence.

## Consult behavior

For `consult`, pass the exact decision, relevant context, and constraints. Keep the scope focused so Pro tokens are spent on the material decision rather than broad repository rediscovery.

## Cost and model handoff

Always retain the run footer showing model, usage, estimated API cost, and elapsed time. After planning or review completes, normal implementation remains with the current Codex model unless the user explicitly invokes `$pro-architect` again.
