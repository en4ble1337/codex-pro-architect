import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, normalizeConfig } from "../src/config.js";

test("accepts the default configuration", () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test("rejects fractional values for integer limits", () => {
  assert.throws(() => normalizeConfig({ maxToolRounds: 1.5 }), /expected an integer/);
  assert.throws(() => normalizeConfig({ requestTimeoutMs: 30_000.5 }), /expected an integer/);
  assert.throws(
    () => normalizeConfig({ pricing: { longContextThresholdTokens: 272_000.25 } }),
    /expected an integer/
  );
});

test("restricts the alpha to GPT-5.6 Sol pricing-compatible model aliases", () => {
  assert.equal(normalizeConfig({ model: "gpt-5.6-sol" }).model, "gpt-5.6-sol");
  assert.throws(() => normalizeConfig({ model: "gpt-5.6-terra" }), /model.*gpt-5\.6/i);
  assert.throws(() => normalizeConfig({ model: "gpt-4.1" }), /model.*gpt-5\.6/i);
});
