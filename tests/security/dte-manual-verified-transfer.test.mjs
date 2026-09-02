import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "migrations/202608200002_manual_verified_transfer_automatic_dte.sql",
  "utf8",
);

const documentPathMigration = readFileSync(
  "migrations/202608220001_prevent_automatic_payment_manual_draft.sql",
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

test("[security] automatic verified payments use one document path", () => {
  const automaticDecision =
    documentPathMigration.match(
      /create or replace function public\.billing_verified_payment_uses_automatic_dte[\s\S]*?\n\$\$;/,
    )?.[0] ?? "";

  assert.match(
    automaticDecision,
    /create or replace function public\.billing_verified_payment_uses_automatic_dte/,
  );
  assert.match(
    automaticDecision,
    /p_provider in \('khipu','webpay','mercadopago'\)/,
  );
  assert.match(
    automaticDecision,
    /citaya\.manual_transfer_tenant_id/,
  );
  assert.match(
    automaticDecision,
    /issuance_mode = 'automatic_on_verified_payment'[\s\S]*production_enabled = true/,
  );
  assert.match(
    automaticDecision,
    /from public\.dte_production_tenant_settings production_settings[\s\S]*production_settings\.enabled = true[\s\S]*production_settings\.issuance_mode = 'automatic'/,
  );
  assert.doesNotMatch(
    automaticDecision,
    /sii_authorization_status|authorized_types|dte_legal_activation|caf_ready|folio_ready/,
  );
  assert.match(
    automaticDecision,
    /billing_sale_item_document_coverage[\s\S]*c\.amount_range && a\.amount_range/,
  );
  assert.match(
    automaticDecision,
    /dte_payment_document_policy_decision/,
  );
  assert.match(
    documentPathMigration,
    /if not automatic_dte then[\s\S]*billing_create_payment_review_document/,
  );
  assert.match(
    documentPathMigration,
    /if automatic_dte and p_provider in \('khipu','webpay','mercadopago'\) then[\s\S]*dte_enqueue_payment_snapshot/,
  );
  assert.doesNotMatch(
    documentPathMigration,
    /delete\s+from\s+public\.dte_invoice_drafts|truncate\s+public\.dte_invoice_drafts/i,
  );
});

test("[security] voucher and manual review remain outside automatic DTE", () => {
  assert.match(
    documentPathMigration,
    /decision->>'action' not in \('ISSUE_FACTURA_33','ISSUE_BOLETA_39'\)/,
  );
  assert.match(
    documentPathMigration,
    /uncovered = 0 or uncovered <> sale_payment\.amount/,
  );
  assert.match(
    documentPathMigration,
    /sale\.requested_document_type = 33 and not exists/,
  );
  assert.match(
    documentPathMigration,
    /if public\.billing_verified_payment_uses_automatic_dte\([\s\S]*'manual',[\s\S]*method_classification[\s\S]*then[\s\S]*'manual_verified'/,
  );
});
