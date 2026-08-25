import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, realpath, symlink, unlink, writeFile } from "node:fs/promises";
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
  await writeFile(path.join(root, ".gitignore"), ".env\n");
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
  assert.deepEqual(tree.entries, [".gitignore", "README.md", "src/app.js"]);

  const file = await inspector.readFile({ path: "src/app.js", start_line: 1, end_line: 2 });
  assert.match(file.content, /1: export function answer/);
  assert.match(file.content, /2:\s+return 42/);

  const search = await inspector.search({ pattern: "answer" });
  assert.equal(search.returned, 1);
  assert.match(search.matches[0].path, /src\/app\.js/);

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

test("canonicalizes an aliased repository root before enforcing containment", async () => {
  const root = await fixture();
  const aliasParent = await mkdtemp(path.join(tmpdir(), "pro-architect-alias-"));
  const alias = path.join(aliasParent, "repo");
  await symlink(root, alias, "dir");

  const inspector = new RepositoryInspector(alias, DEFAULT_CONFIG);
  const file = await inspector.readFile({ path: "src/app.js" });
  assert.match(file.content, /return 42/);

  await unlink(path.join(root, "src", "app.js"));
  const diff = await inspector.gitDiff({ scope: "head", path: "src/app.js" });
  assert.match(diff.diff, /deleted file mode/);
});


test("rejects Git metadata and ignored files", async () => {
  const root = await fixture();
  await writeFile(path.join(root, ".env"), "OPENAI_API_KEY=sk-not-real\n");
  const inspector = new RepositoryInspector(root, DEFAULT_CONFIG);

  await assert.rejects(() => inspector.readFile({ path: ".git/config" }), /Git administrative files/);
  await assert.rejects(() => inspector.readFile({ path: ".env" }), /(?:Ignored repository paths|Sensitive repository path)/);
  const search = await inspector.search({ pattern: "sk-not-real" });
  assert.equal(search.returned, 0);
});

test("can scope diffs and history to a deleted tracked file", async () => {
  const root = await fixture();
  await unlink(path.join(root, "src", "app.js"));
  const inspector = new RepositoryInspector(root, DEFAULT_CONFIG);

  const diff = await inspector.gitDiff({ scope: "head", path: "src/app.js" });
  assert.match(diff.diff, /deleted file mode/);
  assert.match(diff.diff, /return 42/);

  const shown = await inspector.gitShow({ revision: "HEAD", path: "src/app.js" });
  assert.match(shown.output, /src\/app.js/);
});

test("tracked secret paths are denied across tree, read, search, status, diff, and show while templates remain visible", async () => {
  const root = await fixture();
  await writeFile(path.join(root, ".env"), "PRIVATE_MARKER=tracked-secret-value\n");
  await writeFile(path.join(root, ".env.example"), "SAFE_TEMPLATE_MARKER=replace-me\n");
  await writeFile(path.join(root, "private.pem"), "-----BEGIN PRIVATE KEY-----\nPRIVATE_PEM_MARKER\n");
  await writeFile(path.join(root, "credentials.json"), '{"token":"CREDENTIAL_MARKER"}\n');
  await runProcess("git", ["-C", root, "add", "-f", ".env"]);
  await runProcess("git", ["-C", root, "add", ".env.example", "private.pem", "credentials.json"]);
  await runProcess("git", ["-C", root, "commit", "-qm", "add credential fixtures"]);

  const inspector = new RepositoryInspector(root, DEFAULT_CONFIG);
  const tree = await inspector.tree();
  assert.ok(tree.entries.includes(".env.example"));
  assert.ok(!tree.entries.includes(".env"));
  assert.ok(!tree.entries.includes("private.pem"));
  assert.ok(!tree.entries.includes("credentials.json"));

  await assert.rejects(() => inspector.readFile({ path: ".env" }), /Sensitive repository path/);
  await assert.rejects(() => inspector.readFile({ path: "private.pem" }), /Sensitive repository path/);
  await assert.rejects(() => inspector.readFile({ path: "credentials.json" }), /Sensitive repository path/);
  const template = await inspector.readFile({ path: ".env.example" });
  assert.match(template.content, /SAFE_TEMPLATE_MARKER/);

  assert.equal((await inspector.search({ pattern: "tracked-secret-value|PRIVATE_PEM_MARKER|CREDENTIAL_MARKER" })).returned, 0);
  assert.equal((await inspector.search({ pattern: "SAFE_TEMPLATE_MARKER" })).returned, 1);

  await writeFile(path.join(root, ".env"), "PRIVATE_MARKER=modified-secret\n");
  await writeFile(path.join(root, "private.pem"), "PRIVATE_PEM_MODIFIED\n");
  await writeFile(path.join(root, ".env.example"), "SAFE_TEMPLATE_MARKER=changed\n");

  const status = await inspector.gitStatus();
  assert.doesNotMatch(status.status, /\.env(?:\s|$)|private\.pem|credentials\.json/);
  assert.match(status.status, /\.env\.example/);

  const diff = await inspector.gitDiff({ scope: "head" });
  assert.doesNotMatch(diff.diff, /modified-secret|PRIVATE_PEM_MODIFIED|private\.pem|credentials\.json/);
  assert.match(diff.diff, /SAFE_TEMPLATE_MARKER=changed/);

  const shown = await inspector.gitShow({ revision: "HEAD" });
  assert.doesNotMatch(shown.output, /tracked-secret-value|PRIVATE_PEM_MARKER|CREDENTIAL_MARKER|private\.pem|credentials\.json/);
  assert.match(shown.output, /\.env\.example|SAFE_TEMPLATE_MARKER/);
  await assert.rejects(() => inspector.gitShow({ revision: "HEAD:.env" }), /Invalid revision/);
  await assert.rejects(
    () => inspector.gitShow({ revision: "HEAD:.env", path: "README.md" }),
    /Invalid revision/
  );
});

test("sensitive key and credential path families are rejected even when tracked", async () => {
  const root = await fixture();
  const inspector = new RepositoryInspector(root, DEFAULT_CONFIG);
  for (const relative of [
    ".npmrc",
    ".pypirc",
    ".netrc",
    "id_ed25519",
    "nested/service-account-prod.json",
    "terraform.tfstate",
    ".aws/credentials",
    ".ssh/config"
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "not-a-real-secret\n");
    await runProcess("git", ["-C", root, "add", "-f", relative]);
    await assert.rejects(() => inspector.readFile({ path: relative }), /Sensitive repository path/);
  }
});


test("rejects invalid inner repository tool arguments", async () => {
  const root = await fixture();
  const inspector = new RepositoryInspector(root, DEFAULT_CONFIG);
  await assert.rejects(() => inspector.call("repo_tree", { max_entries: "many" }), /max_entries/i);
  await assert.rejects(() => inspector.call("read_file", { path: "README.md", extra: true }), /extra|additional|unexpected/i);
  await assert.rejects(() => inspector.call("search_code", { pattern: "x", glob: "!**/.env" }), /glob/i);
  await assert.rejects(() => inspector.call("git_status", { unexpected: true }), /unexpected|additional/i);
});

test("neutralizes repository-configured Git execution hooks", async () => {
  const root = await fixture();
  const marker = path.join(root, "fsmonitor-invoked");
  const hook = path.join(root, "hostile-fsmonitor.sh");
  await writeFile(hook, `#!/bin/sh\nprintf invoked >> ${JSON.stringify(marker)}\nexit 0\n`);
  await chmod(hook, 0o755);
  await runProcess("git", ["-C", root, "config", "core.fsmonitor", hook]);

  const inspector = new RepositoryInspector(root, DEFAULT_CONFIG);
  await inspector.gitStatus();
  await assert.rejects(() => access(marker), /ENOENT/);
});

test("handles unusual filenames without bypassing sensitive-path filtering", async () => {
  const root = await fixture();
  const odd = "odd\nname.txt";
  const colon = ":notes.txt";
  const sensitive = "safe:private.pem";
  await writeFile(path.join(root, odd), "ODD_FILENAME_MARKER\n");
  await writeFile(path.join(root, colon), "COLON_FILENAME_MARKER\n");
  await writeFile(path.join(root, sensitive), "COLON_SECRET_MARKER\n");
  await runProcess("git", ["-C", root, "add", `:(literal)${odd}`, `:(literal)${colon}`, `:(literal)${sensitive}`]);
  await runProcess("git", ["-C", root, "commit", "-qm", "add unusual names"]);

  const inspector = new RepositoryInspector(root, DEFAULT_CONFIG);
  const tree = await inspector.tree();
  assert.ok(tree.entries.includes(odd));
  assert.ok(tree.entries.includes(colon));
  assert.ok(!tree.entries.includes(sensitive));
  assert.match((await inspector.readFile({ path: odd })).content, /ODD_FILENAME_MARKER/);
  assert.match((await inspector.readFile({ path: colon })).content, /COLON_FILENAME_MARKER/);
  assert.equal((await inspector.search({ pattern: "COLON_SECRET_MARKER" })).returned, 0);
  assert.equal((await inspector.search({ pattern: "ODD_FILENAME_MARKER" })).returned, 1);
});
