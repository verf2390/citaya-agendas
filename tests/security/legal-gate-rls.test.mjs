import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../migrations/202608020001_tenant_legal_privacy_gate.sql", import.meta.url);

test("legal records are tenant-isolated and published evidence is immutable", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "tenant_legal_profiles", "legal_documents", "legal_acceptances",
    "tenant_dte_mandates", "marketing_consent_events", "marketing_suppressions",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /revoke all on public\.tenant_legal_profiles,public\.legal_documents,[\s\S]*from anon,authenticated/);
  assert.match(sql, /legal_documents_member_read[\s\S]*is_tenant_member\(tenant_id,auth\.uid\(\)\)/);
  assert.match(sql, /owner_kind='tenant' and tenant_id=p_tenant_id/);
  assert.match(sql, /LEGAL_DOCUMENT_IMMUTABLE/);
  assert.match(sql, /LEGAL_DOCUMENT_HAS_PENDING_FIELDS/);
  assert.match(sql, /legal_acceptances_append_only[\s\S]*append_only_guard/);
  assert.match(sql, /tenant_dte_mandates_append_only[\s\S]*append_only_guard/);
  assert.match(sql, /LEGAL_EVIDENCE_TENANT_MISMATCH/);
  assert.match(sql, /MARKETING_DOCUMENT_TENANT_MISMATCH/);
  assert.match(sql, /DTE_MANDATE_TENANT_MISMATCH/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*to anon/i);
});
