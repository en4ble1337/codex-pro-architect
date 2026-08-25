from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

INSTALL = r'''import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configPaths, writePrivateJson } from "./config.js";
import { ArchitectError } from "./errors.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BEGIN = "# BEGIN CODEX PRO ARCHITECT";
const END = "# END CODEX PRO ARCHITECT";

function tomlString(value) { return JSON.stringify(String(value)); }

export function managedMcpBlock({ nodePath = process.execPath, cliPath = path.join(PACKAGE_ROOT, "src", "cli.js") } = {}) {
  return `${BEGIN}\n[mcp_servers.\"pro-architect\"]\ncommand = ${tomlString(nodePath)}\nargs = [${tomlString(cliPath)}, \"serve\"]\nstartup_timeout_sec = 20\ntool_timeout_sec = 1260\n${END}`;
}

function stripManagedBlock(text) {
  const start = text.indexOf(BEGIN);
  if (start < 0) return text;
  const endMarker = text.indexOf(END, start);
  if (endMarker < 0) throw new ArchitectError("Codex config contains an unterminated Pro Architect managed block", { code: "INVALID_CODEX_CONFIG" });
  const after = endMarker + END.length;
  const prefix = text.slice(0, start).trimEnd();
  const suffix = text.slice(after).replace(/^\r?\n/, "").trimStart();
  return [prefix, suffix].filter(Boolean).join("\n\n");
}

export function patchCodexConfig(text, block = managedMcpBlock()) {
  const stripped = stripManagedBlock(text).trimEnd();
  return `${stripped}${stripped ? "\n\n" : ""}${block}\n`;
}

export function removeManagedBlock(text) {
  const stripped = stripManagedBlock(text).trimEnd();
  return stripped ? `${stripped}\n` : "";
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dst = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

export function installSkill({ home = os.homedir() } = {}) {
  const source = path.join(PACKAGE_ROOT, ".agents", "skills", "pro-architect");
  const destination = path.join(home, ".agents", "skills", "pro-architect");
  fs.rmSync(destination, { recursive: true, force: true });
  copyTree(source, destination);
  for (const file of [path.join(destination, "SKILL.md"), path.join(destination, "agents", "openai.yaml")]) {
    try { fs.chmodSync(file, 0o600); } catch {}
  }
  return destination;
}

export function registerMcp({ env = process.env, home = os.homedir() } = {}) {
  const { codexHome } = configPaths(env, home);
  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  const file = path.join(codexHome, "config.toml");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.backup-${Date.now()}`);
  fs.writeFileSync(file, patchCodexConfig(current), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return file;
}

export function uninstall({ env = process.env, home = os.homedir() } = {}) {
  fs.rmSync(path.join(home, ".agents", "skills", "pro-architect"), { recursive: true, force: true });
  const { codexHome } = configPaths(env, home);
  const file = path.join(codexHome, "config.toml");
  if (fs.existsSync(file)) fs.writeFileSync(file, removeManagedBlock(fs.readFileSync(file, "utf8")), { mode: 0o600 });
}

export function saveApiKey(apiKey, { env = process.env, home = os.homedir() } = {}) {
  if (!apiKey || !apiKey.startsWith("sk-")) throw new ArchitectError("API key format is invalid", { code: "INVALID_API_KEY" });
  const { credentialsFile } = configPaths(env, home);
  writePrivateJson(credentialsFile, { apiKey });
  return credentialsFile;
}
'''

(ROOT / "src/install.js").write_text(INSTALL, encoding="utf-8")
for relative in ["bootstrap/fixup_install.py", ".github/workflows/fixup-install.yml"]:
    target = ROOT / relative
    if target.exists():
        target.unlink()
bootstrap = ROOT / "bootstrap"
if bootstrap.exists() and not any(bootstrap.iterdir()):
    bootstrap.rmdir()
