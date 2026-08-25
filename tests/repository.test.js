import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { RepositoryInspector, resolveRepositoryRoot, safeExistingPath } from "../src/repository.js";
import { runProcess } from "../src/process.js";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pro-architect-repo-"));
  await runProcess("git", ["init", "-q", root]);
  await runProcess("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await runProcess("git", ["-C", root, "config", "user.name", "Test User"]);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "README.md"), "# Fixture\nArchitecture notes\n");
  await writeFile(path.join(root, "src", "app.js"), "export function answer() {\n  return 42;\n}\n");
  await runProcess("git", ["-C", root, "add", "."]);
  await runProcess("git", ["-C", root, "commit", "-qm", "initial"]);
  return root;
}

test("inspects a repository with read-only bounded tools", async () => {
  const fixtureRoot = await fixture();
  const root = await resolveRepositoryRoot(path.join(fixtureRoot, "src"));
  assert.equal(root, await realpath(fixtureRoot));

  const inspector = new RepositoryInspector(root, DEFAULT_CONFIG);
  const tree = await inspector.tree();
  assert.deepEqual(tree.entries, ["README.md", "src/app.js"]);

  const file = await inspector.readFile({ path: "src/app.js", start_line: 1, end_line: 2 });
  assert.match(file.content, /1: export function answer/);
  assert.match(file.content, /2:\s+return 42/);

  const search = await inspector.search({ pattern: "answer" });
  assert.equal(search.returned, 1);
  assert.match(search.matches[0], /src\/app\.js/);

  const log = await inspector.gitLog({ limit: 1 });
  assert.match(log.log, /initial/);
  assert.equal(inspector.audit.length, 4);
});

test("rejects lexical traversal and symlink escapes", async () => {
  const root = await fixture();
  await assert.rejects(() => safeExistingPath(root, "../outside"), /escapes repository root/);

  const outside = await mkdtemp(path.join(tmpdir(), "pro-architect-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await symlink(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));
  await assert.rejects(() => safeExistingPath(root, "escape.txt"), /outside repository root/);
});
