import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "migrations/202608020006_self_issuer_legal_authority.sql";
const migrationFiles = [
  "migrations/202608020001_tenant_legal_privacy_gate.sql",
  "migrations/202608020002_service_payment_policy_sales_coverage.sql",
  "migrations/202608020003_tenant_lifecycle_offboarding.sql",
  "migrations/202608020004_payment_policy_accounting.sql",
  "migrations/202608020005_tenant_operational_mode.sql",
  migrationPath,
];

test("self-issuer migration remains additive, backend-only and fail-closed", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const platformRoute = readFileSync("app/api/admin/platform/tenants/route.ts", "utf8");
  const platformPage = readFileSync("app/admin/plataforma/tenants/page.tsx", "utf8");
  const legalPage = readFileSync("app/admin/legal/page.tsx", "utf8");
  assert.match(sql, /create table public\.tenant_self_issuer_authority_events/);
  assert.match(sql, /SELF_ISSUER_AUTHORITY_APPEND_ONLY/);
  assert.match(sql, /tenant_self_issuer_authority_platform_read/);
  assert.match(sql, /extensions\.digest\(/);
  assert.match(sql, /sensitive_data_review_status[\s\S]*'pending'/);
  assert.match(sql, /certificationReady/);
  assert.match(sql, /productionIssuanceReady/);
  assert.match(sql, /DTE_MANDATE_EXTERNAL_TENANT_REQUIRED/);
  assert.doesNotMatch(sql, /^\s*(begin|commit)\s*;/im);
  assert.doesNotMatch(sql, /insert into public\.dte_(production_cafs|production_folio_ledger|issuance_outbox)/i);
  assert.doesNotMatch(sql, /update public\.dte_tenant_document_capabilities/i);
  assert.doesNotMatch(sql, /update public\.tenants/i);
  assert.match(platformRoute, /requirePlatformAdmin/);
  assert.match(platformRoute, /register_tenant_self_issuer_authority/);
  assert.match(platformRoute, /revoke_tenant_self_issuer_authority/);
  assert.match(platformPage, /Emisor propio/);
  assert.match(legalPage, /Pendiente de revisar/);
  assert.match(legalPage, /no crea mandatos artificiales/);
});

test("PostgreSQL 17 applies 001-006 and executes self-issuer RLS, digest and gate smoke with rollback", () => {
  const database = `citaya_self_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync("docker", [
    "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`,
  ], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);

  const normalizeStub = "create function public.normalize_chilean_rut(text) returns text language sql immutable as $$select upper(regexp_replace(trim($1),'[^0-9Kk-]','','g'))$$;";
  const normalizeWithDv = `create function public.normalize_chilean_rut(p_value text) returns text language plpgsql immutable strict set search_path=public as $$
declare cleaned text;body text;supplied_dv text;expected_dv text;digit_sum integer:=0;
  multiplier integer:=2;position integer;remainder integer;
begin
  cleaned:=upper(regexp_replace(trim(p_value),'[^0-9K]','','g'));
  if cleaned !~ '^[0-9]{7,8}[0-9K]$' then raise exception 'RUT_INVALID';end if;
  body:=substring(cleaned from 1 for length(cleaned)-1);supplied_dv:=right(cleaned,1);
  position:=length(body);
  while position>0 loop
    digit_sum:=digit_sum+substring(body from position for 1)::integer*multiplier;
    multiplier:=case when multiplier=7 then 2 else multiplier+1 end;position:=position-1;
  end loop;
  remainder:=11-(digit_sum%11);
  expected_dv:=case when remainder=11 then '0' when remainder=10 then 'K' else remainder::text end;
  if supplied_dv<>expected_dv then raise exception 'RUT_INVALID';end if;
  return body::bigint::text||'-'||supplied_dv;
end$$;`;
  const base = readFileSync("tests/sql/payment-policy-privacy-bootstrap.sql", "utf8")
    .replace(
      "create extension if not exists pgcrypto;",
      "create schema extensions; create extension if not exists pgcrypto with schema extensions;",
    )
    .replace(normalizeStub, () => normalizeWithDv);
  assert.notEqual(base.includes(normalizeStub), true, "RUT bootstrap replacement did not apply");
  const input = [
    base,
    ...migrationFiles.map((file) => readFileSync(file, "utf8")),
    readFileSync("tests/sql/self-issuer-legal-authority-assertions.sql", "utf8"),
  ].join("\n");

  try {
    const run = spawnSync("docker", [
      "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", database,
      "-v", "ON_ERROR_STOP=1",
    ], { input, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

    const verify = spawnSync("docker", [
      "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", database,
      "-Atc", "select to_regclass('public.tenants') is null",
    ], { encoding: "utf8" });
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(verify.stdout.trim(), "t", "external transaction did not roll back schema and fixtures");
  } finally {
    const drop = spawnSync("docker", [
      "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", `drop database if exists ${database}`,
    ], { encoding: "utf8" });
    assert.equal(drop.status, 0, drop.stderr);
  }
});
