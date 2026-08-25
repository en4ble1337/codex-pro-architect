import test from "node:test";
import assert from "node:assert/strict";
import { callTool, listTools } from "../src/mcp.js";

test("exposes explicit billable architect tools and a free status tool", () => {
  const tools = listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["architect_plan", "architect_review", "architect_consult", "architect_status"]
  );
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
  }
  assert.equal(tools.find((tool) => tool.name === "architect_status").annotations.idempotentHint, true);
});


test("validates MCP tool arguments before any paid work", async () => {
  await assert.rejects(
    () => callTool("architect_plan", { repository_root: "/tmp", objective: "x".repeat(30_001) }),
    /objective.*30000/i
  );
  await assert.rejects(
    () => callTool("architect_plan", { repository_root: "/tmp", objective: "plan", unexpected: true }),
    /unexpected|additional/i
  );
  await assert.rejects(
    () => callTool("architect_review", { repository_root: "/tmp", objective: "review", diff_scope: "everything" }),
    /diff_scope/i
  );
  await assert.rejects(
    () => callTool("architect_status", { usage_limit: 10001 }),
    /usage_limit/i
  );
});

test("serves initialize, ping, tools/list, and parse errors over stdio", async (t) => {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const child = spawn(process.execPath, [cli, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));

  const responses = [];
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    let newline;
    while ((newline = stdout.indexOf("\n")) >= 0) {
      const line = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      if (line.trim()) responses.push(JSON.parse(line));
    }
  });

  child.stdin.write('{not-json}\n');
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" })}\n`);

  const deadline = Date.now() + 5_000;
  while (responses.length < 4 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  child.stdin.end();
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP process did not exit; stderr=${stderr}`)), 5_000);
    child.once("close", (code) => { clearTimeout(timer); resolve(code); });
  });

  assert.equal(exit, 0, stderr);
  assert.equal(responses.find((item) => item.error?.code === -32700)?.id, null);
  assert.equal(responses.find((item) => item.id === 1)?.result.protocolVersion, "2025-11-25");
  assert.deepEqual(responses.find((item) => item.id === 2)?.result, {});
  assert.equal(responses.find((item) => item.id === 3)?.result.tools.length, 4);
});

test("negotiates the Codex legacy MCP protocol and rejects oversized JSON-RPC input", async (t) => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { fileURLToPath } = await import("node:url");
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const child = spawn(process.execPath, [cli, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));

  const responses = [];
  let pending = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.trim()) responses.push(JSON.parse(line));
    }
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 10, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
  const oversized = JSON.stringify({ jsonrpc: "2.0", id: 11, method: "ping", params: { padding: "x".repeat(8 * 1024 * 1024) } });
  if (!child.stdin.write(`${oversized}\n`)) await once(child.stdin, "drain");

  const deadline = Date.now() + 10_000;
  while (responses.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  child.stdin.end();
  const [exit] = await once(child, "close");

  assert.equal(exit, 0, stderr);
  assert.equal(responses.find((item) => item.id === 10)?.result.protocolVersion, "2025-06-18");
  const oversizedError = responses.find((item) => item.error?.code === -32600);
  assert.equal(oversizedError?.id, null);
  assert.match(oversizedError?.error.message, /message.*limit|too large|exceeds/i);
  assert.equal(stderr, "");
});

test("cancels an active paid tool call and keeps stdout JSON-RPC clean", async (t) => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const http = await import("node:http");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { runProcess } = await import("../src/process.js");

  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const server = http.createServer((request, response) => {
    if (request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    request.resume();
    markStarted();
    response.on("close", () => {});
    // Intentionally do not answer; the MCP cancellation must abort fetch.
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "pro-architect-mcp-cancel-repo-"));
  await runProcess("git", ["init", "-q", repositoryRoot]);
  await runProcess("git", ["-C", repositoryRoot, "config", "user.email", "test@example.com"]);
  await runProcess("git", ["-C", repositoryRoot, "config", "user.name", "Test User"]);
  const stateRoot = await mkdtemp(path.join(tmpdir(), "pro-architect-mcp-cancel-state-"));
  const address = server.address();
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const child = spawn(process.execPath, [cli, "mcp"], {
    env: {
      ...process.env,
      OPENAI_API_KEY: "sk-test-key-that-is-long-enough-not-real",
      OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      XDG_CONFIG_HOME: path.join(stateRoot, "config"),
      XDG_STATE_HOME: path.join(stateRoot, "state")
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  t.after(() => child.kill("SIGKILL"));

  const responses = [];
  const rawLines = [];
  let pending = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!line.trim()) continue;
      rawLines.push(line);
      responses.push(JSON.parse(line));
    }
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 20, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 21,
    method: "tools/call",
    params: {
      name: "architect_plan",
      arguments: { repository_root: repositoryRoot, objective: "Produce a test architecture plan" }
    }
  })}\n`);

  await Promise.race([
    started,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Mock Responses request did not start")), 5_000))
  ]);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 21 } })}\n`);

  const deadline = Date.now() + 10_000;
  while (!responses.some((item) => item.id === 21) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  child.stdin.end();
  const [exit] = await once(child, "close");

  assert.equal(exit, 0, stderr);
  const cancelled = responses.find((item) => item.id === 21);
  assert.equal(cancelled?.result.isError, true);
  assert.match(cancelled?.result.content[0].text, /cancel/i);
  for (const line of rawLines) assert.doesNotThrow(() => JSON.parse(line));
});
