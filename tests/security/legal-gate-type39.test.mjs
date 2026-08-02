import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("type 39 remains fail-closed behind legal plus existing technical gates without folio allocation", async () => {
  const legalSql = await readFile(new URL("../../migrations/202608020001_tenant_legal_privacy_gate.sql", import.meta.url), "utf8");
  const preCafSql = await readFile(new URL("../../migrations/202607290005_dte_boleta_39_pre_caf.sql", import.meta.url), "utf8");
  assert.match(preCafSql, /39,false,true,false,[\s\S]*'pre_caf_ready'/);
  assert.match(legalSql, /dte_type39_enablement_gate_report/);
  assert.match(legalSql, /dte_activation_gate_report\(p_tenant_id,39,true\)/);
  assert.match(legalSql, /DTE_TYPE39_LEGAL_OR_TECHNICAL_GATE_INCOMPLETE/);
  assert.match(legalSql, /before update of issuance_enabled/);
  assert.match(legalSql, /termsPublished/);
  assert.match(legalSql, /dteMandateAccepted/);
  assert.doesNotMatch(legalSql, /insert into public\.dte_production_cafs/i);
  assert.doesNotMatch(legalSql, /insert into public\.dte_production_folio_ledger/i);
  assert.doesNotMatch(legalSql, /reserve_(production_)?folio\s*\(/i);
  assert.doesNotMatch(legalSql, /update public\.dte_production_folio_ledger/i);
});
