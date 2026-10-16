import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = join(root, ".agh-home-step7");
const baseUrl = "https://api.agnes-ai.cn/v1";
const modelsUrl = `${baseUrl}/models`;

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("interactive terminal required");
  }
  process.stderr.write(prompt);
  return new Promise((resolveValue, reject) => {
    const chars = [];
    const finish = (error, value) => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolveValue(value);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === "\u0003") {
          finish(new Error("cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish(null, chars.join(""));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          chars.pop();
          continue;
        }
        chars.push(char);
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

function modelIds(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const data = Array.isArray(body.data) ? body.data : body.models;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => (item && typeof item === "object" ? item.id : undefined))
    .filter((id) => typeof id === "string");
}

async function layerA(apiKey) {
  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    });
    const contentType = response.headers.get("content-type") ?? "";
    let ids = [];
    if (/^application\/json(?:\s*;|$)/i.test(contentType)) {
      ids = modelIds(await response.json());
    }
    return { status: response.status, contentType, ids };
  } catch {
    return { status: "ERROR", contentType: "", ids: [] };
  }
}

async function layerB(apiKey) {
  try {
    const { fetchProviderModels } = await import(
      "../third_party/agnes-harness/packages/ai/src/adapters/pi/probe-models.ts"
    );
    const result = await fetchProviderModels({
      api: "openai-completions",
      baseUrl,
      credential: apiKey,
    });
    return result?.ids ? [...result.ids] : undefined;
  } catch {
    return undefined;
  }
}

async function layerC(apiKey) {
  let client;
  try {
    const { createClient, memoryJournal } = await import(
      "../third_party/agnes-harness/packages/sdk/src/index.node.ts"
    );
    const owner = JSON.parse(await readFile(join(home, "data/daemon/owner.json"), "utf8"));
    client = createClient({
      transport: { kind: "unix", path: owner.socketPath },
      auth: { kind: "local" },
      journal: memoryJournal(),
    });
    await client.initialize();
    const result = await client.config.test({
      providerId: "agnes-ai",
      baseUrl,
      apiKey,
    });
    return {
      verified: result?.verified === true,
      ids: Array.isArray(result?.models)
        ? result.models
            .map((model) => (model && typeof model.id === "string" ? model.id : undefined))
            .filter((id) => id !== undefined)
        : [],
    };
  } catch {
    return { verified: false, ids: [] };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

let apiKey = "";
try {
  apiKey = await readHidden("API Key (hidden): ");

  const a = await layerA(apiKey);
  console.log("[A global fetch]");
  console.log(`status: ${a.status}`);
  console.log(`content-type: ${a.contentType || "unavailable"}`);
  console.log(`model ids: ${JSON.stringify(a.ids)}`);

  const b = await layerB(apiKey);
  console.log("[B fetchProviderModels]");
  console.log(`result: ${b === undefined ? "undefined" : `model ids: ${JSON.stringify(b)}`}`);

  const c = await layerC(apiKey);
  console.log("[C daemon config.test]");
  console.log(`verified: ${c.verified}`);
  console.log(`model ids: ${JSON.stringify(c.ids)}`);

  const aPass = typeof a.status === "number" && a.status >= 200 && a.status < 300 && a.ids.length > 0;
  const bPass = b !== undefined && b.length > 0;
  const cPass = c.verified && c.ids.length > 0;
  const conclusion =
    aPass && bPass && cPass
      ? "WEB_UI_OR_STALE_CLIENT_STATE"
      : aPass && !bPass
        ? "FETCH_PROVIDER_MODELS_LAYER"
        : aPass && bPass && !cPass
          ? "DAEMON_CONFIG_TEST_LAYER"
          : "NETWORK_LAYER";
  console.log("[结论]");
  console.log(conclusion);
} finally {
  apiKey = "";
}
