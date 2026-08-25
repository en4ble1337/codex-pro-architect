import { appendFile, mkdir, readFile } from "node:fs/promises";
import { getPaths } from "./config.js";

export function emptyUsage() {
  return {
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0
  };
}

export function normalizeApiUsage(usage = {}) {
  const inputDetails = usage.input_tokens_details ?? {};
  const outputDetails = usage.output_tokens_details ?? {};
  const inputTokens = Number(usage.input_tokens ?? 0);
  const cachedInputTokens = Number(inputDetails.cached_tokens ?? 0);
  const cacheWriteTokens = Number(inputDetails.cache_write_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens: Number(outputDetails.reasoning_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? inputTokens + outputTokens)
  };
}

export function estimateRequestCost(usage, pricing) {
  const normalized = normalizeApiUsage(usage);
  const longContext = normalized.inputTokens > pricing.longContextThresholdTokens;
  const inputMultiplier = longContext ? pricing.longContextInputMultiplier : 1;
  const outputMultiplier = longContext ? pricing.longContextOutputMultiplier : 1;
  const cached = Math.min(normalized.cachedInputTokens, normalized.inputTokens);
  const cacheWrite = Math.min(normalized.cacheWriteTokens, Math.max(0, normalized.inputTokens - cached));
  const uncached = Math.max(0, normalized.inputTokens - cached - cacheWrite);
  const million = 1_000_000;
  const inputCost = (uncached / million) * pricing.inputPerMillion * inputMultiplier;
  const cachedCost = (cached / million) * pricing.cachedInputPerMillion * inputMultiplier;
  const cacheWriteCost =
    (cacheWrite / million) * pricing.inputPerMillion * pricing.cacheWriteInputMultiplier * inputMultiplier;
  const outputCost = (normalized.outputTokens / million) * pricing.outputPerMillion * outputMultiplier;
  return {
    ...normalized,
    longContext,
    inputCostUsd: inputCost,
    cachedInputCostUsd: cachedCost,
    cacheWriteCostUsd: cacheWriteCost,
    outputCostUsd: outputCost,
    estimatedCostUsd: inputCost + cachedCost + cacheWriteCost + outputCost
  };
}

export function addRequestUsage(total, requestUsage, pricing) {
  const costed = estimateRequestCost(requestUsage, pricing);
  total.requests += 1;
  total.inputTokens += costed.inputTokens;
  total.cachedInputTokens += costed.cachedInputTokens;
  total.cacheWriteTokens += costed.cacheWriteTokens;
  total.outputTokens += costed.outputTokens;
  total.reasoningTokens += costed.reasoningTokens;
  total.totalTokens += costed.totalTokens;
  total.estimatedCostUsd += costed.estimatedCostUsd;
  return costed;
}

export async function recordUsage(entry) {
  const { stateDir, usageFile } = getPaths();
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await appendFile(usageFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return usageFile;
}

export async function readUsageEntries(limit = 100) {
  const { usageFile } = getPaths();
  try {
    const lines = (await readFile(usageFile, "utf8")).split(/\r?\n/).filter(Boolean);
    return lines.slice(-Math.max(1, limit)).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function summarizeUsage(entries) {
  return entries.reduce(
    (summary, entry) => {
      summary.runs += 1;
      summary.estimatedCostUsd += Number(entry?.usage?.estimatedCostUsd ?? 0);
      summary.inputTokens += Number(entry?.usage?.inputTokens ?? 0);
      summary.outputTokens += Number(entry?.usage?.outputTokens ?? 0);
      summary.reasoningTokens += Number(entry?.usage?.reasoningTokens ?? 0);
      return summary;
    },
    { runs: 0, estimatedCostUsd: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 }
  );
}
