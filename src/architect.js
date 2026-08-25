import { loadApiKey, loadConfig } from "./config.js";
import { createResponse, extractOutputText, functionCalls, responseOutputToInputItems } from "./openai.js";
import { consultPrompt, planPrompt, reviewPrompt } from "./prompts.js";
import { RepositoryInspector, resolveRepositoryRoot } from "./repository.js";
import { REPOSITORY_TOOL_DEFINITIONS } from "./repository-tools.js";
import { addRequestUsage, emptyUsage, recordUsage } from "./usage.js";

function parseArguments(call) {
  try {
    const value = JSON.parse(call.arguments || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
    return value;
  } catch (error) {
    throw new Error(`Invalid arguments for ${call.name}: ${error.message}`);
  }
}

function promptFor(kind, input) {
  if (kind === "plan") return planPrompt(input);
  if (kind === "review") return reviewPrompt(input);
  if (kind === "consult") return consultPrompt(input);
  throw new Error(`Unsupported architect mode: ${kind}`);
}

function boundInteger(value, fallback, min, max) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Expected an integer from ${min} to ${max}, received ${value}`);
  }
  return parsed;
}

function effectiveEffort(requested, configured) {
  const allowed = ["low", "medium", "high", "xhigh", "max"];
  if (requested === undefined || requested === null) return configured;
  if (!allowed.includes(requested)) throw new Error(`Invalid effort: ${requested}`);
  return requested;
}

function metadataBlock(result) {
  const usage = result.usage;
  return `\n\n---\n\n**Pro Architect run**\n\n- Mode: ${result.kind}\n- Model: \`${result.model}\` with \`reasoning.mode=pro\`, effort \`${result.effort}\`\n- API requests: ${usage.requests}\n- Repository tool calls: ${result.toolCalls}\n- Input tokens: ${usage.inputTokens.toLocaleString()} (${usage.cachedInputTokens.toLocaleString()} cached)\n- Output tokens: ${usage.outputTokens.toLocaleString()} (${usage.reasoningTokens.toLocaleString()} reasoning)\n- Estimated API cost: **$${usage.estimatedCostUsd.toFixed(4)}**\n- Pricing basis date: ${result.pricingEffectiveDate}\n- Elapsed: ${(result.elapsedMs / 1000).toFixed(1)}s\n\nCost is an estimate based on configured token rates; the OpenAI billing dashboard is authoritative.`;
}

export async function runArchitect(kind, input, { signal } = {}) {
  const started = Date.now();
  const config = await loadConfig();
  const apiKey = await loadApiKey();
  const root = await resolveRepositoryRoot(input.repository_root);
  const effort = effectiveEffort(input.effort, config.reasoningEffort);
  const maxToolRounds = boundInteger(input.max_tool_rounds, config.maxToolRounds, 1, config.maxToolRounds);
  const maxOutputTokens = boundInteger(input.max_output_tokens, config.maxOutputTokens, 1_000, config.maxOutputTokens);
  const costGuardrail = Math.min(
    Number(input.max_run_cost_usd ?? config.maxRunCostUsd),
    config.maxRunCostUsd
  );
  if (!Number.isFinite(costGuardrail) || costGuardrail <= 0) throw new Error("max_run_cost_usd must be positive");

  const inspector = new RepositoryInspector(root, config, signal);
  const prompt = promptFor(kind, input);
  const usage = emptyUsage();
  const requestIds = [];
  let inputItems = [{ role: "user", content: [{ type: "input_text", text: prompt.input }] }];
  let finalText = "";
  let status = "failed";
  let failure;

  try {
    for (let round = 0; round <= maxToolRounds; round += 1) {
      const { payload, requestId } = await createResponse(
        apiKey,
        {
          model: config.model,
          instructions: prompt.instructions,
          input: inputItems,
          tools: REPOSITORY_TOOL_DEFINITIONS,
          tool_choice: "auto",
          reasoning: { mode: "pro", effort, context: "all_turns" },
          text: { verbosity: "high" },
          max_output_tokens: maxOutputTokens,
          include: ["reasoning.encrypted_content"],
          store: false
        },
        { signal, timeoutMs: config.requestTimeoutMs }
      );

      if (requestId) requestIds.push(requestId);
      addRequestUsage(usage, payload.usage, config.pricing);
      const calls = functionCalls(payload.output);

      if (calls.length === 0) {
        finalText = extractOutputText(payload.output);
        if (!finalText) throw new Error("Pro Architect returned no final text");
        status = "completed";
        break;
      }

      if (round === maxToolRounds) {
        throw new Error(`Repository tool round limit reached (${maxToolRounds}) before a final answer`);
      }
      if (usage.estimatedCostUsd > costGuardrail) {
        throw new Error(
          `Run cost guardrail reached after $${usage.estimatedCostUsd.toFixed(4)}; no additional API request was made`
        );
      }

      inputItems.push(...responseOutputToInputItems(payload.output));
      for (const call of calls) {
        let output;
        try {
          const args = parseArguments(call);
          const result = await inspector.call(call.name, args);
          output = JSON.stringify({ ok: true, result });
        } catch (error) {
          output = JSON.stringify({ ok: false, error: error.message });
        }
        inputItems.push({ type: "function_call_output", call_id: call.call_id, output });
      }
    }

    const result = {
      kind,
      repositoryRoot: root,
      model: config.model,
      effort,
      output: finalText,
      usage,
      toolCalls: inspector.audit.length,
      audit: inspector.audit,
      requestIds,
      elapsedMs: Date.now() - started,
      pricingEffectiveDate: config.pricing.effectiveDate
    };
    result.formatted = `${finalText}${metadataBlock(result)}`;
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await recordUsage({
      timestamp: new Date().toISOString(),
      status,
      mode: kind,
      model: config.model,
      reasoningMode: "pro",
      effort,
      repositoryRoot: root,
      elapsedMs: Date.now() - started,
      usage,
      toolCalls: inspector.audit.length,
      requestIds,
      error: failure?.message
    }).catch((error) => {
      process.stderr.write(`codex-pro-architect: unable to record usage: ${error.message}\n`);
    });
  }
}
