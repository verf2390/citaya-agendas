import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const normalizeSource = readFileSync(
  "migrations/202607270001_dte_legal_activation.sql",
  "utf8",
);
const normalizeFunction = normalizeSource.match(
  /create or replace function public\.normalize_chilean_rut\(p_value text\)[\s\S]*?\n\$\$;/,
)?.[0];
const migration = readFileSync(
  "migrations/202609010001_cit38_canonicalize_production_issuer_rut.sql",
  "utf8",
);

test("CIT-38 canonical issuer RUT migration is exact, preserving and idempotent", () => {
  assert.ok(normalizeFunction, "normalize_chilean_rut definition not found");
  const database = `citaya_cit38_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync("docker", [
    "exec",
    "citaya-dte-sqltest",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `create database ${database}`,
  ], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);

  try {
    const setupAndMigrate = [
      normalizeFunction,
      `
        create table public.dte_production_tenant_settings (
          tenant_id uuid primary key,
          issuer_rut text not null
        );
        create unique index dte_production_issuer_rut_unique
          on public.dte_production_tenant_settings (
            upper(regexp_replace(issuer_rut, '[^0-9K]', '', 'g'))
          );
        insert into public.dte_production_tenant_settings (tenant_id, issuer_rut)
        values ('00000000-0000-0000-0000-000000000001', '78.195.645-7');
      `,
      migration,
      migration,
    ].join("\n");
    const run = spawnSync("docker", [
      "exec",
      "-i",
      "citaya-dte-sqltest",
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
    ], { input: setupAndMigrate, encoding: "utf8" });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

    const canonicalInsert = spawnSync("docker", [
      "exec",
      "citaya-dte-sqltest",
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "insert into public.dte_production_tenant_settings (tenant_id,issuer_rut) values ('00000000-0000-0000-0000-000000000002','12345678-5')",
    ], { encoding: "utf8" });
    assert.equal(canonicalInsert.status, 0, canonicalInsert.stderr);

    const rows = spawnSync("docker", [
      "exec",
      "citaya-dte-sqltest",
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-Atc",
      "select string_agg(issuer_rut,',' order by issuer_rut) from public.dte_production_tenant_settings",
    ], { encoding: "utf8" });
    assert.equal(rows.status, 0, rows.stderr);
    assert.equal(rows.stdout.trim(), "12345678-5,78195645-7");

    const dottedInsert = spawnSync("docker", [
      "exec",
      "citaya-dte-sqltest",
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "insert into public.dte_production_tenant_settings (tenant_id,issuer_rut) values ('00000000-0000-0000-0000-000000000003','11.111.111-1')",
    ], { encoding: "utf8" });
    assert.notEqual(dottedInsert.status, 0);
    assert.match(dottedInsert.stderr, /dte_production_tenant_settings_issuer_rut_canonical/);
  } finally {
    const drop = spawnSync("docker", [
      "exec",
      "citaya-dte-sqltest",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `drop database if exists ${database}`,
    ], { encoding: "utf8" });
    assert.equal(drop.status, 0, drop.stderr);
  }
});
