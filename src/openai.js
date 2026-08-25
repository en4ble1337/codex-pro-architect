function combineSignals(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function apiBase() {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

function requestHeaders(apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "codex-pro-architect/0.1.0"
  };
  if (process.env.OPENAI_ORGANIZATION) headers["OpenAI-Organization"] = process.env.OPENAI_ORGANIZATION;
  if (process.env.OPENAI_PROJECT) headers["OpenAI-Project"] = process.env.OPENAI_PROJECT;
  return headers;
}

export async function createResponse(apiKey, body, { signal, timeoutMs }) {
  let response;
  try {
    response = await fetch(`${apiBase()}/responses`, {
      method: "POST",
      headers: requestHeaders(apiKey),
      body: JSON.stringify(body),
      signal: combineSignals(signal, timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError") throw new Error(`OpenAI request timed out after ${timeoutMs} ms`);
    if (error?.name === "AbortError") throw new Error("OpenAI request was cancelled");
    throw new Error(`OpenAI request failed: ${error.message}`);
  }

  const requestId = response.headers.get("x-request-id") ?? undefined;
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`OpenAI returned non-JSON HTTP ${response.status}${requestId ? ` (${requestId})` : ""}`);
  }

  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`;
    const code = payload?.error?.code ? ` [${payload.error.code}]` : "";
    throw new Error(`OpenAI API error${code}${requestId ? ` (${requestId})` : ""}: ${message}`);
  }

  if (!Array.isArray(payload.output)) throw new Error("OpenAI response did not contain an output array");
  return { payload, requestId };
}

export function functionCalls(output) {
  return output.filter((item) => item?.type === "function_call");
}

export function extractOutputText(output) {
  const parts = [];
  for (const item of output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
      if (content?.type === "refusal" && typeof content.refusal === "string") parts.push(`Refusal: ${content.refusal}`);
    }
  }
  return parts.join("\n").trim();
}
