import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const state = {};

class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

globalThis.__citayaAIIsolation = {
  AIError,
  safeAIErrorCode(error) {
    return error?.code ?? "AI_PROVIDER_UNAVAILABLE";
  },
  async requireHostTenantAdmin() {
    state.events.push("auth");
    return state.access;
  },
  async loadAITenantPolicy(tenantId) {
    state.events.push(["policy", tenantId]);
    return state.policy;
  },
  async consumeRateLimit(input) {
    state.events.push(["rate", input]);
    return state.rateAllowed;
  },
  async runCitayaAppAssistant(input) {
    state.events.push(["assistant", input]);
    return {
      text: "Respuesta tenant A",
      toolsUsed: ["count_appointments"],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = {
      "next/server": "next",
      "@/lib/ai/errors": "errors",
      "@/lib/ai/server/citaya-app-assistant": "assistant",
      "@/lib/ai/server/tenant-policy": "policy",
      "@/lib/api/requireTenantAdmin": "auth",
      "@/lib/security/request": "rate",
    };
    if (map[specifier]) {
      return { url: `citaya-ai-isolation:${map[specifier]}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const sources = {
      "citaya-ai-isolation:next": "export const NextResponse = Response;",
      "citaya-ai-isolation:errors": `
        export const AIError = globalThis.__citayaAIIsolation.AIError;
        export const safeAIErrorCode = globalThis.__citayaAIIsolation.safeAIErrorCode;
      `,
      "citaya-ai-isolation:assistant":
        "export const runCitayaAppAssistant = globalThis.__citayaAIIsolation.runCitayaAppAssistant;",
      "citaya-ai-isolation:policy":
        "export const loadAITenantPolicy = globalThis.__citayaAIIsolation.loadAITenantPolicy;",
      "citaya-ai-isolation:auth":
        "export const requireHostTenantAdmin = globalThis.__citayaAIIsolation.requireHostTenantAdmin;",
      "citaya-ai-isolation:rate":
        "export const consumeRateLimit = globalThis.__citayaAIIsolation.consumeRateLimit;",
    };
    if (sources[url]) {
      return { format: "module", source: sources[url], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { POST } = await import(
  pathToFileURL(resolve("app/api/admin/ai/assistant/route.ts")).href
);

test.beforeEach((t) => {
  t.mock.method(console, "error", () => {});
  Object.assign(state, {
    access: {
      ok: true,
      tenantId: A,
      tenantSlug: "tenant-a",
      userId: USER,
      authMode: "tenant_members",
    },
    policy: {
      enabled: true,
      provider: "openai",
      model: "test-model",
      requestsPerMinute: 10,
      dailyTokenLimit: 50000,
      maxOutputTokens: 800,
      timeoutMs: 20000,
    },
    rateAllowed: true,
    events: [],
  });
});

function request() {
  const req = new Request("https://tenant-a.citaya.online/api/admin/ai/assistant", {
    method: "POST",
    body: JSON.stringify({
      message: "¿Cuántas reservas tengo mañana?",
      tenantId: B,
      tenantSlug: "tenant-b",
    }),
  });
  const originalJson = req.json.bind(req);
  req.json = () => {
    state.events.push("json");
    return originalJson();
  };
  return req;
}

for (const status of [401, 403, 500]) {
  test(`auth ${status} ocurre antes de parsear JSON o acceder a IA`, async () => {
    state.access = { ok: false, status, error: "secret" };
    const response = await POST(request());
    assert.equal(response.status, status);
    assert.deepEqual(state.events, ["auth"]);
  });
}

test("ignora tenant inyectado y usa exclusivamente el tenant autenticado", async () => {
  const response = await POST(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "Respuesta tenant A");

  const policyEvent = state.events.find((event) => Array.isArray(event) && event[0] === "policy");
  const rateEvent = state.events.find((event) => Array.isArray(event) && event[0] === "rate");
  const assistantEvent = state.events.find(
    (event) => Array.isArray(event) && event[0] === "assistant",
  );
  assert.equal(policyEvent[1], A);
  assert.equal(rateEvent[1].key, `${A}:${USER}`);
  assert.equal(assistantEvent[1].tenantId, A);
  assert.equal(assistantEvent[1].tenantSlug, "tenant-a");
  assert.equal(assistantEvent[1].userId, USER);
  assert.equal(assistantEvent[1].tenantId === B, false);
});

test("rate limit bloquea antes de invocar proveedor o tools", async () => {
  state.rateAllowed = false;
  const response = await POST(request());
  assert.equal(response.status, 429);
  assert.equal(
    state.events.some((event) => Array.isArray(event) && event[0] === "assistant"),
    false,
  );
});
