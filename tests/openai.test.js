import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createResponse, responseOutputToInputItems } from "../src/openai.js";

test("normalizes replayable response output without dropping encrypted reasoning", () => {
  assert.deepEqual(
    responseOutputToInputItems([
      {
        id: "rs_1",
        type: "reasoning",
        encrypted_content: "ciphertext",
        summary: [],
        created_by: "server"
      },
      {
        id: "fc_1",
        type: "function_call",
        call_id: "call_1",
        name: "repo_tree",
        arguments: "{}",
        status: "completed",
        created_by: "server"
      }
    ]),
    [
      { id: "rs_1", type: "reasoning", encrypted_content: "ciphertext", summary: [] },
      {
        id: "fc_1",
        type: "function_call",
        call_id: "call_1",
        name: "repo_tree",
        arguments: "{}",
        status: "completed"
      }
    ]
  );
});

test("fails closed when the Responses API returns a non-completed status", async (t) => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      id: "resp_incomplete",
      status: "incomplete",
      output: [],
      incomplete_details: { reason: "max_output_tokens" }
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const previous = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previous;
  });

  await assert.rejects(
    () => createResponse("sk-test-not-real", { model: "gpt-5.6", input: "test" }, { timeoutMs: 5_000 }),
    /status incomplete.*max_output_tokens/i
  );
});
