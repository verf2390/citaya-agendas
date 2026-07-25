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

test("billing exposes declaration and issuance as separate tenant-scoped gates", () => {
  assert.match(
    billingApi,
    /rpc\("dte_tenant_operational_readiness",[\s\S]*p_tenant_id: tenantId/,
  );
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
    "Listo para declaración",
    "No autorizado todavía",
    "Emisión bloqueada",
    "Trust anchor pendiente",
    "CAF productivo pendiente",
  ])
    assert.match(readinessCard, new RegExp(label));
  assert.match(
    readinessCard,
    /La declaración habilita el paso regulatorio; no autoriza ni activa la emisión/,
  );
});
