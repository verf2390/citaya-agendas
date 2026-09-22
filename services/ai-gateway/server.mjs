import { createServer } from "node:http";
import {
  buildOpenAICompatibleRequest,
  parseOpenAICompatibleResponse,
} from "./openai-compatible.mjs";

const HOST = process.env.CITAYA_AI_GATEWAY_HOST?.trim() || "127.0.0.1";
const PORT = Number(process.env.CITAYA_AI_GATEWAY_PORT || 8787);
const TOKEN = process.env.CITAYA_AI_GATEWAY_TOKEN?.trim() || "";
const UPSTREAM_URL = process.env.CITAYA_AI_GATEWAY_UPSTREAM_URL?.trim() || "";
const UPSTREAM_TOKEN =
  process.env.CITAYA_AI_GATEWAY_UPSTREAM_TOKEN?.trim() || "";
const TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.CITAYA_AI_GATEWAY_TIMEOUT_MS || 60_000), 1_000),
  120_000,
);
const MAX_BODY_BYTES = 256 * 1024;

function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function validateStartup() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("CITAYA_AI_GATEWAY_PORT inválido");
  }
  if (!UPSTREAM_URL) {
    throw new Error("Falta CITAYA_AI_GATEWAY_UPSTREAM_URL");
  }
  try {
    const url = new URL(UPSTREAM_URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new Error("CITAYA_AI_GATEWAY_UPSTREAM_URL inválido");
  }
  if (!isLoopback(HOST) && TOKEN.length < 32) {
    throw new Error(
      "El gateway expuesto fuera de loopback requiere CITAYA_AI_GATEWAY_TOKEN de al menos 32 caracteres",
    );
  }
}

function json(res, status, body) {
  const content = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(content),
    "Cache-Control": "no-store",
  });
  res.end(content);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Payload demasiado grande");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("JSON inválido");
    error.statusCode = 400;
    throw error;
  }
}

function authorized(req) {
  if (isLoopback(HOST) && !TOKEN) return true;
  const value = req.headers.authorization || "";
  return value === `Bearer ${TOKEN}`;
}

async function generate(req, res) {
  if (!authorized(req)) {
    json(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    json(res, error?.statusCode || 400, {
      ok: false,
      error: "Invalid request",
    });
    return;
  }

  let upstreamBody;
  try {
    upstreamBody = buildOpenAICompatibleRequest(payload);
  } catch {
    json(res, 400, { ok: false, error: "Invalid request" });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (UPSTREAM_TOKEN) {
      headers.set("Authorization", `Bearer ${UPSTREAM_TOKEN}`);
    }
    const upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      json(res, 502, {
        ok: false,
        error: "Local model unavailable",
      });
      return;
    }

    const raw = await upstream.json();
    const result = parseOpenAICompatibleResponse(raw, upstreamBody.messages);
    json(res, 200, result);
  } catch (error) {
    json(res, controller.signal.aborted ? 504 : 502, {
      ok: false,
      error: controller.signal.aborted
        ? "Local model timeout"
        : "Local model unavailable",
    });
  } finally {
    clearTimeout(timer);
  }
}

validateStartup();

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { ok: true, service: "citaya-ai-gateway" });
    return;
  }
  if (req.method === "POST" && req.url === "/v1/generate") {
    await generate(req, res);
    return;
  }
  json(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[citaya-ai-gateway] listening on ${HOST}:${PORT}; prompts and tool results are not logged`,
  );
});
