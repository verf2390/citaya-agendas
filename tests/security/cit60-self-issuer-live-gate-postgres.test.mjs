import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "migrations/202609040002_cit60_self_issuer_live_gate.sql";
const migration = readFileSync(migrationPath, "utf8");

const historicalMigrations = [
  "migrations/202608020001_tenant_legal_privacy_gate.sql",
  "migrations/202608020002_service_payment_policy_sales_coverage.sql",
  "migrations/202608020003_tenant_lifecycle_offboarding.sql",
  "migrations/202608020004_payment_policy_accounting.sql",
  "migrations/202608020005_tenant_operational_mode.sql",
  "migrations/202608020006_self_issuer_legal_authority.sql",
];

test("CIT-60 changes only derived authority validity and atomic mode transition", () => {
  const platformPage = readFileSync(
    "app/admin/plataforma/tenants/page.tsx",
    "utf8",
  );
  const definitions = [...migration.matchAll(
    /create or replace function public\.([a-z0-9_]+)/gi,
  )].map((match) => match[1]);

  assert.deepEqual(definitions, [
    "tenant_self_issuer_authority_report",
    "set_tenant_operational_mode",
  ]);
  assert.doesNotMatch(
    migration,
    /create or replace function public\.(?:tenant_self_issuer_authority_event_guard|register_tenant_self_issuer_authority|tenant_dte_authority_report|tenant_legal_gate_report|tenant_live_readiness_report|dte_automatic_issuance_gate_report)/i,
  );
  assert.match(migration, /security definer\nset search_path = ''/g);
  assert.match(migration, /operational_mode in \('internal', 'live'\)/);
  assert.match(
    migration,
    /when 'live' then public\.legal_identity_complete\(p_tenant_id\)/,
  );
  assert.match(
    migration,
    /pre_readiness := public\.tenant_live_readiness_report[\s\S]*update public\.tenants[\s\S]*post_readiness := public\.tenant_live_readiness_report[\s\S]*insert into public\.tenant_operational_mode_audit/,
  );
  assert.equal(
    (migration.match(/LIVE_TENANT_CHECKLIST_INCOMPLETE/g) ?? []).length,
    2,
  );
  assert.match(
    migration,
    /post_readiness \|\| pg_catalog\.jsonb_build_object\([\s\S]*'preTransition', pre_readiness/,
  );
  assert.match(
    migration,
    /revoke all on function public\.tenant_self_issuer_authority_report\(uuid\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public\.set_tenant_operational_mode\(uuid,text,uuid,text\)[\s\S]*from public, anon, authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /(?:net\.http|http_(?:get|post)|dblink|pg_net|insert into public\.dte_production_cafs|insert into public\.dte_production_folio_ledger)/i,
  );

  assert.match(
    platformPage,
    /tenant\.operational_mode === "internal" \|\| tenant\.selfIssuerAuthority\.evidenceExists/,
  );
  assert.match(
    platformPage,
    /tenant\.selfIssuerAuthority\.evidenceExists && !tenant\.selfIssuerAuthority\.revoked[\s\S]*"revokeSelfIssuer"[\s\S]*tenant\.operational_mode === "internal"[\s\S]*"registerSelfIssuer"/,
  );
});

test("CIT-60 PostgreSQL uses real legal and CIT-59 readiness gates", () => {
  const database = `citaya_cit60_${randomUUID().replaceAll("-", "")}`;
  assert.match(database, /^citaya_cit60_[a-f0-9]{32}$/);
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
  const bootstrap = readFileSync(
    "tests/sql/payment-policy-privacy-bootstrap.sql",
    "utf8",
  )
    .replace(
      "create extension if not exists pgcrypto;",
      "create schema extensions; create extension if not exists pgcrypto with schema extensions;",
    )
    .replace(normalizeStub, () => normalizeWithDv);
  assert.equal(bootstrap.includes(normalizeStub), false);

  const cit59HistoricalBase = `
    alter table public.tenant_payment_settings
      add column if not exists payment_mode text;
  `;
  const input = [
    bootstrap,
    ...historicalMigrations.map((file) => readFileSync(file, "utf8")),
    cit59HistoricalBase,
    readFileSync(
      "migrations/202609010002_cit59_provider_dte_commercial_readiness.sql",
      "utf8",
    ),
    migration,
    readFileSync(
      "tests/sql/cit60-self-issuer-live-gate-assertions.sql",
      "utf8",
    ),
  ].join("\n");

  try {
    const run = spawnSync("docker", [
      "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
      "-d", database, "-v", "ON_ERROR_STOP=1",
    ], {
      input,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  } finally {
    const drop = spawnSync("docker", [
      "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", `drop database if exists ${database}`,
    ], { encoding: "utf8" });
    assert.equal(drop.status, 0, drop.stderr);
  }
});
