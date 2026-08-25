import test from "node:test";
import assert from "node:assert/strict";
import { runProcess, sanitizedChildEnvironment } from "../src/process.js";

test("removes provider credentials and generic secret variables from child processes", async () => {
  const env = sanitizedChildEnvironment({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    OPENAI_API_KEY: "sk-secret",
    GITHUB_TOKEN: "gh-secret",
    DATABASE_PASSWORD: "db-secret",
    GIT_DIR: "/tmp/hostile-git-dir",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: "/tmp/hostile",
    RIPGREP_CONFIG_PATH: "/tmp/hostile-rg-config",
    SAFE_VALUE: "visible"
  });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.DATABASE_PASSWORD, undefined);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_CONFIG_COUNT, undefined);
  assert.equal(env.GIT_CONFIG_KEY_0, undefined);
  assert.equal(env.GIT_CONFIG_VALUE_0, undefined);
  assert.equal(env.RIPGREP_CONFIG_PATH, undefined);
  assert.equal(env.SAFE_VALUE, "visible");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.match(env.GIT_CONFIG_GLOBAL, /(?:\/dev\/null|NUL)$/);
  assert.equal(env.GIT_PAGER, "cat");

  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-child-must-not-see-this";
  try {
    const { stdout } = await runProcess(process.execPath, [
      "-e",
      "process.stdout.write(JSON.stringify({key:process.env.OPENAI_API_KEY ?? null,safe:process.env.SAFE_PROCESS_TEST ?? null}))"
    ], { env: { SAFE_PROCESS_TEST: "visible" } });
    assert.deepEqual(JSON.parse(stdout), { key: null, safe: "visible" });
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
