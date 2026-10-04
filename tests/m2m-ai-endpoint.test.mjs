import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "11111111-1111-4111-8111-111111111111";
const state = {};

globalThis.__citayaN8NEndpoint = {
  async requireM2M() {
    state.events.push("auth");
    return state.access;
  },
  async loadAITenantPolicy() {
    state.events.push("policy");
    return state.policy;
  },
  async consumeRateLimit(input) {
    state.events.push("rate");
    state.rateInput = input;
    return state.rateAllowed;
  },
  async runN8NAI(input) {
    state.events.push("run");
    state.runInput = input;
    return {
      text: state.resultText,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      route: {
        requestedProvider: "local",
        requestedModel: "local-test",
        effectiveProvider: "local",
        effectiveModel: "local-test",
        fallbackUsed: false,
        providerDurationMs: 5,
      },
    };
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mocks = {
      "next/server": "next",
      "@/lib/api/requireM2M": "auth",
      "@/lib/ai/server/n8n-ai": "service",
      "@/lib/ai/server/tenant-policy": "policy",
      "@/lib/security/request": "rate",
    };
    if (mocks[specifier]) {
      return { url: "citaya-n8n-endpoint:" + mocks[specifier], shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return {
        url: pathToFileURL(resolve(specifier.slice(2) + ".ts")).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const sources = {
      "citaya-n8n-endpoint:next": "export const NextResponse = Response;",
      "citaya-n8n-endpoint:auth":
        "export const requireM2M = globalThis.__citayaN8NEndpoint.requireM2M;",
      "citaya-n8n-endpoint:service":
        "export const runN8NAI = globalThis.__citayaN8NEndpoint.runN8NAI;",
      "citaya-n8n-endpoint:policy":
        "export const loadAITenantPolicy = globalThis.__citayaN8NEndpoint.loadAITenantPolicy;",
      "citaya-n8n-endpoint:rate":
        "export const consumeRateLimit = globalThis.__citayaN8NEndpoint.consumeRateLimit;",
    };
    if (sources[url]) {
      return { format: "module", source: sources[url], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { POST } = await import(
  pathToFileURL(resolve("app/api/integrations/ai/route.ts")).href
);

test.beforeEach((t) => {
  t.mock.method(console, "error", () => {});
  Object.assign(state, {
    events: [],
    access: {
      ok: true,
      tenantId: A,
      tenantSlug: "tenant-a",
      serviceId: "n8n",
      authMode: "m2m",
      operationalMode: "live",
    },
    policy: {
      enabled: true,
      provider: "local",
      model: "local-test",
      promptVersion: "citaya-app-assistant-v1",
      requestsPerMinute: 10,
      dailyTokenLimit: 50000,
      maxOutputTokens: 800,
      timeoutMs: 20000,
    },
    rateAllowed: true,
    resultText: "Resultado",
    rateInput: null,
    runInput: null,
  });
});

async function call(body) {
  const req = new Request("https://app.citaya.online/api/integrations/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === null ? "not-json" : JSON.stringify(body),
  });
  const original = req.json.bind(req);
  req.json = () => {
    state.events.push("json");
    return original();
  };
  const response = await POST(req);
  return { response, body: await response.json() };
}

test("M2M auth runs before JSON parsing and blocks all downstream work", async () => {
  state.access = { ok: false, error: "Unauthorized", status: 401 };
  const result = await call({ workflowId: "x", operation: "summarize", input: "secret" });
  assert.equal(result.response.status, 401);
  assert.deepEqual(state.events, ["auth"]);
});

test("endpoint binds AI work to authenticated tenant and ignores body tenant spoofing", async () => {
  const result = await call({
    tenantId: "22222222-2222-4222-8222-222222222222",
    workflowId: "daily-summary",
    operation: "summarize",
    input: "Texto",
  });
  assert.equal(result.response.status, 200);
  assert.equal(state.runInput.tenantId, A);
  assert.equal(state.runInput.tenantSlug, "tenant-a");
  assert.equal(state.runInput.serviceId, "n8n");
  assert.equal(state.runInput.workflowId, "daily-summary");
  assert.deepEqual(state.events, ["auth", "json", "policy", "rate", "run"]);
  assert.deepEqual(state.rateInput, {
    scope: "ai_n8n_minute",
    key: A + ":n8n",
    limit: 10,
    windowSeconds: 60,
  });
  assert.equal(result.response.headers.get("cache-control"), "no-store, no-cache, must-revalidate, proxy-revalidate");
});

test("classification validates labels before policy/provider work", async () => {
  const result = await call({
    workflowId: "lead-triage",
    operation: "classify",
    input: "Texto",
    labels: ["SoloUna"],
  });
  assert.equal(result.response.status, 400);
  assert.deepEqual(state.events, ["auth", "json"]);
});

test("classification forwards only validated labels and instruction", async () => {
  state.resultText = "Urgente";
  const result = await call({
    workflowId: "lead-triage",
    operation: "classify",
    input: "Necesito respuesta hoy",
    instruction: "Prioriza intención de compra",
    labels: ["Urgente", "Normal"],
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(state.runInput.labels, ["Urgente", "Normal"]);
  assert.equal(state.runInput.instruction, "Prioriza intención de compra");
  assert.equal(result.body.route.effectiveProvider, "local");
  assert.equal("providerDurationMs" in result.body.route, false);
});

test("rate limit blocks provider invocation", async () => {
  state.rateAllowed = false;
  const result = await call({
    workflowId: "daily-summary",
    operation: "summarize",
    input: "Texto",
  });
  assert.equal(result.response.status, 429);
  assert.equal(state.runInput, null);
  assert.deepEqual(state.events, ["auth", "json", "policy", "rate"]);
});

test("labels are rejected outside classify", async () => {
  const result = await call({
    workflowId: "draft-reply",
    operation: "draft",
    input: "Texto",
    labels: ["A", "B"],
  });
  assert.equal(result.response.status, 400);
  assert.deepEqual(state.events, ["auth", "json"]);
});
