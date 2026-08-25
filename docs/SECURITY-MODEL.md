# Security Model

## Scope

The initial security objective is to make prompt injection and implementation mistakes unable to turn a Pro architecture call into local mutation or external infrastructure access.

## Assets

- source code and repository history;
- OpenAI API credential;
- local usage and configuration data;
- architecture output returned to Codex;
- user trust in reported evidence and cost.

## Principal threats

### Repository prompt injection

A repository may contain text instructing the model to ignore the user, disclose secrets, invoke tools repeatedly, or recommend malicious changes.

Mitigations:

- the system prompt labels all repository content as untrusted data;
- the model receives no write, arbitrary shell, credential, browser, SSH, or deployment tools;
- tool outputs repeat the untrusted-data notice;
- tool descriptions are narrow and evidence-oriented;
- output is advisory and returned to the outer Codex/user for review.

Residual risk: prompt injection can still bias an architecture recommendation. Users must review material decisions and evidence.

### Path traversal and symlink escape

Mitigations:

- repository roots and requested files use `realpath`;
- tool paths must be relative;
- lexical traversal is rejected before filesystem access;
- the resolved target must remain under the resolved Git root;
- tests cover both `../` traversal and a symlink targeting an external file.

### Command injection

Mitigations:

- there is no arbitrary shell tool;
- local commands use `spawn` with `shell: false`;
- command names are fixed in source;
- user and model values are individual arguments after option delimiters where relevant;
- revisions are syntax-restricted and cannot begin with `-`;
- subprocess time and output are bounded.

### Credential disclosure

Mitigations:

- the API key comes from the process environment or a `0600` credentials file;
- credentials are never placed in tool results or usage records;
- status returns only a masked key fingerprint;
- setup guidance avoids shell-history storage;
- the repository has no API-key access function.

Residual risk: any code executing as the same OS user can access that user's process environment or credentials file. Use a trusted workstation and account.

### Unbounded API spend

Mitigations:

- the skill disables implicit invocation and Codex is configured to prompt before MCP tool execution;
- status is separated and free;
- reasoning effort, tool rounds, output tokens, timeout, and estimated cost have configured ceilings;
- each API response is costed before another round is allowed;
- each completed or failed run is appended to a local usage ledger;
- the result footer shows estimated cost.

Residual risk: the first request, or the request crossing the threshold, has already incurred cost. OpenAI billing and project-level budgets remain the hard control plane.

### Denial of service through large repositories

Mitigations:

- tracked/non-ignored tree entries are capped;
- file byte and line reads are capped;
- search results and command output are capped;
- binary files are rejected;
- tool rounds and request duration are capped.

## Non-goals

- defending against a compromised local OS account;
- defending against a malicious modified installation of this package;
- guaranteeing that model-generated architecture is correct;
- preventing OpenAI from processing the excerpts deliberately sent to the API;
- replacing OpenAI project budgets, audit logs, or organization policies.

## Safe expansion policy

Do not add write, patch, shell, SSH, browser, cloud, or deployment tools to the Pro agent without a separate threat model, explicit approvals, structured argument validation, and end-to-end tests. The preferred architecture is to keep implementation in the outer Codex harness.
