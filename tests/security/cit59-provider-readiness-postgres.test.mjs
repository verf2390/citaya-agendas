import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "migrations/202609010002_cit59_provider_dte_commercial_readiness.sql",
  "utf8",
);

test("CIT-59 PostgreSQL payment and live readiness are tenant-exact and fail closed", () => {
  const database = `citaya_cit59_${randomUUID().replaceAll("-", "")}`;
  const tenantId = "00000000-0000-4000-8000-000000000059";
  const historicalTenantId = "00000000-0000-4000-8000-000000000058";
  const historicalEnvironmentTenantId =
    "00000000-0000-4000-8000-000000000057";
  const create = spawnSync("docker", [
    "exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`,
  ], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);

  const bootstrap = `
    create table public.tenants(
      id uuid primary key,
      lifecycle_status text not null
    );
    create table public.tenant_payment_settings(
      tenant_id uuid primary key,
      active boolean,
      payment_mode text,
      payment_methods_enabled jsonb,
      payment_collection_mode text,
      webpay_commerce_code text,
      webpay_api_key text,
      webpay_environment text,
      updated_at timestamptz default now()
    );
    insert into public.tenant_payment_settings(
      tenant_id,active,payment_mode,payment_methods_enabled,
      payment_collection_mode,webpay_commerce_code,webpay_api_key,
      webpay_environment
    ) values(
      '${historicalTenantId}',true,'optional','["webpay"]','legacy',
      'historical-commerce','historical-key','production'
    ),(
      '${historicalEnvironmentTenantId}',true,'optional','["webpay"]','full',
      'historical-commerce','historical-key',' production '
    );
    create table public.services(
      id uuid primary key,
      tenant_id uuid not null,
      is_active boolean not null,
      payment_configuration_complete boolean not null,
      tax_description_review_status text not null,
      tax_description text,
      tax_treatment text
    );
    create table public.dte_production_tenant_settings(
      tenant_id uuid primary key,
      issuer_legal_name text,
      issuer_rut text,
      issuer_address text
    );
    create table public.dte_tenant_issuance_settings(
      tenant_id uuid primary key,
      boleta_payment_document_model text,
      boleta_model_verified_at timestamptz,
      boleta_model_verified_by uuid
    );
    create function public.tenant_legal_gate_report(uuid)
    returns jsonb language sql stable set search_path = ''
    as $$ select '{"ready":true}'::jsonb $$;
  `;

  const constraintsNotValidated = `
    do $$
    declare
      constraint_count integer;
      validated_count integer;
    begin
      select count(*), count(*) filter (where constraint_row.convalidated)
        into constraint_count, validated_count
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid =
          'public.tenant_payment_settings'::pg_catalog.regclass
        and constraint_row.conname = any(array[
          'tenant_payment_settings_payment_collection_mode_check',
          'tenant_payment_settings_webpay_environment_check',
          'tenant_payment_settings_khipu_environment_check'
        ]);
      if constraint_count <> 3 or validated_count <> 0 then
        raise exception 'CIT59_CONSTRAINTS_NOT_CREATED_AS_NOT_VALID';
      end if;
    end;
    $$;
  `;

  const validateConstraints = `
    alter table public.tenant_payment_settings validate constraint
      tenant_payment_settings_payment_collection_mode_check;
    alter table public.tenant_payment_settings validate constraint
      tenant_payment_settings_webpay_environment_check;
    alter table public.tenant_payment_settings validate constraint
      tenant_payment_settings_khipu_environment_check;
  `;

  const historicalCompatibility = `
    do $$
    declare
      report jsonb;
    begin
      report := public.tenant_payment_provider_readiness(
        '${historicalTenantId}'::uuid
      );
      if (report->>'ready')::boolean then
        raise exception 'HISTORICAL_INVALID_ENUMS_DID_NOT_FAIL_CLOSED';
      end if;

      report := public.tenant_payment_provider_readiness(
        '${historicalEnvironmentTenantId}'::uuid
      );
      if (report->>'ready')::boolean then
        raise exception 'WHITESPACE_ENVIRONMENT_DID_NOT_FAIL_CLOSED';
      end if;

      update public.tenant_payment_settings
         set payment_collection_mode='full'
       where tenant_id='${historicalTenantId}'::uuid;
      update public.tenant_payment_settings
         set webpay_environment='production'
       where tenant_id='${historicalEnvironmentTenantId}'::uuid;
      report := public.tenant_payment_provider_readiness(
        '${historicalTenantId}'::uuid
      );
      if not (report->>'ready')::boolean then
        raise exception 'REMEDIATED_HISTORICAL_SETTINGS_NOT_READY';
      end if;
      report := public.tenant_payment_provider_readiness(
        '${historicalEnvironmentTenantId}'::uuid
      );
      if not (report->>'ready')::boolean then
        raise exception 'REMEDIATED_HISTORICAL_ENVIRONMENT_NOT_READY';
      end if;
    end;
    $$;
  `;

  const constraintsValidated = `
    do $$
    declare
      constraint_count integer;
      validated_count integer;
    begin
      select count(*), count(*) filter (where constraint_row.convalidated)
        into constraint_count, validated_count
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid =
          'public.tenant_payment_settings'::pg_catalog.regclass
        and constraint_row.conname = any(array[
          'tenant_payment_settings_payment_collection_mode_check',
          'tenant_payment_settings_webpay_environment_check',
          'tenant_payment_settings_khipu_environment_check'
        ]);
      if constraint_count <> 3 or validated_count <> 3 then
        raise exception 'CIT59_VALIDATED_CONSTRAINT_STATE_WAS_DEGRADED';
      end if;
    end;
    $$;
  `;

  const assertions = `
    do $$
    declare
      tenant_id_value uuid := '${tenantId}';
      tenant_b_id uuid := '00000000-0000-4000-8000-00000000005b';
      report jsonb;
    begin
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'MISSING_SETTINGS_DID_NOT_FAIL_CLOSED';
      end if;

      insert into public.tenant_payment_settings(
        tenant_id,active,payment_mode,payment_methods_enabled,
        payment_collection_mode
      ) values(tenant_id_value,true,'optional','[]','full');
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'EMPTY_METHODS_DID_NOT_FAIL_CLOSED';
      end if;

      update public.tenant_payment_settings
         set payment_methods_enabled=null
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'NULL_METHODS_DID_NOT_FAIL_CLOSED';
      end if;

      update public.tenant_payment_settings
         set payment_methods_enabled='["unsupported"]'
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'INVALID_METHOD_DID_NOT_FAIL_CLOSED';
      end if;

      update public.tenant_payment_settings
         set payment_methods_enabled='["manual"]'
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'INCOMPLETE_MANUAL_DID_NOT_FAIL_CLOSED';
      end if;

      update public.tenant_payment_settings
         set bank_name='Banco',bank_account_type='Corriente',
             bank_account_number='123456',bank_account_holder='Comercio',
             bank_rut='78195645-7',bank_email='pagos@example.test'
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if not (report->>'ready')::boolean then
        raise exception 'CONFIGURED_MANUAL_NOT_READY';
      end if;

      update public.tenant_payment_settings
         set payment_mode='legacy'
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'INVALID_PAYMENT_MODE_DID_NOT_FAIL_CLOSED';
      end if;
      update public.tenant_payment_settings
         set payment_mode=null
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'NULL_PAYMENT_MODE_DID_NOT_FAIL_CLOSED';
      end if;
      update public.tenant_payment_settings
         set payment_mode='optional',payment_collection_mode=null
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'NULL_COLLECTION_MODE_DID_NOT_FAIL_CLOSED';
      end if;
      update public.tenant_payment_settings
         set payment_collection_mode='full'
       where tenant_id=tenant_id_value;

      update public.tenant_payment_settings
         set payment_methods_enabled='["mercadopago"]',
             mercadopago_access_token=null
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'MERCADOPAGO_WITHOUT_TOKEN_READY';
      end if;
      update public.tenant_payment_settings
         set mercadopago_access_token='   '
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'MERCADOPAGO_WITH_WHITESPACE_TOKEN_READY';
      end if;
      update public.tenant_payment_settings
         set mercadopago_access_token='test-token'
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if not (report->>'ready')::boolean then
        raise exception 'MERCADOPAGO_WITH_TOKEN_NOT_READY';
      end if;

      insert into public.tenant_payment_settings(
        tenant_id,active,payment_mode,payment_methods_enabled,
        payment_collection_mode
      ) values(tenant_b_id,true,'optional','["mercadopago"]','full');
      report := public.tenant_payment_provider_readiness(tenant_b_id);
      if (report->>'ready')::boolean then
        raise exception 'TENANT_B_INHERITED_TENANT_A_CREDENTIALS';
      end if;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if not (report->>'ready')::boolean then
        raise exception 'TENANT_A_LOST_OWN_CREDENTIAL_READINESS';
      end if;

      update public.tenant_payment_settings
         set payment_methods_enabled='["webpay"]',
             webpay_commerce_code=null,webpay_api_key=null,
             webpay_environment='integration'
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'WEBPAY_WITHOUT_CREDENTIALS_READY';
      end if;

      update public.tenant_payment_settings
         set payment_methods_enabled='["khipu"]',
             khipu_receiver_id=null,khipu_secret=null,
             khipu_environment='development'
       where tenant_id=tenant_id_value;
      report := public.tenant_payment_provider_readiness(tenant_id_value);
      if (report->>'ready')::boolean then
        raise exception 'KHIPU_WITHOUT_CREDENTIALS_READY';
      end if;

      insert into public.tenants(id,lifecycle_status)
      values(tenant_id_value,'active');
      insert into public.services(
        id,tenant_id,is_active,payment_configuration_complete,
        tax_description_review_status,tax_description,tax_treatment
      ) values(
        '00000000-0000-4000-8000-000000000159',tenant_id_value,true,true,
        'approved','Servicio','affected'
      );
      insert into public.dte_production_tenant_settings(
        tenant_id,issuer_legal_name,issuer_rut,issuer_address
      ) values(tenant_id_value,'R&G SPA','78195645-7','Dirección comercial');
      insert into public.dte_tenant_issuance_settings(
        tenant_id,boleta_payment_document_model,boleta_model_verified_at,
        boleta_model_verified_by
      ) values(
        tenant_id_value,'always_issue_boleta',now(),
        '00000000-0000-4000-8000-000000000259'
      );

      update public.tenant_payment_settings
         set payment_methods_enabled='["manual"]'
       where tenant_id=tenant_id_value;
      report := public.tenant_live_readiness_report(tenant_id_value);
      if not (report->>'paymentProviderReady')::boolean
         or not (report->>'ready')::boolean then
        raise exception 'LIVE_REPORT_REJECTED_CONFIGURED_MANUAL';
      end if;

      update public.tenant_payment_settings
         set payment_methods_enabled='["manual","mercadopago"]',
             mercadopago_access_token=null
       where tenant_id=tenant_id_value;
      report := public.tenant_live_readiness_report(tenant_id_value);
      if (report->>'paymentProviderReady')::boolean
         or (report->>'ready')::boolean then
        raise exception 'LIVE_REPORT_ACCEPTED_INCOMPLETE_ENABLED_PROVIDER';
      end if;
    end;
    $$;
  `;

  try {
    const run = spawnSync("docker", [
      "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
      "-d", database, "-v", "ON_ERROR_STOP=1",
    ], {
      input: [
        bootstrap,
        migration,
        constraintsNotValidated,
        migration,
        constraintsNotValidated,
        historicalCompatibility,
        validateConstraints,
        constraintsValidated,
        migration,
        constraintsValidated,
        assertions,
      ].join("\n"),
      encoding: "utf8",
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

test("CIT-59 migration cannot classify tenants, emit DTEs, or consume folios", () => {
  assert.match(migration, /tenant_payment_provider_readiness/);
  assert.match(migration, /tenant_live_readiness_report/);
  assert.doesNotMatch(
    migration,
    /update\s+public\.tenants|operational_mode\s*=|set_tenant_operational_mode\s*\(/i,
  );
  assert.doesNotMatch(
    migration,
    /reserve.*folio|dte_enqueue|finalize_verified_payment|sii|caf/i,
  );
});
