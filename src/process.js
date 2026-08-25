import { spawn } from "node:child_process";

function describe(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

const SECRET_ENV_EXACT = new Set([
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_CLIENT_SECRET",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SSH_AUTH_SOCK",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "RIPGREP_CONFIG_PATH",
  "PAGER",
  "GIT_PAGER",
  "GIT_EXTERNAL_DIFF",
  "LESS"
]);
const SECRET_ENV_SUFFIX = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|CREDENTIALS?)$/i;
const UNSAFE_CHILD_ENV_PREFIXES = ["GIT_CONFIG_", "GIT_TRACE", "GIT_SSH", "GIT_OBJECT_", "GIT_ALTERNATE_"];
const UNSAFE_GIT_ENV_EXACT = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GIT_REPLACE_REF_BASE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_ATTR_NOSYSTEM"
]);

function nullDevice() {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

export function sanitizedChildEnvironment(base = process.env, overrides = {}) {
  const environment = { ...base, ...overrides };
  for (const key of Object.keys(environment)) {
    if (
      SECRET_ENV_EXACT.has(key) ||
      SECRET_ENV_SUFFIX.test(key) ||
      UNSAFE_GIT_ENV_EXACT.has(key) ||
      UNSAFE_CHILD_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      delete environment[key];
    }
  }

  // Repository inspection must not inherit Git/Ripgrep configuration that can
  // redirect the repository, execute helpers, or load a user-controlled preprocessor.
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = nullDevice();
  environment.GIT_PAGER = "cat";
  environment.PAGER = "cat";
  environment.GIT_EXTERNAL_DIFF = "";
  environment.LC_ALL = "C";
  return environment;
}

export async function runProcess(command, args, options = {}) {
  const {
    cwd,
    timeoutMs = 15_000,
    maxChars = 200_000,
    allowedExitCodes = [0],
    signal,
    env = {},
    input
  } = options;

  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new Error("runProcess args must be an array of strings");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("timeoutMs must be a positive integer");
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("maxChars must be a positive integer");
  if (input !== undefined && typeof input !== "string" && !Buffer.isBuffer(input)) {
    throw new Error("input must be a string or Buffer when provided");
  }
  if (signal?.aborted) throw new Error(`Command aborted before start: ${describe(command, args)}`);

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: sanitizedChildEnvironment(process.env, env)
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let outputExceeded = false;
    let killTimer;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };

    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 1_000);
      killTimer.unref();
    };

    const onAbort = () => {
      terminate();
      finish(reject, new Error(`Command aborted: ${describe(command, args)}`));
    };

    const timer = setTimeout(() => {
      terminate();
      finish(reject, new Error(`Command timed out after ${timeoutMs} ms: ${describe(command, args)}`));
    }, timeoutMs);
    timer.unref();

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length + stderr.length > maxChars) {
        outputExceeded = true;
        terminate();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stdout.length + stderr.length > maxChars) {
        outputExceeded = true;
        terminate();
      }
    });

    if (input !== undefined) {
      child.stdin.on("error", (error) => {
        if (error?.code !== "EPIPE") finish(reject, new Error(`Unable to write to ${command}: ${error.message}`));
      });
      child.stdin.end(input);
    }

    child.on("error", (error) => {
      finish(reject, new Error(`Unable to start ${command}: ${error.message}`));
    });

    child.on("close", (code, closeSignal) => {
      if (outputExceeded) {
        return finish(reject, new Error(`Command output exceeded ${maxChars} characters: ${describe(command, args)}`));
      }
      if (!allowedExitCodes.includes(code)) {
        const detail = stderr.trim() || stdout.trim() || `signal ${closeSignal ?? "unknown"}`;
        return finish(reject, new Error(`Command failed (${code}): ${describe(command, args)}\n${detail}`));
      }
      finish(resolve, { stdout, stderr, code });
    });
  });
}
