import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const APP_NAME = "codex-pro-architect";

export const DEFAULT_CONFIG = Object.freeze({
  model: "gpt-5.6",
  reasoningMode: "pro",
  reasoningEffort: "medium",
  maxToolRounds: 24,
  maxOutputTokens: 32_000,
  requestTimeoutMs: 20 * 60 * 1000,
  maxRunCostUsd: 10,
  maxFileBytes: 256 * 1024,
  maxReadLines: 600,
  maxSearchResults: 100,
  maxTreeEntries: 5_000,
  maxToolOutputChars: 120_000,
  pricing: {
    effectiveDate: "2026-08-24",
    inputPerMillion: 4,
    cachedInputPerMillion: 0.4,
    outputPerMillion: 20,
    cacheWriteInputMultiplier: 1.25,
    longContextThresholdTokens: 272_000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5
  }
});

function xdgPath(envName, fallbackParts) {
  const configured = process.env[envName];
  if (configured) return path.join(configured, APP_NAME);
  return path.join(homedir(), ...fallbackParts, APP_NAME);
}

export function getPaths() {
  const configDir = xdgPath("XDG_CONFIG_HOME", [".config"]);
  const stateDir = xdgPath("XDG_STATE_HOME", [".local", "state"]);
  return {
    configDir,
    stateDir,
    configFile: path.join(configDir, "config.json"),
    credentialsFile: path.join(configDir, "credentials.json"),
    usageFile: path.join(stateDir, "usage.jsonl")
  };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Unable to read ${file}: ${error.message}`);
  }
}

function number(value, fallback, name, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    const type = integer ? "an integer" : "a number";
    throw new Error(`Invalid config value for ${name}: expected ${type} from ${min} to ${max}`);
  }
  return value;
}

function oneOf(value, fallback, name, choices) {
  if (value === undefined || value === null) return fallback;
  if (!choices.includes(value)) {
    throw new Error(`Invalid config value for ${name}: expected one of ${choices.join(", ")}`);
  }
  return value;
}

export function normalizeConfig(input = {}) {
  const pricing = { ...DEFAULT_CONFIG.pricing, ...(input.pricing ?? {}) };
  return {
    model: oneOf(input.model, DEFAULT_CONFIG.model, "model", ["gpt-5.6", "gpt-5.6-sol"]),
    reasoningMode: oneOf(input.reasoningMode, DEFAULT_CONFIG.reasoningMode, "reasoningMode", ["pro"]),
    reasoningEffort: oneOf(
      input.reasoningEffort,
      DEFAULT_CONFIG.reasoningEffort,
      "reasoningEffort",
      ["low", "medium", "high", "xhigh", "max"]
    ),
    maxToolRounds: number(input.maxToolRounds, DEFAULT_CONFIG.maxToolRounds, "maxToolRounds", { min: 1, max: 100, integer: true }),
    maxOutputTokens: number(input.maxOutputTokens, DEFAULT_CONFIG.maxOutputTokens, "maxOutputTokens", { min: 1_000, max: 128_000, integer: true }),
    requestTimeoutMs: number(input.requestTimeoutMs, DEFAULT_CONFIG.requestTimeoutMs, "requestTimeoutMs", { min: 30_000, max: 60 * 60 * 1000, integer: true }),
    maxRunCostUsd: number(input.maxRunCostUsd, DEFAULT_CONFIG.maxRunCostUsd, "maxRunCostUsd", { min: 0.01, max: 10_000 }),
    maxFileBytes: number(input.maxFileBytes, DEFAULT_CONFIG.maxFileBytes, "maxFileBytes", { min: 1_024, max: 10 * 1024 * 1024, integer: true }),
    maxReadLines: number(input.maxReadLines, DEFAULT_CONFIG.maxReadLines, "maxReadLines", { min: 10, max: 10_000, integer: true }),
    maxSearchResults: number(input.maxSearchResults, DEFAULT_CONFIG.maxSearchResults, "maxSearchResults", { min: 1, max: 5_000, integer: true }),
    maxTreeEntries: number(input.maxTreeEntries, DEFAULT_CONFIG.maxTreeEntries, "maxTreeEntries", { min: 10, max: 100_000, integer: true }),
    maxToolOutputChars: number(input.maxToolOutputChars, DEFAULT_CONFIG.maxToolOutputChars, "maxToolOutputChars", { min: 1_000, max: 2_000_000, integer: true }),
    pricing: {
      effectiveDate: typeof pricing.effectiveDate === "string" ? pricing.effectiveDate : DEFAULT_CONFIG.pricing.effectiveDate,
      inputPerMillion: number(pricing.inputPerMillion, DEFAULT_CONFIG.pricing.inputPerMillion, "pricing.inputPerMillion"),
      cachedInputPerMillion: number(pricing.cachedInputPerMillion, DEFAULT_CONFIG.pricing.cachedInputPerMillion, "pricing.cachedInputPerMillion"),
      outputPerMillion: number(pricing.outputPerMillion, DEFAULT_CONFIG.pricing.outputPerMillion, "pricing.outputPerMillion"),
      cacheWriteInputMultiplier: number(
        pricing.cacheWriteInputMultiplier,
        DEFAULT_CONFIG.pricing.cacheWriteInputMultiplier,
        "pricing.cacheWriteInputMultiplier",
        { min: 1 }
      ),
      longContextThresholdTokens: number(
        pricing.longContextThresholdTokens,
        DEFAULT_CONFIG.pricing.longContextThresholdTokens,
        "pricing.longContextThresholdTokens",
        { integer: true }
      ),
      longContextInputMultiplier: number(
        pricing.longContextInputMultiplier,
        DEFAULT_CONFIG.pricing.longContextInputMultiplier,
        "pricing.longContextInputMultiplier",
        { min: 1 }
      ),
      longContextOutputMultiplier: number(
        pricing.longContextOutputMultiplier,
        DEFAULT_CONFIG.pricing.longContextOutputMultiplier,
        "pricing.longContextOutputMultiplier",
        { min: 1 }
      )
    }
  };
}

export async function loadConfig() {
  const { configFile } = getPaths();
  return normalizeConfig((await readJson(configFile)) ?? {});
}

export async function saveConfig(config) {
  const paths = getPaths();
  await mkdir(paths.configDir, { recursive: true, mode: 0o700 });
  await chmod(paths.configDir, 0o700).catch(() => {});
  const normalized = normalizeConfig(config);
  await writeFile(paths.configFile, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  await chmod(paths.configFile, 0o600).catch(() => {});
  return normalized;
}

export async function saveApiKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey.startsWith("sk-") || apiKey.length < 20) {
    throw new Error("OPENAI_API_KEY does not look like a valid OpenAI API key");
  }
  const paths = getPaths();
  await mkdir(paths.configDir, { recursive: true, mode: 0o700 });
  await chmod(paths.configDir, 0o700).catch(() => {});
  await writeFile(paths.credentialsFile, `${JSON.stringify({ apiKey }, null, 2)}\n`, { mode: 0o600 });
  await chmod(paths.credentialsFile, 0o600).catch(() => {});
  return paths.credentialsFile;
}

export async function loadApiKey() {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim();
  const { credentialsFile } = getPaths();
  const credentials = await readJson(credentialsFile);
  const apiKey = credentials?.apiKey;
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();
  throw new Error(
    "No OpenAI API key found. Export OPENAI_API_KEY or run `codex-pro-architect configure` after exporting it."
  );
}

export function maskedKey(apiKey) {
  if (!apiKey) return "not configured";
  if (apiKey.length < 12) return "configured";
  return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}
