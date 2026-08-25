import { access, chmod, copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { runProcess } from "./process.js";
import { packageRoot } from "./version.js";

export function skillPaths() {
  const sourceDir = path.join(packageRoot, ".agents", "skills", "pro-architect");
  const targetDir = path.join(homedir(), ".agents", "skills", "pro-architect");
  return {
    sourceDir,
    source: path.join(sourceDir, "SKILL.md"),
    targetDir,
    target: path.join(targetDir, "SKILL.md"),
    metadata: path.join(targetDir, "agents", "openai.yaml")
  };
}

export async function installSkill() {
  const paths = skillPaths();
  await access(paths.source);
  await rm(paths.targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(paths.targetDir), { recursive: true, mode: 0o700 });
  await cp(paths.sourceDir, paths.targetDir, { recursive: true, force: true });
  await chmod(paths.target, 0o600).catch(() => {});
  await chmod(paths.metadata, 0o600).catch(() => {});
  return paths.target;
}

export async function removeSkill() {
  const { targetDir } = skillPaths();
  await rm(targetDir, { recursive: true, force: true });
  return targetDir;
}

export function codexConfigPath() {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex");
  return path.join(codexHome, "config.toml");
}

function mcpSectionBounds(text, serverName) {
  const headers = [...text.matchAll(/^\s*\[([^\]]+)\]\s*$/gm)];
  const accepted = new Set([`mcp_servers.${serverName}`, `mcp_servers."${serverName}"`]);
  const index = headers.findIndex((match) => accepted.has(match[1].trim()));
  if (index < 0) throw new Error(`Could not find [mcp_servers.${serverName}] in Codex config`);
  const header = headers[index];
  return {
    sectionStart: header.index + header[0].length,
    sectionEnd: index + 1 < headers.length ? headers[index + 1].index : text.length
  };
}

export function mcpSectionSettings(text, serverName) {
  const { sectionStart, sectionEnd } = mcpSectionBounds(text, serverName);
  const section = text.slice(sectionStart, sectionEnd);
  const values = {};
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (/^"(?:[^"\\]|\\.)*"$/.test(raw)) {
      try { values[key] = JSON.parse(raw); } catch { values[key] = raw; }
    } else if (raw === "true" || raw === "false") values[key] = raw === "true";
    else if (/^-?\d+(?:\.\d+)?$/.test(raw)) values[key] = Number(raw);
    else values[key] = raw;
  }
  return values;
}

export function patchMcpSection(text, serverName, settings) {
  const { sectionStart, sectionEnd } = mcpSectionBounds(text, serverName);
  let section = text.slice(sectionStart, sectionEnd);

  for (const [key, value] of Object.entries(settings)) {
    const rendered = typeof value === "string" ? JSON.stringify(value) : String(value);
    const pattern = new RegExp(`^([ \t]*)${key}\\s*=.*$`, "m");
    if (pattern.test(section)) section = section.replace(pattern, `$1${key} = ${rendered}`);
    else section = `${section.replace(/\s*$/, "")}\n${key} = ${rendered}\n`;
  }

  return `${text.slice(0, sectionStart)}${section}${text.slice(sectionEnd)}`;
}

export async function configureCodexMcpSection() {
  const config = await loadConfig();
  const file = codexConfigPath();
  const original = await readFile(file, "utf8");
  const toolTimeoutSec = Math.ceil(config.requestTimeoutMs / 1000) + 60;
  const updated = patchMcpSection(original, "pro-architect", {
    startup_timeout_sec: 20,
    tool_timeout_sec: toolTimeoutSec,
    required: false,
    default_tools_approval_mode: "prompt"
  });
  if (updated === original) return { changed: false, file, toolTimeoutSec };

  const fileStat = await stat(file);
  const backup = `${file}.pro-architect.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const temporary = `${file}.pro-architect.tmp.${process.pid}`;
  await copyFile(file, backup);
  await chmod(backup, fileStat.mode & 0o777).catch(() => {});
  try {
    await writeFile(temporary, updated, { mode: fileStat.mode & 0o777 });
    await chmod(temporary, fileStat.mode & 0o777).catch(() => {});
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return { changed: true, file, backup, toolTimeoutSec };
}

export async function registerMcp() {
  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  await runProcess("codex", ["--version"], { timeoutMs: 10_000, maxChars: 20_000 });
  const listed = await runProcess("codex", ["mcp", "list"], {
    timeoutMs: 15_000,
    maxChars: 100_000,
    allowedExitCodes: [0, 1]
  });

  const messages = [];
  let changed = false;
  if (/\bpro-architect\b/.test(`${listed.stdout}\n${listed.stderr}`)) {
    messages.push("MCP server pro-architect is already registered");
  } else {
    await runProcess("codex", ["mcp", "add", "pro-architect", "--", process.execPath, cliPath, "mcp"], {
      timeoutMs: 30_000,
      maxChars: 100_000
    });
    messages.push("Registered pro-architect in Codex MCP configuration");
    changed = true;
  }

  const patched = await configureCodexMcpSection();
  messages.push(`Set Codex MCP tool timeout to ${patched.toolTimeoutSec} seconds`);
  if (patched.backup) messages.push(`Backed up Codex config to ${patched.backup}`);
  return { changed: changed || patched.changed, message: messages.join("\n"), ...patched };
}
