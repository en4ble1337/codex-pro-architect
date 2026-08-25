import test from "node:test";
import assert from "node:assert/strict";
import { mcpSectionSettings, patchMcpSection } from "../src/install.js";

test("patches an existing MCP section without changing adjacent sections", () => {
  const input = `[model]\nname = "gpt-5.6"\n\n[mcp_servers.pro-architect]\ncommand = "node"\nargs = ["cli.js", "mcp"]\ntool_timeout_sec = 60\n\n[mcp_servers.other]\ncommand = "other"\n`;
  const output = patchMcpSection(input, "pro-architect", {
    startup_timeout_sec: 20,
    tool_timeout_sec: 1260,
    required: false,
    default_tools_approval_mode: "prompt"
  });

  assert.match(output, /\[mcp_servers\.pro-architect\][\s\S]*tool_timeout_sec = 1260/);
  assert.match(output, /startup_timeout_sec = 20/);
  assert.match(output, /required = false/);
  assert.match(output, /default_tools_approval_mode = "prompt"/);
  assert.match(output, /\[mcp_servers\.other\]\ncommand = "other"/);
  assert.doesNotMatch(output, /tool_timeout_sec = 60/);
});

test("supports a quoted MCP server table", () => {
  const input = `[mcp_servers."pro-architect"]\ncommand = "node"\n`;
  const output = patchMcpSection(input, "pro-architect", { tool_timeout_sec: 900 });
  assert.match(output, /tool_timeout_sec = 900/);
});

test("fails closed when the expected MCP section is absent", () => {
  assert.throws(() => patchMcpSection("[model]\nname='x'\n", "pro-architect", { tool_timeout_sec: 900 }), /Could not find/);
});


test("patching is idempotent and settings remain machine-readable", () => {
  const input = `[mcp_servers.pro-architect]\ncommand = "node"\nargs = ["cli.js", "mcp"]\n`;
  const settings = {
    startup_timeout_sec: 20,
    tool_timeout_sec: 1260,
    required: false,
    default_tools_approval_mode: "prompt"
  };
  const once = patchMcpSection(input, "pro-architect", settings);
  const twice = patchMcpSection(once, "pro-architect", settings);
  assert.equal(twice, once);
  assert.deepEqual(mcpSectionSettings(twice, "pro-architect"), {
    command: "node",
    args: '["cli.js", "mcp"]',
    ...settings
  });
});

test("preserves inline comments while replacing policy values", () => {
  const input = `[mcp_servers.pro-architect]\ntool_timeout_sec = 60 # old default\ndefault_tools_approval_mode = "auto" # unsafe for paid calls\n`;
  const output = patchMcpSection(input, "pro-architect", {
    tool_timeout_sec: 1260,
    default_tools_approval_mode: "prompt"
  });
  assert.match(output, /tool_timeout_sec = 1260/);
  assert.match(output, /default_tools_approval_mode = "prompt"/);
  assert.doesNotMatch(output, /old default|unsafe for paid/);
});
