import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function packageMetadata() {
  const parsed = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  return { name: parsed.name, version: parsed.version, description: parsed.description };
}
