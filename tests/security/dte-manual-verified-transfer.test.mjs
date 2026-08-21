import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "migrations/202608200002_manual_verified_transfer_automatic_dte.sql",
  "utf8",
);

const mode = readFileSync(
  "lib/tenant/operational-mode.mjs",
  "utf8",
);

const server = readFileSync(
  "lib/tenant/operational-server.ts",
  "utf8",
);

const worker = readFileSync(
  "lib/dte/automation/worker.ts",
  "utf8",
);

const route = readFileSync(
  "app/api/admin/appointments/mark-paid/route.ts",
  "utf8",
);

const page = readFileSync(
  "app/admin/pagos/page.tsx",
  "utf8",
);

test("[security] manual_verified is accepted through every automatic DB fence", () => {
  assert.match(
    migration,
    /automatic_flow := p_trigger_source in \('khipu','webpay','mercadopago','manual_verified'\)/,
  );

  assert.match(
    migration,
    /i\.trigger_source in \('khipu','webpay','mercadopago','manual_verified'\)/,
  );

  assert.match(
    migration,
    /intent_row\.trigger_source not in \('khipu','webpay','mercadopago','manual_verified'\)/,
  );

  assert.match(
    migration,
    /manual_admin'[\s\S]*'manual_verified'/,
  );
});

test("[security] manual_verified requires persisted admin verification evidence", () => {
  assert.match(migration, /p_actor_id is null/);
  assert.match(migration, /pi\.provider is distinct from 'manual'/);
  assert.match(migration, /bsp\.status = 'VERIFIED'/);
  assert.match(migration, /bsp\.validation_result = 'provider_verified'/);
  assert.match(migration, /bsp\.reconciliation_status = 'NOT_REQUIRED'/);
  assert.match(migration, /bsp\.verified_by = p_actor_id/);
  assert.match(migration, /verified_bsp\.verified_by = i\.created_by/);
  assert.match(
    migration,
    /verified_bsp\.verified_by = intent_row\.created_by/,
  );
});

test("[security] internal manual payment mutation requires RPC-local trust marker", () => {
  assert.match(
    migration,
    /citaya\.manual_transfer_tenant_id/,
  );
  assert.match(
    migration,
    /current_setting\([\s\S]*citaya\.manual_transfer_tenant_id/,
  );
  assert.match(
    migration,
    /perform public\.assert_tenant_can_create_payment\(new\.tenant_id\)/,
  );
  assert.match(
    migration,
    /perform public\.assert_tenant_can_confirm_transfer\(new\.tenant_id\)/,
  );
});

test("[security] manual transfer status transitions use the same RPC-local trust marker", () => {
  assert.match(
    migration,
    /create or replace function public\.tenant_mode_payment_status_guard/,
  );
  assert.match(
    migration,
    /new\.status in \('pending','processing','succeeded','paid','VERIFIED'\)/,
  );
  assert.match(
    migration,
    /citaya\.manual_transfer_tenant_id/,
  );
  assert.match(
    migration,
    /coalesce\(new\.provider,''\)='manual'/,
  );
  assert.match(
    migration,
    /perform public\.assert_tenant_can_confirm_transfer\(new\.tenant_id\)/,
  );
  assert.match(
    migration,
    /perform public\.assert_tenant_can_create_payment\(new\.tenant_id\)/,
  );
});

test("[security] generic internal financial and worker capabilities remain closed", () => {
  assert.match(mode, /createPayment:\s*false/);
  assert.match(mode, /runDteWorker:\s*false/);
  assert.match(server, /intent\?\.trigger_source === "manual_verified"/);
  assert.match(server, /payment\?\.provider === "manual"/);
  assert.match(server, /payment\?\.status === "succeeded"/);
  assert.match(server, /evidence\?\.status === "VERIFIED"/);
  assert.match(worker, /intentId: item\.intent_id/);
});

test("[security] admin explicitly confirms receipt of bank transfer", () => {
  assert.match(route, /assertTenantCanConfirmTransfer/);
  assert.doesNotMatch(
    route,
    /assertTenantCanCreatePayment\(access\.tenantId\)/,
  );
  assert.match(page, /Confirmar transferencia recibida/);
  assert.match(page, /window\.confirm/);
});
