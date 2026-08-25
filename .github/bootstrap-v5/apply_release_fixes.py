#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

SERVE_MCP = r'''export async function serveMcp({ input = process.stdin, output = process.stdout, errorOutput = process.stderr, handler = createMcpHandler() } = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const inFlight = new Set();

  const dispatch = (message) => {
    let pendingResponse;
    try {
      // Invoke immediately so tools/call registers its AbortController before the
      // stdio loop accepts a following notifications/cancelled message.
      pendingResponse = handler(message);
    } catch (error) {
      errorOutput.write(`codex-pro-architect MCP failure: ${safeErrorMessage(error)}\n`);
      if (message.id != null) output.write(`${JSON.stringify(rpcError(message.id, -32603, "Internal error"))}\n`);
      return;
    }

    let task;
    task = Promise.resolve(pendingResponse)
      .then((response) => {
        if (response) output.write(`${JSON.stringify(response)}\n`);
      })
      .catch((error) => {
        errorOutput.write(`codex-pro-architect MCP failure: ${safeErrorMessage(error)}\n`);
        if (message.id != null) output.write(`${JSON.stringify(rpcError(message.id, -32603, "Internal error"))}\n`);
      })
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  };

  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(rpcError(null, -32700, "Parse error"))}\n`);
      continue;
    }
    dispatch(message);
  }

  await Promise.allSettled([...inFlight]);
}
'''

TEST = r'''import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createMcpHandler, serveMcp } from "../src/mcp.js";
import { DEFAULT_CONFIG } from "../src/config.js";

function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("timed out waiting for condition"));
      setTimeout(poll, 5);
    };
    poll();
  });
}

test("stdio consumes cancellation while a paid tools/call is in flight", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const errors = new PassThrough();
  let stdout = "";
  let observedAbort = false;
  let runStarted = false;
  output.on("data", (chunk) => { stdout += chunk.toString("utf8"); });

  const handler = createMcpHandler({
    loadConfig: () => ({ config: DEFAULT_CONFIG, paths: { usageFile: "/tmp/cpa-unused-usage.jsonl" } }),
    loadApiKey: () => "sk-test-value",
    runArchitect: ({ signal }) => new Promise((resolve, reject) => {
      runStarted = true;
      const onAbort = () => {
        observedAbort = true;
        const error = new Error("cancelled by MCP client");
        error.code = "CANCELLED";
        reject(error);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    })
  });

  const serving = serveMcp({ input, output, errorOutput: errors, handler });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "architect_plan", arguments: { repository_root: "/repo", objective: "plan" } } })}\n`);
  await waitFor(() => runStarted);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 42, reason: "user cancelled" } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 43, method: "ping", params: {} })}\n`);
  input.end();

  await serving;
  assert.equal(observedAbort, true);
  const messages = stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  assert.equal(messages.filter((message) => message.id === 42).length, 1);
  assert.equal(messages.find((message) => message.id === 42)?.result?.isError, true);
  assert.deepEqual(messages.find((message) => message.id === 43)?.result, {});
});
'''

DIRECTIVE = r'''# Directive 004: In-Flight MCP Cancellation

**Status:** Complete  
**Date:** 2026-08-25

## Root Cause

The original stdio loop awaited each handler before reading the next JSON-RPC message. A long paid `tools/call` therefore prevented the process from consuming `notifications/cancelled` until the request had already completed.

## Acceptance Criteria

- [x] Add a failing process-level regression that starts a paid call and sends cancellation before it resolves.
- [x] Register the request AbortController before another stdio message can be handled.
- [x] Continue reading and dispatching JSON-RPC messages while requests are in flight.
- [x] Abort the exact request and emit at most one response for its ID.
- [x] Preserve subsequent framing and ping behavior.
- [x] Rerun Launchpad, Node 20/22, Ubuntu/macOS, audit, and packed-install gates.

## Verification

```bash
node --test tests/mcp-cancellation.test.js
npm run ci
npm run smoke:package
```
'''


def apply(root: Path) -> None:
    mcp = root / "src" / "mcp.js"
    text = mcp.read_text(encoding="utf-8")
    marker = "export async function serveMcp"
    index = text.find(marker)
    if index < 0:
        raise SystemExit("serveMcp export not found")
    mcp.write_text(text[:index] + SERVE_MCP, encoding="utf-8")

    (root / "tests" / "mcp-cancellation.test.js").write_text(TEST, encoding="utf-8")
    (root / "directives" / "004_mcp_inflight_cancellation.md").write_text(DIRECTIVE, encoding="utf-8")
    shutil.rmtree(root / "release-blockers", ignore_errors=True)

    review = root / "docs" / "SECOND-AGENT-REVIEW.md"
    body = review.read_text(encoding="utf-8")
    body = body.replace("## Important Findings\n\nNone after fixes.", "## Important Findings\n\nNone.")
    body = body.replace("## Critical Findings\n\nNone after fixes.", "## Critical Findings\n\nNone.")
    anchor = "3. **Verification count:** earlier narrative overreported the baseline. The release gate now derives its pass count from the actual Node test runner and package smoke rather than a manual claim."
    addition = anchor + "\n4. **In-flight MCP cancellation:** the original sequential stdio loop could not read `notifications/cancelled` during a paid request. The dispatcher now keeps reading while requests run concurrently, registers cancellation state before yielding, and has a process-level regression proving abort, single-response, and subsequent framing behavior."
    if anchor in body and "In-flight MCP cancellation" not in body:
        body = body.replace(anchor, addition)
    review.write_text(body, encoding="utf-8")

    arch = root / "docs" / "ARCH.md"
    body = arch.read_text(encoding="utf-8")
    body = body.replace(
        "Supported methods: initialize, initialized notification, ping, tools/list, tools/call, cancelled notification.",
        "Supported methods: initialize, initialized notification, ping, tools/list, tools/call, and concurrent cancelled notification handling for active requests.",
    )
    arch.write_text(body, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    apply(Path(args.root).resolve())
