import { loadApiKey, loadConfig, getPaths, maskedKey } from "./config.js";
import { runArchitect } from "./architect.js";
import { readUsageEntries, summarizeUsage } from "./usage.js";
import { packageMetadata } from "./version.js";

const LATEST_PROTOCOL = "2025-11-25";
const SUPPORTED_PROTOCOLS = new Set(["2025-11-25", "2025-06-18", "2024-11-05"]);
export const MAX_MCP_MESSAGE_BYTES = 8 * 1024 * 1024;

const commonProperties = {
  repository_root: {
    type: "string",
    minLength: 1,
    maxLength: 4096,
    description: "Absolute path to the local Git repository to inspect."
  },
  constraints: {
    oneOf: [
      { type: "string", maxLength: 30000 },
      { type: "array", items: { type: "string", minLength: 1, maxLength: 1000 }, maxItems: 100 }
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
    maximum: 10000,
    description: "Optional lower estimated-cost guardrail; cannot exceed the configured cap."
  }
};


function plainObject(value, label = "Tool arguments") {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function rejectUnknown(args, allowed) {
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) throw new Error(`Unexpected tool argument: ${key}`);
  }
}

function requiredString(args, name, maxLength) {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  if (value.length > maxLength) throw new Error(`${name} must be at most ${maxLength} characters`);
  return value;
}

function optionalString(args, name, maxLength) {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (value.length > maxLength) throw new Error(`${name} must be at most ${maxLength} characters`);
  return value;
}

function optionalInteger(args, name, min, max) {
  const value = args[name];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function optionalNumber(args, name, minExclusive, max) {
  const value = args[name];
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= minExclusive || value > max) {
    throw new Error(`${name} must be a number greater than ${minExclusive} and at most ${max}`);
  }
  return value;
}

function validateConstraints(value) {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (value.length > 30000) throw new Error("constraints must be at most 30000 characters");
    return value;
  }
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("constraints must be a string or an array with at most 100 strings");
  }
  let total = 0;
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item.length > 1000) {
      throw new Error("each constraints item must be a non-empty string of at most 1000 characters");
    }
    total += item.length;
  }
  if (total > 30000) throw new Error("constraints array must total at most 30000 characters");
  return value;
}

function validateCommon(args) {
  const normalized = {
    repository_root: requiredString(args, "repository_root", 4096)
  };
  const constraints = validateConstraints(args.constraints);
  if (constraints !== undefined) normalized.constraints = constraints;
  if (args.effort !== undefined) {
    if (!["low", "medium", "high", "xhigh", "max"].includes(args.effort)) {
      throw new Error("effort must be low, medium, high, xhigh, or max");
    }
    normalized.effort = args.effort;
  }
  for (const [name, min, max] of [
    ["max_tool_rounds", 1, 100],
    ["max_output_tokens", 1000, 128000]
  ]) {
    const value = optionalInteger(args, name, min, max);
    if (value !== undefined) normalized[name] = value;
  }
  const maxCost = optionalNumber(args, "max_run_cost_usd", 0, 10000);
  if (maxCost !== undefined) normalized.max_run_cost_usd = maxCost;
  return normalized;
}

const COMMON_KEYS = new Set([
  "repository_root",
  "constraints",
  "effort",
  "max_tool_rounds",
  "max_output_tokens",
  "max_run_cost_usd"
]);

export function validateToolArguments(name, rawArgs) {
  const args = plainObject(rawArgs);
  if (name === "architect_status") {
    rejectUnknown(args, new Set(["usage_limit"]));
    return { usage_limit: optionalInteger(args, "usage_limit", 1, 10000) ?? 100 };
  }

  if (name === "architect_plan") {
    rejectUnknown(args, new Set([...COMMON_KEYS, "objective"]));
    return { ...validateCommon(args), objective: requiredString(args, "objective", 30000) };
  }

  if (name === "architect_review") {
    rejectUnknown(args, new Set([...COMMON_KEYS, "objective", "diff_scope", "plan_paths"]));
    const normalized = { ...validateCommon(args), objective: requiredString(args, "objective", 30000) };
    if (args.diff_scope !== undefined) {
      if (!["working", "staged", "head"].includes(args.diff_scope)) {
        throw new Error("diff_scope must be working, staged, or head");
      }
      normalized.diff_scope = args.diff_scope;
    }
    if (args.plan_paths !== undefined) {
      if (!Array.isArray(args.plan_paths) || args.plan_paths.length > 20) {
        throw new Error("plan_paths must be an array with at most 20 paths");
      }
      normalized.plan_paths = args.plan_paths.map((value, index) => {
        if (typeof value !== "string" || !value.trim() || value.length > 500) {
          throw new Error(`plan_paths[${index}] must be a non-empty string of at most 500 characters`);
        }
        return value;
      });
    }
    return normalized;
  }

  if (name === "architect_consult") {
    rejectUnknown(args, new Set([...COMMON_KEYS, "question", "context"]));
    const normalized = { ...validateCommon(args), question: requiredString(args, "question", 30000) };
    const context = optionalString(args, "context", 30000);
    if (context !== undefined) normalized.context = context;
    return normalized;
  }

  throw new Error(`Unknown tool: ${name}`);
}

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

export async function callTool(name, rawArgs, options = {}) {
  const args = validateToolArguments(name, rawArgs);
  if (name === "architect_status") return await status(args);
  if (name === "architect_plan") return (await runArchitect("plan", args, options)).formatted;
  if (name === "architect_review") {
    return (
      await runArchitect(
        "review",
        { ...args, diffScope: args.diff_scope, planPaths: args.plan_paths ?? [] },
        options
      )
    ).formatted;
  }
  if (name === "architect_consult") return (await runArchitect("consult", args, options)).formatted;
  throw new Error(`Unknown tool: ${name}`);
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function requestKey(id) {
  return `${typeof id}:${String(id)}`;
}

function createSender(output) {
  return (message) => {
    output.write(`${JSON.stringify(message)}\n`);
  };
}

export async function startMcpServer({
  input = process.stdin,
  output = process.stdout,
  maxMessageBytes = MAX_MCP_MESSAGE_BYTES
} = {}) {
  if (!Number.isInteger(maxMessageBytes) || maxMessageBytes < 1024) {
    throw new Error("maxMessageBytes must be an integer of at least 1024 bytes");
  }

  const metadata = await packageMetadata();
  const active = new Map();
  const pending = new Set();
  const send = createSender(output);

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

  const track = (promise) => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
  };

  const parseLine = (lineBuffer) => {
    let effective = lineBuffer;
    if (effective.at(-1) === 0x0d) effective = effective.subarray(0, -1);
    if (effective.length === 0) return;
    let message;
    try {
      message = JSON.parse(effective.toString("utf8"));
    } catch (error) {
      send(jsonRpcError(null, -32700, "Parse error", { message: error.message }));
      return;
    }
    track(handle(message));
  };

  let buffer = Buffer.alloc(0);
  let discardingOversizedLine = false;

  const consume = (rawChunk) => {
    let chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    while (chunk.length > 0) {
      if (discardingOversizedLine) {
        const newline = chunk.indexOf(0x0a);
        if (newline < 0) return;
        discardingOversizedLine = false;
        chunk = chunk.subarray(newline + 1);
        continue;
      }

      const newline = chunk.indexOf(0x0a);
      if (newline < 0) {
        if (buffer.length + chunk.length > maxMessageBytes) {
          buffer = Buffer.alloc(0);
          discardingOversizedLine = true;
          send(jsonRpcError(null, -32600, `JSON-RPC message exceeds the ${maxMessageBytes}-byte limit`));
          return;
        }
        buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
        return;
      }

      const segment = chunk.subarray(0, newline);
      if (buffer.length + segment.length > maxMessageBytes) {
        send(jsonRpcError(null, -32600, `JSON-RPC message exceeds the ${maxMessageBytes}-byte limit`));
      } else {
        const line = buffer.length === 0 ? segment : Buffer.concat([buffer, segment]);
        parseLine(line);
      }
      buffer = Buffer.alloc(0);
      chunk = chunk.subarray(newline + 1);
    }
  };

  await new Promise((resolve, reject) => {
    const onData = (chunk) => consume(chunk);
    const onError = (error) => reject(error);
    const onEnd = () => resolve();
    input.on("data", onData);
    input.once("error", onError);
    input.once("end", onEnd);
    input.once("close", onEnd);
  });

  if (!discardingOversizedLine && buffer.length > 0) parseLine(buffer);
  for (const controller of active.values()) controller.abort();
  await Promise.allSettled([...pending]);
}
