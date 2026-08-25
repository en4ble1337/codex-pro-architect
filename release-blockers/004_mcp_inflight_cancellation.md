# Release Blocker 004: In-Flight MCP Cancellation

The stdio server must continue reading JSON-RPC messages while a paid `tools/call` request is running so that `notifications/cancelled` can abort the active request.

Release remains blocked until:

- a process-level failing regression sends `tools/call`, then `notifications/cancelled` before the tool resolves;
- the active `AbortController` is observed as aborted;
- the server emits at most one response for the cancelled request;
- normal framing and subsequent requests remain valid;
- the complete Launchpad, Node 20/22, Ubuntu/macOS, audit, and packed-install gates pass.
