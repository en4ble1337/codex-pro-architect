#!/usr/bin/env node
import { access } from "node:fs/promises";
import { loadApiKey, loadConfig, maskedKey, saveApiKey, saveConfig, getPaths } from "./config.js";
import { installSkill, registerMcp, removeSkill } from "./install.js";
import { startMcpServer } from "./mcp.js";
import { runProcess } from "./process.js";
import { readUsageEntries, summarizeUsage } from "./usage.js";
import { packageMetadata } from "./version.js";

function help() {
  return `codex-pro-architect — metered GPT-5.6 Pro architecture tools for Codex

Usage:
  codex-pro-architect setup [--no-register]
  codex-pro-architect configure [--model MODEL] [--effort EFFORT] [--max-cost USD]
  codex-pro-architect install-skill
  codex-pro-architect register-mcp
  codex-pro-architect doctor
  codex-pro-architect status
  codex-pro-architect usage [--limit N]
  codex-pro-architect mcp
  codex-pro-architect version

Credential setup:
  read -rsp "OpenAI API key: " OPENAI_API_KEY; echo
  export OPENAI_API_KEY
  codex-pro-architect configure
  unset OPENAI_API_KEY

After setup, restart Codex and invoke:
  $pro-architect plan <objective>
`;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (index === args.length - 1) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

async function configure(args) {
  const current = await loadConfig();
  const next = {
    ...current,
    model: option(args, "--model") ?? current.model,
    reasoningEffort: option(args, "--effort") ?? current.reasoningEffort,
    maxRunCostUsd: option(args, "--max-cost")
      ? Number(option(args, "--max-cost"))
      : current.maxRunCostUsd
  };
  const saved = await saveConfig(next);
  let credentialMessage = "OPENAI_API_KEY was not exported; existing credential file was left unchanged.";
  if (process.env.OPENAI_API_KEY) {
    const file = await saveApiKey(process.env.OPENAI_API_KEY);
    credentialMessage = `Stored the API key in ${file} with user-only permissions.`;
  }
  return [
    `Saved config: ${getPaths().configFile}`,
    `Model: ${saved.model}`,
    `Reasoning: ${saved.reasoningMode}/${saved.reasoningEffort}`,
    `Max estimated run cost: $${saved.maxRunCostUsd.toFixed(2)}`,
    credentialMessage
  ].join("\n");
}

async function setup(args) {
  const messages = [await configure(args)];
  messages.push(`Installed skill: ${await installSkill()}`);
  if (!args.includes("--no-register")) {
    try {
      messages.push((await registerMcp()).message);
    } catch (error) {
      messages.push(`MCP auto-registration failed: ${error.message}`);
      messages.push("Run `codex-pro-architect register-mcp` after confirming the Codex CLI is installed.");
    }
  }
  messages.push("Restart the Codex app, then type `$pro-architect` in the prompt.");
  return messages.join("\n");
}

async function commandAvailable(command, args = ["--version"]) {
  try {
    const result = await runProcess(command, args, {
      timeoutMs: 10_000,
      maxChars: 20_000,
      allowedExitCodes: [0, 1]
    });
    return { ok: true, detail: (result.stdout || result.stderr).trim().split(/\r?\n/)[0] };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

async function doctor() {
  const checks = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node.js >=20", ok: major >= 20, detail: process.version });
  checks.push({ name: "git", ...(await commandAvailable("git")) });
  checks.push({ name: "ripgrep (optional)", ...(await commandAvailable("rg")) });
  checks.push({ name: "Codex CLI", ...(await commandAvailable("codex")) });

  const config = await loadConfig();
  checks.push({ name: "Config", ok: true, detail: `${config.model} ${config.reasoningMode}/${config.reasoningEffort}` });
  try {
    checks.push({ name: "OpenAI API key", ok: true, detail: maskedKey(await loadApiKey()) });
  } catch (error) {
    checks.push({ name: "OpenAI API key", ok: false, detail: error.message });
  }
  try {
    await access((await import("./install.js")).skillPaths().target);
    checks.push({ name: "Codex skill", ok: true, detail: "installed" });
  } catch {
    checks.push({ name: "Codex skill", ok: false, detail: "run codex-pro-architect install-skill" });
  }

  const lines = ["Pro Architect doctor", ""];
  for (const check of checks) lines.push(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
  const requiredFailure = checks.some((check) => !check.ok && check.name !== "ripgrep (optional)");
  return { text: lines.join("\n"), ok: !requiredFailure };
}

async function status() {
  const config = await loadConfig();
  const paths = getPaths();
  let key = "not configured";
  try {
    key = maskedKey(await loadApiKey());
  } catch {}
  const summary = summarizeUsage(await readUsageEntries(100));
  return [
    "Pro Architect status",
    "",
    `Model: ${config.model}`,
    `Reasoning: ${config.reasoningMode}/${config.reasoningEffort}`,
    `API key: ${key}`,
    `Config: ${paths.configFile}`,
    `Usage ledger: ${paths.usageFile}`,
    `Recent runs: ${summary.runs}`,
    `Recent estimated cost: $${summary.estimatedCostUsd.toFixed(4)}`
  ].join("\n");
}

async function usage(args) {
  const limit = Number(option(args, "--limit") ?? 20);
  const entries = await readUsageEntries(Number.isInteger(limit) && limit > 0 ? limit : 20);
  const summary = summarizeUsage(entries);
  const lines = [
    `Runs: ${summary.runs}`,
    `Estimated cost: $${summary.estimatedCostUsd.toFixed(4)}`,
    `Input tokens: ${summary.inputTokens.toLocaleString()}`,
    `Output tokens: ${summary.outputTokens.toLocaleString()}`,
    `Reasoning tokens: ${summary.reasoningTokens.toLocaleString()}`,
    ""
  ];
  for (const entry of entries) {
    lines.push(
      `${entry.timestamp}  ${entry.status.padEnd(9)}  ${entry.mode.padEnd(7)}  $${Number(entry.usage?.estimatedCostUsd ?? 0).toFixed(4)}  ${entry.repositoryRoot}`
    );
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  if (command === "mcp") return await startMcpServer();
  if (["help", "--help", "-h"].includes(command)) return process.stdout.write(help());
  if (command === "version" || command === "--version" || command === "-v") {
    const metadata = await packageMetadata();
    return process.stdout.write(`${metadata.name} ${metadata.version}\n`);
  }
  if (command === "configure") return process.stdout.write(`${await configure(args.slice(1))}\n`);
  if (command === "setup") return process.stdout.write(`${await setup(args.slice(1))}\n`);
  if (command === "install-skill") return process.stdout.write(`Installed skill: ${await installSkill()}\n`);
  if (command === "remove-skill") return process.stdout.write(`Removed skill: ${await removeSkill()}\n`);
  if (command === "register-mcp") return process.stdout.write(`${(await registerMcp()).message}\n`);
  if (command === "doctor") {
    const result = await doctor();
    process.stdout.write(`${result.text}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "status") return process.stdout.write(`${await status()}\n`);
  if (command === "usage") return process.stdout.write(`${await usage(args.slice(1))}\n`);
  throw new Error(`Unknown command: ${command}\n\n${help()}`);
}

main().catch((error) => {
  process.stderr.write(`codex-pro-architect: ${error.message}\n`);
  process.exitCode = 1;
});
