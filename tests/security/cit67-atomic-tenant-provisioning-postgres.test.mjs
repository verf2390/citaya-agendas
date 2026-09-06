import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "migrations/202609060001_cit67_atomic_tenant_provisioning.sql";
const assertionsPath =
  "tests/sql/cit67-atomic-tenant-provisioning-assertions.sql";
const migration = readFileSync(migrationPath, "utf8");

test("CIT-67 migration exposes only the atomic fail-closed provisioning boundary", () => {
  const preflightStart = migration.indexOf("do $preflight$");
  const preflightEnd = migration.indexOf("$preflight$;", preflightStart);
  const ledgerStart = migration.indexOf(
    "create table public.tenant_provisioning_requests",
  );
  assert.ok(preflightStart > migration.indexOf("begin;"));
  assert.ok(preflightEnd > preflightStart);
  assert.ok(preflightEnd < ledgerStart);

  const preflight = migration.slice(preflightStart, preflightEnd);
  assert.match(preflight, /CIT67_SCHEMA_PREFLIGHT_FAILED:/);
  assert.match(preflight, /pg_catalog\.pg_class/);
  assert.match(preflight, /pg_catalog\.pg_attribute/);
  assert.match(preflight, /pg_catalog\.pg_index/);
  assert.match(
    preflight,
    /pg_catalog\.to_regprocedure\('extensions\.digest\(bytea,text\)'\)/,
  );
  assert.doesNotMatch(preflight, /\b(?:from|join)\s+(?:public|auth)\./i);

  assert.match(
    migration,
    /create or replace function public\.provision_tenant\([\s\S]*?\) returns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = ''/,
  );
  assert.match(
    migration,
    /from public\.platform_admins as platform_admin[\s\S]*platform_admin\.role = 'super_admin'[\s\S]*platform_admin\.is_active is true/,
  );
  assert.match(migration, /extensions\.digest\([\s\S]*'sha256'/);
  assert.equal(
    (migration.match(/pg_catalog\.pg_advisory_xact_lock/g) ?? []).length,
    2,
  );
  assert.match(
    migration,
    /show_address,[\s\S]*show_phone_after_booking[\s\S]*false,[\s\S]*false,[\s\S]*false,[\s\S]*false,[\s\S]*false,[\s\S]*false/,
  );
  assert.match(
    migration,
    /payment_mode,[\s\S]*payment_methods_enabled,[\s\S]*payment_collection_mode[\s\S]*'none',[\s\S]*'\[\]'::jsonb,[\s\S]*'none'/,
  );
  assert.doesNotMatch(migration, /on conflict|\bupsert\b/i);
  assert.doesNotMatch(
    migration,
    /insert into public\.(?:dte_production_tenant_settings|dte_tenant_document_capabilities|tenant_payment_method_tax_policies|dte_(?:production|certification)_(?:cafs|folios)|dte_production_folio_ledger|tenant_self_issuer_authority_events|services|professionals|availability|customers|appointments|campaigns|message_logs)/i,
  );
  assert.doesNotMatch(
    migration,
    /(?:net\.http|http_(?:get|post)|dblink|pg_net|alter policy|create policy.*public\.tenants)/i,
  );
  assert.ok(
    migration.indexOf("insert into public.tenant_provisioning_requests") >
      migration.indexOf("insert into public.data_retention_policies"),
    "the completion ledger must be the final provisioning insert",
  );
  assert.match(
    migration,
    /revoke all on function public\.provision_tenant\([\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.provision_tenant\([\s\S]*to service_role;/,
  );
});

test("CIT-67 PostgreSQL preflight and provisioning are atomic and fail closed", () => {
  const database = `citaya_cit67_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync("docker", [
    "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`,
  ], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);

  const bootstrap = `
    do $$
    begin
      if not exists(select 1 from pg_catalog.pg_roles where rolname='anon') then
        create role anon nologin;
      end if;
      if not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated') then
        create role authenticated nologin;
      end if;
      if not exists(select 1 from pg_catalog.pg_roles where rolname='service_role') then
        create role service_role nologin;
      end if;
    end;
    $$;

    create schema auth;
    create schema extensions;
    create extension pgcrypto with schema extensions;

    create table auth.users(
      id uuid primary key,
      email text
    );

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(
        pg_catalog.current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid
    $$;
    revoke all on function auth.uid() from public;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;

    create table public.tenants(
      id uuid not null default extensions.gen_random_uuid() primary key,
      slug text not null unique,
      name text not null,
      lifecycle_status text not null default 'active'
        check (lifecycle_status in ('active','archived')),
      operational_mode text not null default 'unclassified'
        check (operational_mode in ('unclassified','demo','live','internal')),
      show_address boolean not null default true,
      show_phone boolean not null default true,
      show_address_home boolean not null default true,
      show_phone_home boolean not null default true,
      show_address_after_booking boolean not null default true,
      show_phone_after_booking boolean not null default true,
      admin_email text,
      contact_email text,
      phone_display text,
      whatsapp text,
      address text,
      city text,
      min_lead_time_min integer check (
        min_lead_time_min between 0 and 1440
      )
    );

    create table public.tenant_members(
      id uuid primary key default extensions.gen_random_uuid(),
      tenant_id uuid not null references public.tenants(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      role text not null default 'owner'
        check (role in ('owner','admin','staff','professional','viewer')),
      email text not null,
      is_active boolean not null default true,
      unique(tenant_id,user_id)
    );

    create table public.platform_admins(
      user_id uuid not null unique references auth.users(id),
      email text not null,
      role text not null default 'super_admin'
        check (role in ('super_admin','support')),
      is_active boolean not null default true
    );

    create table public.tenant_payment_settings(
      tenant_id uuid not null unique
        references public.tenants(id) on delete cascade,
      payment_mode text not null default 'none'
        check (payment_mode in ('none','optional','required')),
      provider text not null default 'mercadopago',
      active boolean not null default false,
      payment_methods_enabled jsonb default '[]'::jsonb,
      payment_collection_mode text default 'full'
        check (payment_collection_mode in ('none','full','deposit')),
      mercadopago_public_key text,
      mercadopago_access_token text,
      webpay_commerce_code text,
      webpay_api_key text,
      webpay_environment text,
      khipu_receiver_id text,
      khipu_secret text,
      khipu_environment text,
      bank_name text,
      bank_account_type text,
      bank_account_number text,
      bank_account_holder text,
      bank_rut text,
      bank_email text
    );
    alter table public.tenant_payment_settings enable row level security;

    create table public.tenant_legal_profiles(
      tenant_id uuid primary key
        references public.tenants(id) on delete restrict,
      trade_name text,
      contact_address text,
      support_email text,
      support_phone text,
      privacy_contact_name text,
      privacy_contact_email text,
      tenant_is_service_provider boolean not null default false,
      handles_sensitive_data boolean default null,
      sensitive_data_purpose text,
      administrative_review_status text not null default 'draft'
        check (administrative_review_status in ('draft','complete')),
      created_by uuid,
      updated_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      sensitive_data_review_status text not null default 'pending'
        check (sensitive_data_review_status in ('pending','confirmed_no','confirmed_yes')),
      constraint tenant_legal_profiles_sensitive_review_shape check (
        sensitive_data_review_status='pending' or
        (sensitive_data_review_status='confirmed_no'
          and handles_sensitive_data=false and sensitive_data_purpose is null) or
        (sensitive_data_review_status='confirmed_yes'
          and handles_sensitive_data=true
          and length(trim(coalesce(sensitive_data_purpose,''))) between 10 and 1000)
      )
    );

    create table public.dte_tenant_issuance_settings(
      tenant_id uuid primary key
        references public.tenants(id) on delete restrict,
      issuance_mode text not null default 'manual'
        check (issuance_mode in ('manual','automatic_on_verified_payment')),
      consumer_document_type text not null default 'unsupported'
        check (consumer_document_type in ('39','41','unsupported')),
      invoice_on_request boolean not null default true,
      auto_email_delivery boolean not null default false,
      tax_treatment text not null default 'unconfigured'
        check (tax_treatment in ('affected','exempt','mixed','unconfigured')),
      production_enabled boolean not null default false,
      sii_authorization_status text not null default 'not_configured'
        check (sii_authorization_status in ('not_configured','pending','approved','rejected','suspended')),
      certificate_ready boolean not null default false,
      certificate_valid_to timestamptz,
      caf_ready boolean not null default false,
      folio_ready boolean not null default false,
      endpoints_ready boolean not null default false,
      storage_ready boolean not null default false,
      worker_ready boolean not null default false,
      readiness_tests_green boolean not null default false,
      last_readiness_check timestamptz,
      safe_blocking_reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deposit_tax_document_policy_status text not null default 'unconfigured'
        check (deposit_tax_document_policy_status in ('unconfigured','reviewed','enabled')),
      boleta_payment_document_model text not null default 'unconfigured'
        check (boleta_payment_document_model in ('unconfigured','always_issue_boleta','electronic_payment_voucher_as_boleta')),
      boleta_model_verified_at timestamptz,
      boleta_model_verified_by uuid,
      boleta_model_evidence_reference text
    );

    create table public.data_retention_policies(
      tenant_id uuid not null references public.tenants(id) on delete restrict,
      data_category text not null check (data_category in (
        'dte_tax_artifacts','payments_sales_contract','booking_operations',
        'marketing_evidence_suppression','technical_logs'
      )),
      legal_basis text not null check (length(trim(legal_basis)) between 3 and 500),
      minimum_calendar_years smallint check (
        minimum_calendar_years is null or minimum_calendar_years >= 0
      ),
      configured_calendar_years smallint check (
        configured_calendar_years is null or
        configured_calendar_years >= minimum_calendar_years
      ),
      disposition text not null default 'REVIEW_REQUIRED'
        check (disposition in ('RETAIN','ANONYMIZE','DELETE','REVIEW_REQUIRED')),
      automation_enabled boolean not null default false
        check (automation_enabled=false),
      review_status text not null default 'PENDING_LEGAL_ACCOUNTING_REVIEW'
        check (review_status in ('PENDING_LEGAL_ACCOUNTING_REVIEW','APPROVED')),
      updated_by uuid,
      updated_at timestamptz not null default now(),
      primary key(tenant_id,data_category),
      check (data_category <> 'dte_tax_artifacts' or minimum_calendar_years >= 6)
    );

    -- Reproduce the canonical helpers and final RLS/ACL contracts used by the
    -- repository migrations. These are fixture schema, not CIT-67 behavior.
    create function public.is_platform_admin(
      p_user_id uuid default auth.uid()
    ) returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $$
      select exists (
        select 1
        from public.platform_admins as platform_admin
        where platform_admin.user_id=p_user_id
          and platform_admin.is_active is true
          and pg_catalog.lower(platform_admin.role)='super_admin'
      )
    $$;

    create function public.is_tenant_member(
      p_tenant_id uuid,
      p_user_id uuid default auth.uid()
    ) returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $$
      select exists (
        select 1
        from public.tenant_members as member
        where member.tenant_id=p_tenant_id
          and member.user_id=p_user_id
          and member.is_active is true
          and pg_catalog.lower(member.role) in ('owner','admin')
      )
    $$;

    revoke all on function public.is_platform_admin(uuid) from public;
    revoke all on function public.is_tenant_member(uuid,uuid) from public;
    grant execute on function public.is_platform_admin(uuid),
      public.is_tenant_member(uuid,uuid) to authenticated,service_role;

    alter table public.tenant_members enable row level security;
    grant select on public.tenant_members to authenticated;
    create policy own_membership_read on public.tenant_members
      for select to authenticated
      using (user_id=auth.uid() or public.is_platform_admin());

    alter table public.tenant_legal_profiles enable row level security;
    grant select on public.tenant_legal_profiles to authenticated;
    create policy tenant_legal_profiles_member_read
      on public.tenant_legal_profiles
      for select to authenticated using (
        public.is_tenant_member(tenant_id,auth.uid()) or
        public.is_platform_admin(auth.uid())
      );

    alter table public.dte_tenant_issuance_settings enable row level security;
    grant select on public.dte_tenant_issuance_settings to authenticated;
    create policy dte_tenant_read
      on public.dte_tenant_issuance_settings
      for select to authenticated using (
        public.is_tenant_member(tenant_id) or public.is_platform_admin()
      );

    alter table public.data_retention_policies enable row level security;
    grant select on public.data_retention_policies to authenticated;
    create policy retention_policy_tenant_read
      on public.data_retention_policies
      for select to authenticated using (
        public.is_tenant_member(tenant_id,auth.uid()) or
        public.is_platform_admin(auth.uid())
      );

    revoke all on table public.tenant_payment_settings
      from public,anon,authenticated;
    grant select,insert,update on table public.tenant_payment_settings
      to service_role;
    create policy tenant_payment_settings_service_role_access
      on public.tenant_payment_settings
      for all to service_role
      using (true)
      with check (true);

    create table public.dte_production_tenant_settings(tenant_id uuid primary key);
    create table public.dte_tenant_document_capabilities(tenant_id uuid);
    create table public.tenant_payment_method_tax_policies(tenant_id uuid);
    create table public.tenant_dte_certificates_metadata(tenant_id uuid);
    create table public.dte_production_cafs(tenant_id uuid);
    create table public.dte_production_folio_ledger(tenant_id uuid);
    create table public.dte_certification_cafs(tenant_id uuid);
    create table public.dte_certification_folios(tenant_id uuid);
    create table public.tenant_self_issuer_authority_events(tenant_id uuid);
    create table public.services(tenant_id uuid);
    create table public.professionals(tenant_id uuid);
    create table public.availability(tenant_id uuid);
    create table public.customers(tenant_id uuid);
    create table public.appointments(tenant_id uuid);
    create table public.campaigns(tenant_id uuid);
    create table public.message_logs(tenant_id uuid);
  `;

  const input = [
    bootstrap,
    migration,
    readFileSync(assertionsPath, "utf8"),
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

  const failureFixtures = [
    {
      name: "missing_tenants_city",
      input: bootstrap.replace("      city text,\n", ""),
      error:
        "CIT67_SCHEMA_PREFLIGHT_FAILED: required column public.tenants.city is missing",
    },
    {
      name: "missing_tenant_members_uniqueness",
      input: bootstrap.replace(
        "      is_active boolean not null default true,\n" +
          "      unique(tenant_id,user_id)\n",
        "      is_active boolean not null default true\n",
      ),
      error:
        "CIT67_SCHEMA_PREFLIGHT_FAILED: public.tenant_members(tenant_id,user_id) requires effective uniqueness",
    },
  ];

  for (const fixture of failureFixtures) {
    assert.notEqual(fixture.input, bootstrap, `${fixture.name} fixture changed`);
    const fixtureDatabase =
      `citaya_cit67_${fixture.name}_${randomUUID().replaceAll("-", "")}`;
    const createFixture = spawnSync("docker", [
      "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", `create database ${fixtureDatabase}`,
    ], { encoding: "utf8" });
    assert.equal(createFixture.status, 0, createFixture.stderr);

    try {
      const runFixture = spawnSync("docker", [
        "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", fixtureDatabase, "-v", "ON_ERROR_STOP=1",
      ], {
        input: [fixture.input, migration].join("\n"),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      assert.notEqual(runFixture.status, 0, fixture.name);
      assert.match(
        `${runFixture.stdout}\n${runFixture.stderr}`,
        new RegExp(fixture.error.replaceAll(/[()]/g, "\\$&")),
      );

      const inspectFixture = spawnSync("docker", [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", fixtureDatabase, "-v", "ON_ERROR_STOP=1", "-At", "-c",
        "select pg_catalog.to_regclass('public.tenant_provisioning_requests') is null and pg_catalog.to_regprocedure('public.provision_tenant(uuid,uuid,uuid,text,text,text,text,text,text,text)') is null",
      ], { encoding: "utf8" });
      assert.equal(inspectFixture.status, 0, inspectFixture.stderr);
      assert.equal(inspectFixture.stdout.trim(), "t");
    } finally {
      const dropFixture = spawnSync("docker", [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1", "-c",
        `drop database if exists ${fixtureDatabase}`,
      ], { encoding: "utf8" });
      assert.equal(dropFixture.status, 0, dropFixture.stderr);
    }
  }
});
