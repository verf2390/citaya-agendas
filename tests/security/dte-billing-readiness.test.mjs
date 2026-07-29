import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const billingPage = readFileSync(
  new URL("../../app/admin/facturacion/page.tsx", import.meta.url),
  "utf8",
);
const readinessCard = readFileSync(
  new URL(
    "../../components/admin/dte/DeclarationReadinessCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const billingApi = readFileSync(
  new URL("../../app/api/admin/dte-settings/route.ts", import.meta.url),
  "utf8",
);
const billingCompliance = readFileSync(
  new URL("../../lib/dte/billing-compliance.ts", import.meta.url),
  "utf8",
);

test("billing derives declaration and issuance from current tenant-scoped gates", () => {
  assert.match(
    billingApi,
    /rpc\("dte_activation_gate_report",[\s\S]*p_tenant_id: tenantId/,
  );
  assert.doesNotMatch(billingApi, /dte_tenant_operational_readiness/);
  assert.match(billingApi, /deriveBillingCompliance/);
  assert.match(
    billingApi,
    /\.from\("dte_tenant_readiness_evidence"\)[\s\S]*\.eq\("tenant_id", tenantId\)/,
  );
  assert.match(
    billingApi,
    /\.from\("dte_production_tenant_settings"\)[\s\S]*\.eq\("tenant_id", tenantId\)/,
  );
  assert.match(billingPage, /state=\{state\.declaration\}/);
});

test("billing clearly shows declaration readiness and issuance blockers", () => {
  for (const label of [
    "Declaración cumplida",
    "Autorización SII vigente",
    "Emisión habilitada para",
    "Trust anchor pendiente",
    "CAF productivo pendiente",
  ])
    assert.match([readinessCard, billingCompliance].join("\n"), new RegExp(label));
  assert.match(
    readinessCard,
    /Estado regulatorio derivado de evidencia vigente, activación legal y readiness persistido/,
  );
});
