import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as operational from "../../lib/tenant/operational-mode.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync("lib/tenant/operational-server.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tenantId = "73000000-0000-4000-8000-000000000001";

// Complete DB response fixture, independent of the legacy presentation resolver.
function dbCapabilities() {
  return {
    lifecycleStatus: "active", operationalMode: "live",
    informationalPage: true, demoSimulation: false, createAppointment: true,
    createPayment: false, confirmTransfer: false, acceptPaymentWebhook: false,
    appointmentOperationalCommunication: true, sendExternalEmail: true,
    sendCampaign: true, callExternalAutomation: true, bheAutomation: false,
    enqueueDte: false, manualDteEnqueue: false, runDteWorker: false,
    publicTaxDocument: false, taxAdministration: false, dteCertification: false,
    ordinaryAdmin: true, exceptionalPlatformAccess: false, classificationAdmin: false,
  };
}

function loadServer(capabilities, { rpcError = null, rpcThrows = false } = {}) {
  const supabaseAdmin = {
    from(table) {
      assert.ok(["tenants", "tenant_operational_features"].includes(table));
      return {
        select() { return this; },
        eq(column, value) {
          assert.equal(column, table === "tenants" ? "id" : "tenant_id");
          assert.equal(value, tenantId);
          return this;
        },
        async maybeSingle() {
          return { error: null, data: table === "tenants"
            ? { id: tenantId, slug: "tenant-a", lifecycle_status: "active", operational_mode: "live" }
            : { tax_document_mode: "external_bhe", payments_enabled: false, dte_enabled: false } };
        },
      };
    },
    async rpc(name, args) {
      assert.equal(name, "resolve_tenant_operational_capabilities");
      assert.deepEqual(args, { p_tenant_id: tenantId });
      if (rpcThrows) throw new Error("resolver unavailable");
      return { data: capabilities, error: rpcError };
    },
  };
  const module = { exports: {} };
  const mockRequire = (name) => {
    if (name === "node:crypto") return require(name);
    if (name === "@/lib/supabaseAdmin") return { supabaseAdmin };
    if (name === "@/lib/tenant/operational-mode.mjs") return operational;
    throw new Error(`Unexpected import: ${name}`);
  };
  new Function("require", "module", "exports", compiled)(mockRequire, module, module.exports);
  return module.exports;
}

test("pre-CIT-73 resolver normalizes only absent BHE to false without mutating its response", async () => {
  const legacy = dbCapabilities();
  delete legacy.bheAutomation;
  Object.freeze(legacy);
  const server = loadServer(legacy);
  const context = await server.loadTenantOperationalContext(tenantId);
  assert.deepEqual(context.capabilities, { ...legacy, bheAutomation: false });
  assert.equal(Object.hasOwn(legacy, "bheAutomation"), false);
  assert.equal(context.capabilities.callExternalAutomation, true);
  await assert.rejects(server.assertTenantCanAutomateBhe(tenantId), /TENANT_MODE_BHE_AUTOMATION_BLOCKED/);
  await server.assertTenantCanCreateAppointment(tenantId);
  await server.assertTenantCanSendCampaign(tenantId);
});

for (const bheAutomation of [false, true]) {
  test(`DB bheAutomation=${bheAutomation} is preserved independently of communications`, async () => {
    const payload = { ...dbCapabilities(), bheAutomation, callExternalAutomation: !bheAutomation };
    const server = loadServer(payload);
    const context = await server.loadTenantOperationalContext(tenantId);
    assert.deepEqual(context.capabilities, payload);
    if (bheAutomation) await server.assertTenantCanAutomateBhe(tenantId);
    else await assert.rejects(server.assertTenantCanAutomateBhe(tenantId), /TENANT_MODE_BHE_AUTOMATION_BLOCKED/);
  });
}

test("present invalid BHE is rejected, including explicit undefined", async () => {
  for (const bheAutomation of ["true", "false", "", 0, 1, null, undefined, [], {}]) {
    const server = loadServer({ ...dbCapabilities(), bheAutomation });
    await assert.rejects(server.loadTenantOperationalContext(tenantId), /TENANT_OPERATIONAL_CONTEXT_UNAVAILABLE/);
  }
});

test("every other capability remains required and strictly typed with old and new resolvers", async () => {
  for (const legacy of [false, true]) {
    const valid = dbCapabilities();
    if (legacy) delete valid.bheAutomation;
    for (const [field, value] of Object.entries(valid)) {
      if (field === "bheAutomation") continue;
      const missing = { ...valid };
      delete missing[field];
      await assert.rejects(loadServer(missing).loadTenantOperationalContext(tenantId),
        /TENANT_OPERATIONAL_CONTEXT_UNAVAILABLE/, `missing ${field}, legacy=${legacy}`);
      const invalidValues = typeof value === "boolean" ? [null, undefined, "true", 1] : [null, undefined, 1];
      for (const invalid of invalidValues) {
        await assert.rejects(loadServer({ ...valid, [field]: invalid }).loadTenantOperationalContext(tenantId),
          /TENANT_OPERATIONAL_CONTEXT_UNAVAILABLE/, `invalid ${field}, legacy=${legacy}`);
      }
    }
  }
});

test("malformed responses and real resolver errors remain fail-closed", async () => {
  for (const response of [null, undefined, [], "invalid", 1, { exists: false, allowed: false }]) {
    await assert.rejects(loadServer(response).loadTenantOperationalContext(tenantId), /TENANT_OPERATIONAL_CONTEXT_UNAVAILABLE/);
  }
  const legacy = dbCapabilities();
  delete legacy.bheAutomation;
  for (const payload of [legacy, { ...dbCapabilities(), bheAutomation: true }]) {
    await assert.rejects(loadServer(payload, { rpcError: { message: "DB failed" } }).loadTenantOperationalContext(tenantId),
      /TENANT_OPERATIONAL_CONTEXT_UNAVAILABLE/);
    await assert.rejects(loadServer(payload, { rpcThrows: true }).assertTenantCanAutomateBhe(tenantId), /resolver unavailable/);
  }
});
