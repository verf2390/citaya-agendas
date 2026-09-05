import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../migrations/202607240003_rg_issuer_provisioning.sql",
    import.meta.url,
  ),
  "utf8",
);
const storageHardening = readFileSync(
  new URL(
    "../../migrations/202609050001_cit65_storage_policy_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);
const worker = readFileSync(
  new URL("../../lib/dte/automation/worker.ts", import.meta.url),
  "utf8",
);

test("R&G provisioning resolves normalized RUT before slug and is idempotent", () => {
  const rutLookup = migration.indexOf(
    "upper(regexp_replace(p.issuer_rut",
  );
  const slugLookup = migration.indexOf("where t.slug = 'rg-spa'");
  assert.ok(rutLookup >= 0);
  assert.ok(slugLookup > rutLookup);
  assert.match(migration, /on conflict \(tenant_id, user_id\) do update/);
  assert.match(migration, /on conflict \(tenant_id\) do update/);
  assert.doesNotMatch(migration, /update public\.tenants[\s\S]*slug = 'demo'/i);
});

test("pre-declaration profile contains no invented SII resolution", () => {
  assert.match(migration, /issuer_profile_state[\s\S]*pre_declaration/);
  assert.match(
    migration,
    /null, null, null, '27\.164\.542-2'/,
  );
  assert.match(migration, /production_enabled[\s\S]*false/);
  assert.match(migration, /issuance_mode[\s\S]*'manual'/);
});

test("private DTE bucket is protected by the forward-only storage hardening", () => {
  assert.match(
    migration,
    /values \('dte-production-private', 'dte-production-private', false\)/,
  );
  assert.match(storageHardening, /drop policy if exists "Public read" on storage\.objects/i);
  assert.doesNotMatch(
    storageHardening,
    /create\s+policy[\s\S]*?using\s*\(\s*bucket_id\s*(?:<>|!=)/i,
  );
  assert.match(storageHardening, /for all to service_role/i);
  assert.match(
    storageHardening,
    /using \(bucket_id = 'dte-production-private'\)/,
  );
  assert.match(storageHardening, /service_role normally has BYPASSRLS/i);
  assert.doesNotMatch(storageHardening, /service-role-only/i);
});

test("readiness and deterministic retry remain tenant scoped", () => {
  assert.match(migration, /dte_tenant_operational_readiness/);
  assert.match(migration, /ready_for_declaration boolean/);
  assert.match(migration, /ready_for_issuance boolean/);
  assert.match(
    migration,
    /where id = p_intent_id[\s\S]*tenant_id = p_tenant_id/,
  );
  assert.match(migration, /network_attempt_count = 0/);
});

test("worker queries readiness for the claimed tenant without R&G fallback", () => {
  assert.match(worker, /p_tenant_id: item\.tenant_id/);
  assert.match(worker, /DTE_TENANT_NOT_READY_FOR_ISSUANCE/);
  assert.doesNotMatch(worker, /rg-spa|78195645|R&G/i);
});

test("readiness evidence stores metadata only, never secure material or paths", () => {
  const table = migration.match(
    /create table if not exists public\.dte_tenant_readiness_evidence[\s\S]*?\n\);/,
  )?.[0] ?? "";
  assert.doesNotMatch(
    table,
    /\b(password|private_key|certificate_pem|caf_xml|token|path)\b/i,
  );
  assert.match(table, /certificate_public_key_sha256/);
});
