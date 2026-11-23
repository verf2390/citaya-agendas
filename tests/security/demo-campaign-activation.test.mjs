import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import { isSafeDemoAppointmentMode, resolveTenantOperationalCapabilities } from "../../lib/tenant/operational-mode.mjs";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const demo = resolveTenantOperationalCapabilities({
  lifecycleStatus: "active",
  operationalMode: "demo",
});

function database(tenant, capabilities, { campaigns = false, external = false } = {}) {
  globalThis.__demoCampaignDatabase = {
    from(table) {
      const row = table === "tenants" ? tenant : {
        tax_document_mode: "unconfigured",
        payments_enabled: false,
        dte_enabled: false,
        external_communications_enabled: external,
        campaigns_enabled: campaigns,
      };
      return {
        select() { return this; },
        eq(key, value) {
          assert.equal(key, table === "tenants" ? "id" : "tenant_id");
          assert.equal(value, tenantId);
          return this;
        },
        async maybeSingle() { return { data: row, error: null }; },
      };
    },
    async rpc(name, args) {
      assert.equal(name, "resolve_tenant_operational_capabilities");
      assert.deepEqual(args, { p_tenant_id: tenantId });
      return { data: capabilities, error: null };
    },
  };
}

const operationalServer = new URL("../../lib/tenant/operational-server.ts", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabaseAdmin") return { url: "demo-campaign:supabase", shortCircuit: true };
    if (specifier === "@/lib/tenant/operational-mode.mjs") {
      return { url: pathToFileURL(resolve("lib/tenant/operational-mode.mjs")).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "demo-campaign:supabase") {
      return {
        format: "module",
        source: "export const supabaseAdmin = new Proxy({}, { get(_, key) { return globalThis.__demoCampaignDatabase[key]; } });",
        shortCircuit: true,
      };
    }
    if (url === operationalServer.href) {
      const source = ts.transpileModule(readFileSync(operationalServer, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      return { format: "module", source: source.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { assertTenantCanSendCampaign } = await import(operationalServer.href);
const allowMarketing = { allowDemoMarketing: true };
const blocked = { code: "TENANT_MODE_CAMPAIGN_BLOCKED" };

test("demo marketing requires both feature flags and explicit route opt-in", async () => {
  for (const config of [{}, { campaigns: true }, { external: true }]) {
    database({ id: tenantId, slug: "demo" }, demo, config);
    await assert.rejects(assertTenantCanSendCampaign(tenantId, allowMarketing), blocked);
  }

  database({ id: tenantId, slug: "demo" }, demo, { campaigns: true, external: true });
  const context = await assertTenantCanSendCampaign(tenantId, allowMarketing);
  assert.equal(isSafeDemoAppointmentMode(context.capabilities), true);
  assert.equal(context.capabilities.enqueueDte, false);
  assert.equal(context.capabilities.createPayment, false);
  await assert.rejects(assertTenantCanSendCampaign(tenantId), blocked);
  await assert.rejects(assertTenantCanSendCampaign(tenantId, { allowDemoMarketing: false }), blocked);
});

test("other demo tenants and unsafe demo capabilities cannot use demo marketing", async () => {
  const enabled = { campaigns: true, external: true };
  database({ id: tenantId, slug: "otra-demo" }, demo, enabled);
  await assert.rejects(assertTenantCanSendCampaign(tenantId, allowMarketing), blocked);
  database({ id: tenantId, slug: "demo" }, { ...demo, enqueueDte: true }, enabled);
  await assert.rejects(assertTenantCanSendCampaign(tenantId, allowMarketing), blocked);
});

test("live campaign permission continues to come from the regular capability", async () => {
  const live = resolveTenantOperationalCapabilities({ lifecycleStatus: "active", operationalMode: "live" });
  database({ id: tenantId, slug: "live" }, live);
  await assert.doesNotReject(assertTenantCanSendCampaign(tenantId));
  database({ id: tenantId, slug: "live" }, { ...live, sendCampaign: false }, {
    campaigns: true, external: true,
  });
  await assert.rejects(assertTenantCanSendCampaign(tenantId, allowMarketing), blocked);
});
