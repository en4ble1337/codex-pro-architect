import test from "node:test";
import assert from "node:assert/strict";
import { addRequestUsage, emptyUsage, estimateRequestCost } from "../src/usage.js";
import { DEFAULT_CONFIG } from "../src/config.js";

test("estimates cached, cache-write, uncached, and output token cost", () => {
  const result = estimateRequestCost(
    {
      input_tokens: 1_000_000,
      input_tokens_details: { cached_tokens: 200_000, cache_write_tokens: 100_000 },
      output_tokens: 100_000,
      output_tokens_details: { reasoning_tokens: 60_000 },
      total_tokens: 1_100_000
    },
    DEFAULT_CONFIG.pricing
  );
  assert.equal(result.longContext, true);
  // Long-context multipliers apply because the request exceeds 272K input tokens.
  assert.ok(Math.abs(result.estimatedCostUsd - 9.76) < 1e-12);
  assert.equal(result.reasoningTokens, 60_000);
});

test("uses standard rates below the long-context threshold", () => {
  const result = estimateRequestCost(
    { input_tokens: 200_000, input_tokens_details: { cached_tokens: 50_000 }, output_tokens: 10_000 },
    DEFAULT_CONFIG.pricing
  );
  assert.equal(result.longContext, false);
  assert.ok(Math.abs(result.estimatedCostUsd - 0.82) < 1e-12);
});

test("accumulates request usage across a tool loop", () => {
  const total = emptyUsage();
  addRequestUsage(total, { input_tokens: 10_000, output_tokens: 1_000 }, DEFAULT_CONFIG.pricing);
  addRequestUsage(total, { input_tokens: 20_000, output_tokens: 2_000 }, DEFAULT_CONFIG.pricing);
  assert.equal(total.requests, 2);
  assert.equal(total.inputTokens, 30_000);
  assert.equal(total.outputTokens, 3_000);
  assert.equal(total.estimatedCostUsd, 0.18);
});
