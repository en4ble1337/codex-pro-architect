import { spawn } from "node:child_process";

function describe(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

export async function runProcess(command, args, options = {}) {
  const {
    cwd,
    timeoutMs = 15_000,
    maxChars = 200_000,
    allowedExitCodes = [0],
    signal
  } = options;

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" }
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let outputExceeded = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };

    const terminate = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
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

    if (signal?.aborted) return onAbort();
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
