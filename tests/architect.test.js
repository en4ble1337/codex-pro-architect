import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runArchitect } from "../src/architect.js";
import { runProcess } from "../src/process.js";

async function gitFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pro-architect-agent-"));
  await runProcess("git", ["init", "-q", root]);
  await runProcess("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await runProcess("git", ["-C", root, "config", "user.name", "Test User"]);
  await writeFile(path.join(root, "README.md"), "# Agent fixture\n");
  await runProcess("git", ["-C", root, "add", "."]);
  await runProcess("git", ["-C", root, "commit", "-qm", "initial"]);
  return root;
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

test("runs a Responses API function-call loop and returns a metered plan", async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push(body);
    response.setHeader("content-type", "application/json");
    response.setHeader("x-request-id", `req_${requests.length}`);

    if (requests.length === 1) {
      response.end(
        JSON.stringify({
          id: "resp_1",
          status: "completed",
          output: [
            {
              id: "rs_1",
              type: "reasoning",
              encrypted_content: "encrypted-reasoning-fixture",
              created_by: "transport-only",
              summary: []
            },
            {
              id: "fc_1",
              type: "function_call",
              status: "completed",
              name: "repo_tree",
              call_id: "call_1",
              arguments: "{}"
            }
          ],
          usage: {
            input_tokens: 10_000,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 1_000,
            output_tokens_details: { reasoning_tokens: 700 },
            total_tokens: 11_000
          }
        })
      );
      return;
    }

    response.end(
      JSON.stringify({
        id: "resp_2",
        status: "completed",
        output: [
          {
            id: "msg_1",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "# Architecture Plan\n\nUse the existing README." }]
          }
        ],
        usage: {
          input_tokens: 12_000,
          input_tokens_details: { cached_tokens: 2_000 },
          output_tokens: 2_000,
          output_tokens_details: { reasoning_tokens: 1_200 },
          total_tokens: 14_000
        }
      })
    );
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const state = await mkdtemp(path.join(tmpdir(), "pro-architect-state-"));
  const root = await gitFixture();

  const previous = {
    base: process.env.OPENAI_BASE_URL,
    key: process.env.OPENAI_API_KEY,
    config: process.env.XDG_CONFIG_HOME,
    state: process.env.XDG_STATE_HOME
  };
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  process.env.XDG_CONFIG_HOME = path.join(state, "config");
  process.env.XDG_STATE_HOME = path.join(state, "state");
  t.after(() => {
    if (previous.base === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previous.base;
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.key;
    if (previous.config === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous.config;
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous.state;
  });

  const result = await runArchitect("plan", {
    repository_root: root,
    objective: "Create a test plan",
    max_tool_rounds: 3
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].reasoning.mode, "pro");
  assert.equal(requests[0].reasoning.effort, "medium");
  assert.equal(requests[0].reasoning.context, "all_turns");
  assert.equal(requests[0].store, false);
  assert.deepEqual(requests[0].include, ["reasoning.encrypted_content"]);
  const replayedReasoning = requests[1].input.find((item) => item.type === "reasoning");
  assert.equal(replayedReasoning.encrypted_content, "encrypted-reasoning-fixture");
  assert.equal(replayedReasoning.created_by, undefined);
  assert.equal(requests[1].input.at(-1).type, "function_call_output");
  assert.match(requests[1].input.at(-1).output, /README\.md/);
  assert.match(result.formatted, /# Architecture Plan/);
  assert.match(result.formatted, /Estimated API cost/);
  assert.equal(result.usage.requests, 2);
  assert.equal(result.toolCalls, 1);
});
