import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const state = {};

globalThis.__citayaAIUsageIsolation = {
  async requireHostTenantAdmin() {
    state.events.push("auth");
    return state.access;
  },
  async loadAIUsageSummary(input) {
    state.events.push(["usage", input]);
    return {
      requests: 10,
      succeeded: 9,
      failed: 1,
      localRequests: 7,
      cloudRequests: 2,
      fallbackRequests: 1,
      totalTokens: 1000,
      cloudTokens: 200,
      avgDurationMs: 900,
      avgProviderDurationMs: 700,
    };
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = {
      "next/server": "next",
      "@/lib/ai/errors": "errors",
      "@/lib/ai/server/usage": "usage",
      "@/lib/api/requireTenantAdmin": "auth",
    };
    if (map[specifier]) {
      return { url: `citaya-ai-usage:${map[specifier]}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const sources = {
      "citaya-ai-usage:next": "export const NextResponse = Response;",
      "citaya-ai-usage:errors": `
        export class AIError extends Error {
          constructor(code, message) { super(message); this.code = code; }
        }
        export function safeAIErrorCode(error) {
          return error?.code ?? "AI_PROVIDER_UNAVAILABLE";
        }
      `,
      "citaya-ai-usage:usage":
        "export const loadAIUsageSummary = globalThis.__citayaAIUsageIsolation.loadAIUsageSummary;",
      "citaya-ai-usage:auth":
        "export const requireHostTenantAdmin = globalThis.__citayaAIUsageIsolation.requireHostTenantAdmin;",
    };
    if (sources[url]) {
      return { format: "module", source: sources[url], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { GET } = await import(
  pathToFileURL(resolve("app/api/admin/ai/usage/route.ts")).href
);

test.beforeEach((t) => {
  t.mock.method(console, "error", () => {});
  Object.assign(state, {
    access: {
      ok: true,
      tenantId: TENANT,
      tenantSlug: "tenant-a",
      userId: USER,
      authMode: "tenant_members",
    },
    events: [],
  });
});

test("usage usa únicamente el tenant autenticado", async () => {
  const response = await GET(
    new Request(
      "https://tenant-a.citaya.online/api/admin/ai/usage?days=7&tenantId=foreign",
    ),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);

  const event = state.events.find(
    (item) => Array.isArray(item) && item[0] === "usage",
  );
  assert.equal(event[1].tenantId, TENANT);
  assert.equal(event[1].userId, USER);
  assert.equal(event[1].authMode, "tenant_members");
  assert.equal(event[1].since instanceof Date, true);
});

for (const status of [401, 403]) {
  test(`usage auth ${status} bloquea antes de consultar telemetría`, async () => {
    state.access = { ok: false, status, error: "secret" };
    const response = await GET(
      new Request("https://tenant-a.citaya.online/api/admin/ai/usage?days=7"),
    );
    assert.equal(response.status, status);
    assert.deepEqual(state.events, ["auth"]);
  });
}

test("usage limita el rango a 30 días", async () => {
  const response = await GET(
    new Request("https://tenant-a.citaya.online/api/admin/ai/usage?days=31"),
  );
  assert.equal(response.status, 400);
  assert.equal(
    state.events.some((item) => Array.isArray(item) && item[0] === "usage"),
    false,
  );
});
