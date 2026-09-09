import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "migrations/202609090001_cit67_legal_pending_constraint_fix.sql";
const migration = readFileSync(migrationPath, "utf8");

test("CIT-67 legal pending hotfix removes only the obsolete constraint", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/m);
  assert.match(
    migration,
    /drop constraint if exists tenant_legal_profiles_check;/,
  );
  assert.match(
    migration,
    /tenant_legal_profiles_sensitive_review_shape/,
  );
  assert.match(migration, /canonical sensitive review constraint is missing/);
  assert.match(migration, /canonical sensitive review constraint is not validated/);
  assert.doesNotMatch(
    migration,
    /drop constraint if exists tenant_legal_profiles_sensitive_review_shape/,
  );
  assert.doesNotMatch(migration, /insert into|update\s+public\.|delete from/i);
});

test("CIT-67 legal pending hotfix accepts the fail-closed pending shape on a historical schema", () => {
  const database = `citaya_cit67_pending_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync("docker", [
    "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`,
  ], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);

  const input = `
    create table public.tenant_legal_profiles(
      tenant_id uuid primary key,
      handles_sensitive_data boolean default null,
      sensitive_data_purpose text,
      sensitive_data_review_status text not null default 'pending'
        check (sensitive_data_review_status in ('pending','confirmed_no','confirmed_yes')),
      constraint tenant_legal_profiles_check check (
        handles_sensitive_data is false or
        length(trim(coalesce(sensitive_data_purpose,''))) between 10 and 1000
      ),
      constraint tenant_legal_profiles_sensitive_review_shape check (
        sensitive_data_review_status='pending' or
        (sensitive_data_review_status='confirmed_no'
          and handles_sensitive_data=false and sensitive_data_purpose is null) or
        (sensitive_data_review_status='confirmed_yes'
          and handles_sensitive_data=true
          and length(trim(coalesce(sensitive_data_purpose,''))) between 10 and 1000)
      )
    );

    ${migration}

    insert into public.tenant_legal_profiles(
      tenant_id,
      handles_sensitive_data,
      sensitive_data_purpose,
      sensitive_data_review_status
    ) values (
      '67000000-0000-4000-8000-000000000067',
      null,
      null,
      'pending'
    );

    do $$
    begin
      if exists (
        select 1
        from pg_catalog.pg_constraint c
        where c.conrelid='public.tenant_legal_profiles'::pg_catalog.regclass
          and c.conname='tenant_legal_profiles_check'
      ) then
        raise exception 'legacy constraint still exists';
      end if;

      if not exists (
        select 1
        from pg_catalog.pg_constraint c
        where c.conrelid='public.tenant_legal_profiles'::pg_catalog.regclass
          and c.conname='tenant_legal_profiles_sensitive_review_shape'
          and c.convalidated is true
      ) then
        raise exception 'canonical constraint missing';
      end if;

      if not exists (
        select 1
        from public.tenant_legal_profiles p
        where p.tenant_id='67000000-0000-4000-8000-000000000067'::uuid
          and p.sensitive_data_review_status='pending'
          and p.handles_sensitive_data is null
          and p.sensitive_data_purpose is null
      ) then
        raise exception 'pending fail-closed shape was not accepted';
      end if;
    end;
    $$;
  `;

  try {
    const run = spawnSync("docker", [
      "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
      "-d", database, "-v", "ON_ERROR_STOP=1",
    ], {
      input,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
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
