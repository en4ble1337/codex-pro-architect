import readline from "node:readline";
import { loadApiKey, loadConfig, getPaths, maskedKey } from "./config.js";
import { runArchitect } from "./architect.js";
import { readUsageEntries, summarizeUsage } from "./usage.js";
import { packageMetadata } from "./version.js";

const LATEST_PROTOCOL = "2025-11-25";
const SUPPORTED_PROTOCOLS = new Set(["2025-11-25", "2025-06-18", "2024-11-05"]);

const commonProperties = {
  repository_root: {
    type: "string",
    minLength: 1,
    description: "Absolute path to the local Git repository to inspect."
  },
  constraints: {
    oneOf: [
      { type: "string" },
      { type: "array", items: { type: "string" }, maxItems: 100 }
    ],
    description: "Hard constraints the architecture must preserve."
  },
  effort: {
    type: "string",
    enum: ["low", "medium", "high", "xhigh", "max"],
    description: "GPT-5.6 reasoning effort. Pro mode remains enabled."
  },
  max_tool_rounds: {
    type: "integer",
    minimum: 1,
    maximum: 100,
    description: "Optional lower per-run cap; cannot exceed the configured cap."
  },
  max_output_tokens: {
    type: "integer",
    minimum: 1000,
    maximum: 128000,
    description: "Optional lower per-run cap; cannot exceed the configured cap."
  },
  max_run_cost_usd: {
    type: "number",
    exclusiveMinimum: 0,
    description: "Optional lower estimated-cost guardrail; cannot exceed the configured cap."
  }
};

export function listTools() {
  return [
    {
      name: "architect_plan",
      title: "Pro Architect — Plan",
      description:
        "Use metered GPT-5.6 Pro to inspect a Git repository read-only and produce an implementation-ready architecture and sprint plan. Incurs OpenAI API charges.",
      inputSchema: {
        type: "object",
        properties: {
          ...commonProperties,
          objective: { type: "string", minLength: 1, maxLength: 30000 }
        },
        required: ["repository_root", "objective"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    {
      name: "architect_review",
      title: "Pro Architect — Review",
      description:
        "Use metered GPT-5.6 Pro to review the current repository diff and implementation against an objective or architecture plan. Read-only; incurs OpenAI API charges.",
      inputSchema: {
        type: "object",
        properties: {
          ...commonProperties,
          objective: { type: "string", minLength: 1, maxLength: 30000 },
          diff_scope: { type: "string", enum: ["working", "staged", "head"], default: "head" },
          plan_paths: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 500 },
            maxItems: 20
          }
        },
        required: ["repository_root", "objective"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    {
      name: "architect_consult",
      title: "Pro Architect — Consult",
      description:
        "Use metered GPT-5.6 Pro for a focused architecture decision grounded in read-only repository evidence. Incurs OpenAI API charges.",
      inputSchema: {
        type: "object",
        properties: {
          ...commonProperties,
          question: { type: "string", minLength: 1, maxLength: 30000 },
          context: { type: "string", maxLength: 30000 }
        },
        required: ["repository_root", "question"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    {
      name: "architect_status",
      title: "Pro Architect — Status",
      description: "Show local configuration, credential presence, and recent estimated API usage. Does not call OpenAI.",
      inputSchema: {
        type: "object",
        properties: {
          usage_limit: { type: "integer", minimum: 1, maximum: 10000, default: 100 }
        },
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    }
  ];
}

function assertObject(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object");
  return value;
}

function requireString(args, name) {
  if (typeof args[name] !== "string" || !args[name].trim()) throw new Error(`${name} is required`);
}

async function status(args) {
  const config = await loadConfig();
  const paths = getPaths();
  let keyStatus;
  try {
    keyStatus = maskedKey(await loadApiKey());
  } catch {
    keyStatus = "not configured";
  }
  const entries = await readUsageEntries(args.usage_limit ?? 100);
  const summary = summarizeUsage(entries);
  return [
    "# Pro Architect Status",
    "",
    `- Model: \`${config.model}\``,
    `- Reasoning: \`${config.reasoningMode}\` / \`${config.reasoningEffort}\``,
    `- API key: ${keyStatus}`,
    `- Config: \`${paths.configFile}\``,
    `- Credentials: \`${paths.credentialsFile}\``,
    `- Usage ledger: \`${paths.usageFile}\``,
    `- Configured max run cost: $${config.maxRunCostUsd.toFixed(2)}`,
    `- Recent runs considered: ${summary.runs}`,
    `- Recent estimated cost: $${summary.estimatedCostUsd.toFixed(4)}`,
    `- Recent input/output tokens: ${summary.inputTokens.toLocaleString()} / ${summary.outputTokens.toLocaleString()}`
  ].join("\n");
}

export async function callTool(name, rawArgs, options = {}) {
  const args = assertObject(rawArgs);
  if (name === "architect_status") return await status(args);
  if (name === "architect_plan") {
    requireString(args, "repository_root");
    requireString(args, "objective");
    return (await runArchitect("plan", args, options)).formatted;
  }
  if (name === "architect_review") {
    requireString(args, "repository_root");
    requireString(args, "objective");
    return (
      await runArchitect(
        "review",
        { ...args, diffScope: args.diff_scope, planPaths: args.plan_paths ?? [] },
        options
      )
    ).formatted;
  }
  if (name === "architect_consult") {
    requireString(args, "repository_root");
    requireString(args, "question");
    return (await runArchitect("consult", args, options)).formatted;
  }
  throw new Error(`Unknown tool: ${name}`);
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function requestKey(id) {
  return `${typeof id}:${String(id)}`;
}

export async function startMcpServer() {
  const metadata = await packageMetadata();
  const active = new Map();
  const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });

  const handle = async (message) => {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      if (message?.id !== undefined) send(jsonRpcError(message.id, -32600, "Invalid Request"));
      return;
    }

    if (message.method === "notifications/initialized") return;
    if (message.method === "notifications/cancelled") {
      const cancelledId = message.params?.requestId;
      active.get(requestKey(cancelledId))?.abort();
      return;
    }
    if (message.id === undefined) return;

    const id = message.id;
    const controller = new AbortController();
    active.set(requestKey(id), controller);
    try {
      if (message.method === "initialize") {
        const requested = message.params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : LATEST_PROTOCOL;
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: metadata.name, version: metadata.version },
            instructions:
              "This server exposes explicitly invoked, metered GPT-5.6 Pro architecture tools. Repository access is read-only."
          }
        });
        return;
      }
      if (message.method === "ping") {
        send({ jsonrpc: "2.0", id, result: {} });
        return;
      }
      if (message.method === "tools/list") {
        send({ jsonrpc: "2.0", id, result: { tools: listTools() } });
        return;
      }
      if (message.method === "tools/call") {
        const name = message.params?.name;
        try {
          const text = await callTool(name, message.params?.arguments, { signal: controller.signal });
          send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: false } });
        } catch (error) {
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Pro Architect error: ${error.message}` }],
              isError: true
            }
          });
        }
        return;
      }
      send(jsonRpcError(id, -32601, "Method not found", { method: message.method }));
    } catch (error) {
      send(jsonRpcError(id, -32603, "Internal error", { message: error.message }));
    } finally {
      active.delete(requestKey(id));
    }
  };

  reader.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      send(jsonRpcError(null, -32700, "Parse error", { message: error.message }));
      return;
    }
    void handle(message);
  });

  await new Promise((resolve) => reader.once("close", resolve));
}
