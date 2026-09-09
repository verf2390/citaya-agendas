import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "migrations/202609090002_cit72_capability_aware_live.sql",
  "utf8",
);
const assertions = readFileSync(
  "tests/sql/cit72-capability-aware-live-assertions.sql",
  "utf8",
);

test("CIT-72 capability-aware live works in ephemeral PostgreSQL", () => {
  const database = `citaya_cit72_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync("docker", [
    "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`,
  ], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);

  const bootstrap = String.raw`
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

    create extension if not exists pgcrypto;

    create table public.tenants(
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      name text not null,
      lifecycle_status text not null default 'active',
      operational_mode text not null default 'unclassified',
      address text,
      contact_email text
    );

    create table public.platform_admins(
      user_id uuid primary key,
      role text not null,
      is_active boolean not null default true
    );

    create table public.tenant_legal_profiles(
      tenant_id uuid primary key references public.tenants(id),
      trade_name text,
      contact_address text,
      support_email text,
      support_phone text,
      privacy_contact_name text,
      privacy_contact_email text,
      tenant_is_service_provider boolean not null default false,
      handles_sensitive_data boolean,
      sensitive_data_purpose text,
      administrative_review_status text not null default 'draft',
      sensitive_data_review_status text not null default 'pending'
    );

    create table public.legal_documents(
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid references public.tenants(id),
      owner_kind text not null,
      document_type text not null,
      status text not null,
      effective_at timestamptz
    );

    create table public.services(
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references public.tenants(id),
      is_active boolean not null default true,
      payment_configuration_complete boolean not null default false,
      tax_description_review_status text,
      tax_description text,
      tax_treatment text
    );

    create table public.tenant_payment_settings(
      tenant_id uuid primary key references public.tenants(id),
      active boolean not null default false
    );

    create table public.dte_production_tenant_settings(
      tenant_id uuid primary key references public.tenants(id),
      issuer_legal_name text,
      issuer_rut text,
      issuer_address text
    );

    create table public.dte_tenant_issuance_settings(
      tenant_id uuid primary key references public.tenants(id),
      boleta_payment_document_model text not null default 'unconfigured',
      boleta_model_verified_at timestamptz,
      boleta_model_verified_by uuid
    );

    create table public.cit72_dte_state(
      tenant_id uuid primary key references public.tenants(id),
      authority_ready boolean not null default false,
      full_legal_ready boolean not null default false
    );

    create or replace function public.is_platform_admin(p_user_id uuid)
    returns boolean language sql stable security definer set search_path=''
    as $$
      select exists(
        select 1 from public.platform_admins p
        where p.user_id=p_user_id and p.role='super_admin' and p.is_active
      )
    $$;

    create or replace function public.tenant_payment_provider_readiness(p_tenant_id uuid)
    returns jsonb language sql stable security definer set search_path=''
    as $$
      select pg_catalog.jsonb_build_object(
        'ready',exists(
          select 1 from public.tenant_payment_settings s
          where s.tenant_id=p_tenant_id and s.active
        )
      )
    $$;

    create or replace function public.tenant_tax_identity_complete(p_tenant_id uuid)
    returns boolean language sql stable security definer set search_path=''
    as $$
      select exists(
        select 1 from public.dte_production_tenant_settings d
        where d.tenant_id=p_tenant_id
          and pg_catalog.length(pg_catalog.btrim(coalesce(d.issuer_legal_name,'')))>=2
          and pg_catalog.length(pg_catalog.btrim(coalesce(d.issuer_rut,'')))>=8
          and pg_catalog.length(pg_catalog.btrim(coalesce(d.issuer_address,'')))>=5
      )
    $$;

    create or replace function public.tenant_dte_authority_report(p_tenant_id uuid)
    returns jsonb language sql stable security definer set search_path=''
    as $$
      select pg_catalog.jsonb_build_object(
        'ready',coalesce((
          select s.authority_ready from public.cit72_dte_state s
          where s.tenant_id=p_tenant_id
        ),false)
      )
    $$;

    create or replace function public.tenant_legal_gate_report(p_tenant_id uuid)
    returns jsonb language sql stable security definer set search_path=''
    as $$
      select pg_catalog.jsonb_build_object(
        'ready',coalesce((
          select s.full_legal_ready from public.cit72_dte_state s
          where s.tenant_id=p_tenant_id
        ),false)
      )
    $$;

    -- Historical definitions are intentionally mode-wide. CIT-72 replaces
    -- both reports/resolver during the migration.
    create or replace function public.tenant_live_readiness_report(p_tenant_id uuid)
    returns jsonb language sql stable security definer set search_path=''
    as $$
      select pg_catalog.jsonb_build_object(
        'ready',exists(
          select 1 from public.tenants t
          where t.id=p_tenant_id and t.lifecycle_status='active'
        )
      )
    $$;

    create or replace function public.resolve_tenant_operational_capabilities(p_tenant_id uuid)
    returns jsonb language sql stable security definer set search_path=''
    as $$
      select pg_catalog.jsonb_build_object(
        'exists',true,
        'lifecycleStatus',t.lifecycle_status,
        'operationalMode',t.operational_mode,
        'createAppointment',t.operational_mode='live',
        'createPayment',t.operational_mode='live',
        'sendCampaign',t.operational_mode='live',
        'enqueueDte',t.operational_mode='live'
      ) from public.tenants t where t.id=p_tenant_id
    $$;

    create or replace function public.set_tenant_operational_mode(
      p_tenant_id uuid,p_new_mode text,p_actor_id uuid,p_reason text
    ) returns jsonb
    language plpgsql security definer set search_path=''
    as $$
    declare
      readiness jsonb;
      previous_mode text;
    begin
      if not public.is_platform_admin(p_actor_id) then
        raise exception 'PLATFORM_ADMIN_REQUIRED';
      end if;
      if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason,''))) < 10 then
        raise exception 'CLASSIFICATION_REASON_REQUIRED';
      end if;
      select operational_mode into previous_mode
      from public.tenants where id=p_tenant_id for update;
      if not found then raise exception 'TENANT_NOT_FOUND'; end if;
      readiness:=public.tenant_live_readiness_report(p_tenant_id);
      if p_new_mode='live'
         and coalesce((readiness->>'ready')::boolean,false) is not true then
        raise exception 'LIVE_TENANT_CHECKLIST_INCOMPLETE';
      end if;
      update public.tenants set operational_mode=p_new_mode where id=p_tenant_id;
      return pg_catalog.jsonb_build_object(
        'tenantId',p_tenant_id,
        'previousMode',previous_mode,
        'operationalMode',p_new_mode,
        'capabilities',public.resolve_tenant_operational_capabilities(p_tenant_id)
      );
    end;
    $$;

    insert into public.platform_admins(user_id,role,is_active)
    values ('72000000-0000-4000-8000-000000000099','super_admin',true);

    insert into public.tenants(id,slug,name,lifecycle_status,operational_mode,address,contact_email)
    values
      ('72000000-0000-4000-8000-000000000001','cit72-dte-live','CIT72 DTE Live','active','live','Dirección DTE 123','dte@example.test'),
      ('72000000-0000-4000-8000-000000000002','cit72-bhe-demo','CIT72 BHE Demo','active','demo','Dirección BHE 456','bhe@example.test');

    insert into public.tenant_legal_profiles(
      tenant_id,trade_name,contact_address,support_email,privacy_contact_name,
      privacy_contact_email,tenant_is_service_provider,handles_sensitive_data,
      administrative_review_status,sensitive_data_review_status
    ) values
      ('72000000-0000-4000-8000-000000000001','CIT72 DTE Live','Dirección DTE 123','dte@example.test','Privacidad DTE','privacy-dte@example.test',true,false,'complete','confirmed_no'),
      ('72000000-0000-4000-8000-000000000002','CIT72 BHE Demo','Dirección BHE 456','bhe@example.test','Privacidad BHE','privacy-bhe@example.test',true,false,'complete','confirmed_no');

    insert into public.legal_documents(tenant_id,owner_kind,document_type,status,effective_at)
    select tenant_id,'tenant',document_type,'published',pg_catalog.now()-interval '1 day'
    from (
      values
        ('72000000-0000-4000-8000-000000000001'::uuid,'consumer_terms'),
        ('72000000-0000-4000-8000-000000000001'::uuid,'privacy_notice'),
        ('72000000-0000-4000-8000-000000000001'::uuid,'cancellation_refund_policy'),
        ('72000000-0000-4000-8000-000000000002'::uuid,'consumer_terms'),
        ('72000000-0000-4000-8000-000000000002'::uuid,'privacy_notice'),
        ('72000000-0000-4000-8000-000000000002'::uuid,'cancellation_refund_policy')
    ) docs(tenant_id,document_type);

    insert into public.services(
      tenant_id,is_active,payment_configuration_complete,
      tax_description_review_status,tax_description,tax_treatment
    ) values
      ('72000000-0000-4000-8000-000000000001',true,true,'approved','Servicio DTE afecto','affected'),
      -- Deliberately incomplete DTE/payment fields: external BHE must not need them.
      ('72000000-0000-4000-8000-000000000002',true,false,'pending',null,null);

    insert into public.tenant_payment_settings(tenant_id,active)
    values
      ('72000000-0000-4000-8000-000000000001',true),
      ('72000000-0000-4000-8000-000000000002',false);

    insert into public.dte_production_tenant_settings(
      tenant_id,issuer_legal_name,issuer_rut,issuer_address
    ) values (
      '72000000-0000-4000-8000-000000000001','CIT72 DTE SpA','76123456-7','Dirección DTE 123'
    );

    insert into public.dte_tenant_issuance_settings(
      tenant_id,boleta_payment_document_model,boleta_model_verified_at,boleta_model_verified_by
    ) values (
      '72000000-0000-4000-8000-000000000001','always_issue_boleta',pg_catalog.now(),
      '72000000-0000-4000-8000-000000000099'
    );

    insert into public.cit72_dte_state(tenant_id,authority_ready,full_legal_ready)
    values
      ('72000000-0000-4000-8000-000000000001',true,true),
      ('72000000-0000-4000-8000-000000000002',false,false);
  `;

  try {
    const run = spawnSync("docker", [
      "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
      "-d", database, "-v", "ON_ERROR_STOP=1",
    ], {
      input: [bootstrap, migration, assertions].join("\n"),
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
