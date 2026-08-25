import test from "node:test";
import assert from "node:assert/strict";
import { listTools } from "../src/mcp.js";

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
