import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const state = { calls: [], next: { data: null, error: null } };

class RpcQuery {
  constructor(name, args) {
    this.name = name;
    this.args = args;
  }

  abortSignal(signal) {
    this.signal = signal;
    return this;
  }

  then(resolvePromise, rejectPromise) {
    state.calls.push({
      name: this.name,
      args: this.args,
      signaled: Boolean(this.signal),
    });
    return Promise.resolve(state.next).then(resolvePromise, rejectPromise);
  }
}

globalThis.__citayaProductMetering = {
  supabaseAdmin: {
    rpc(name, args) {
      return new RpcQuery(name, args);
    },
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabaseAdmin") {
      return { url: "citaya-product-metering:supabase", shortCircuit: true };
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
    if (url === "citaya-product-metering:supabase") {
      return {
        format: "module",
        source:
          "export const supabaseAdmin = globalThis.__citayaProductMetering.supabaseAdmin;",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { AI_PRODUCT_IDS, isAIProductId } = await import(
  pathToFileURL(resolve("lib/ai/product.ts")).href
);
const { beginAIRequestAudit } = await import(
  pathToFileURL(resolve("lib/ai/server/audit.ts")).href
);

test.beforeEach(() => {
  state.calls = [];
  state.next = { data: null, error: null };
});

test("cross-product metering exposes the four canonical product ids", () => {
  assert.deepEqual(AI_PRODUCT_IDS, [
    "agendas",
    "retail",
    "n8n",
    "web_creators",
  ]);
  assert.equal(isAIProductId("agendas"), true);
  assert.equal(isAIProductId("retail"), true);
  assert.equal(isAIProductId("n8n"), true);
  assert.equal(isAIProductId("web_creators"), true);
  assert.equal(isAIProductId("unknown"), false);
});

test("human audit sends explicit product identity to the RPC", async () => {
  state.next = {
    data: "11111111-1111-4111-8111-111111111111",
    error: null,
  };

  await beginAIRequestAudit({
    tenantId: "22222222-2222-4222-8222-222222222222",
    productId: "agendas",
    userId: "33333333-3333-4333-8333-333333333333",
    authMode: "tenant_members",
    provider: "local",
    model: "local-test",
    promptVersion: "citaya-app-assistant-v1",
    dailyTokenLimit: 50000,
    reservedTokens: 800,
  });

  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].name, "begin_ai_request_audit");
  assert.equal(state.calls[0].args.p_product_id, "agendas");
});
