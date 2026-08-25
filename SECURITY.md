# Security Policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose credentials, escape the repository boundary, execute arbitrary commands, or cause uncontrolled API spend.

Report it privately through GitHub's security-advisory interface for this repository. Include:

- affected version or commit;
- operating system and Node.js version;
- reproduction steps;
- expected and actual behavior;
- whether an API key, repository file, or external system was exposed;
- a minimal proof of concept that avoids real secrets.

## Supported versions

During the public alpha, only the latest tagged release is supported with security fixes.

## Security-sensitive invariants

A change must receive explicit security review if it:

- adds a new local command or tool;
- adds write access;
- weakens path canonicalization;
- exposes environment variables or credentials;
- adds a network listener;
- changes MCP authentication or transport;
- changes cost or retry limits;
- persists model context or repository excerpts.
