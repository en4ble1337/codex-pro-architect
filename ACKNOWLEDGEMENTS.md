# Acknowledgements

Codex Pro Architect is an original implementation built around the official OpenAI Responses API and a local read-only MCP server.

The high-level product idea was informed by community projects exploring how to make premium ChatGPT reasoning available from Codex, particularly [`miuuyy/codex-chatgpt-web`](https://github.com/miuuyy/codex-chatgpt-web).

This project deliberately takes a different technical and security path:

- no browser automation;
- no ChatGPT cookies or embedded browser profile;
- no attempt to convert subscription web usage into an API transport;
- explicit metered OpenAI API calls;
- a narrower read-only specialist instead of replacing the native Codex model route.

Thanks to the Model Context Protocol and Codex communities for documenting interoperable local tool patterns.
