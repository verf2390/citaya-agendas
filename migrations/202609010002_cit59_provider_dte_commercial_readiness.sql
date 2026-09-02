begin;

-- Keep the historical flexible-payment schema reproducible. Existing values
-- are preserved; new rows default to no enabled method instead of implicitly
-- enabling an unconfigured provider.
alter table public.tenant_payment_settings
  add column if not exists mercadopago_public_key text,
  add column if not exists mercadopago_access_token text,
  add column if not exists payment_methods_enabled jsonb default '[]'::jsonb,
  add column if not exists payment_collection_mode text default 'none',
  add column if not exists webpay_commerce_code text,
  add column if not exists webpay_api_key text,
  add column if not exists webpay_environment text default 'integration',
  add column if not exists khipu_receiver_id text,
  add column if not exists khipu_secret text,
  add column if not exists khipu_environment text default 'development',
  add column if not exists bank_name text,
  add column if not exists bank_account_type text,
  add column if not exists bank_account_number text,
  add column if not exists bank_account_holder text,
  add column if not exists bank_rut text,
  add column if not exists bank_email text;

alter table public.tenant_payment_settings
  alter column payment_methods_enabled set default '[]'::jsonb;

alter table public.tenant_payment_settings
  drop constraint if exists tenant_payment_settings_payment_collection_mode_check;
alter table public.tenant_payment_settings
  add constraint tenant_payment_settings_payment_collection_mode_check
  check (payment_collection_mode in ('none', 'full', 'deposit')) not valid;

alter table public.tenant_payment_settings
  drop constraint if exists tenant_payment_settings_webpay_environment_check;
alter table public.tenant_payment_settings
  add constraint tenant_payment_settings_webpay_environment_check
  check (webpay_environment in ('integration', 'production')) not valid;

alter table public.tenant_payment_settings
  drop constraint if exists tenant_payment_settings_khipu_environment_check;
alter table public.tenant_payment_settings
  add constraint tenant_payment_settings_khipu_environment_check
  check (khipu_environment in ('development', 'production')) not valid;

create or replace function public.tenant_payment_provider_readiness(
  p_tenant_id uuid
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with raw_settings as (
    select
      settings.active,
      settings.payment_mode,
      settings.payment_collection_mode,
      case
        when pg_catalog.jsonb_typeof(settings.payment_methods_enabled) = 'array'
          then settings.payment_methods_enabled
        else '[]'::jsonb
      end as methods,
      pg_catalog.jsonb_typeof(settings.payment_methods_enabled) = 'array'
        as methods_are_array,
      settings.mercadopago_access_token,
      settings.webpay_commerce_code,
      settings.webpay_api_key,
      settings.webpay_environment,
      settings.khipu_receiver_id,
      settings.khipu_secret,
      settings.khipu_environment,
      settings.bank_name,
      settings.bank_account_type,
      settings.bank_account_number,
      settings.bank_account_holder,
      settings.bank_rut,
      settings.bank_email
    from public.tenant_payment_settings settings
    where settings.tenant_id = p_tenant_id
  ), evaluated as (
    select
      true as settings_found,
      coalesce(raw_settings.active, false) as active,
      coalesce(
        raw_settings.payment_mode in ('optional', 'required'),
        false
      ) as mode_valid,
      coalesce(
        raw_settings.payment_collection_mode in ('full', 'deposit'),
        false
      ) as collection_mode_valid,
      raw_settings.methods_are_array
        and pg_catalog.jsonb_array_length(raw_settings.methods) > 0
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(raw_settings.methods) item(value)
          where pg_catalog.jsonb_typeof(item.value) <> 'string'
             or item.value #>> '{}' not in (
               'manual', 'mercadopago', 'webpay', 'khipu'
             )
        ) as methods_valid,
      raw_settings.methods ? 'manual' as manual_enabled,
      raw_settings.methods ? 'mercadopago' as mercadopago_enabled,
      raw_settings.methods ? 'webpay' as webpay_enabled,
      raw_settings.methods ? 'khipu' as khipu_enabled,
      coalesce(
        nullif(
          pg_catalog.btrim(raw_settings.mercadopago_access_token),
          ''
        ) is not null,
        false
      ) as mercadopago_configured,
      coalesce(
        nullif(pg_catalog.btrim(raw_settings.webpay_commerce_code), '')
          is not null
          and nullif(pg_catalog.btrim(raw_settings.webpay_api_key), '')
            is not null
          and raw_settings.webpay_environment in ('integration', 'production'),
        false
      ) as webpay_configured,
      coalesce(
        nullif(pg_catalog.btrim(raw_settings.khipu_receiver_id), '')
          is not null
          and nullif(pg_catalog.btrim(raw_settings.khipu_secret), '')
            is not null
          and raw_settings.khipu_environment in ('development', 'production'),
        false
      ) as khipu_configured,
      coalesce(
        nullif(pg_catalog.btrim(raw_settings.bank_name), '') is not null
          and nullif(pg_catalog.btrim(raw_settings.bank_account_type), '')
            is not null
          and nullif(pg_catalog.btrim(raw_settings.bank_account_number), '')
            is not null
          and nullif(pg_catalog.btrim(raw_settings.bank_account_holder), '')
            is not null
          and nullif(pg_catalog.btrim(raw_settings.bank_rut), '') is not null
          and nullif(pg_catalog.btrim(raw_settings.bank_email), '') is not null,
        false
      ) as manual_configured
    from raw_settings
  ), result as (
    select
      evaluated.*,
      evaluated.settings_found
        and evaluated.active
        and evaluated.mode_valid
        and evaluated.collection_mode_valid
        and evaluated.methods_valid
        and (not evaluated.manual_enabled or evaluated.manual_configured)
        and (
          not evaluated.mercadopago_enabled
          or evaluated.mercadopago_configured
        )
        and (not evaluated.webpay_enabled or evaluated.webpay_configured)
        and (not evaluated.khipu_enabled or evaluated.khipu_configured)
        as ready
    from evaluated
  )
  select coalesce(
    (
      select pg_catalog.jsonb_build_object(
        'settingsFound', result.settings_found,
        'active', result.active,
        'methodsValid', result.methods_valid,
        'ready', result.ready,
        'methods', pg_catalog.jsonb_build_object(
          'manual', pg_catalog.jsonb_build_object(
            'enabled', result.manual_enabled,
            'configured', result.manual_configured,
            'ready', result.manual_enabled and result.manual_configured
          ),
          'mercadopago', pg_catalog.jsonb_build_object(
            'enabled', result.mercadopago_enabled,
            'configured', result.mercadopago_configured,
            'ready', result.mercadopago_enabled
              and result.mercadopago_configured
          ),
          'webpay', pg_catalog.jsonb_build_object(
            'enabled', result.webpay_enabled,
            'configured', result.webpay_configured,
            'ready', result.webpay_enabled and result.webpay_configured
          ),
          'khipu', pg_catalog.jsonb_build_object(
            'enabled', result.khipu_enabled,
            'configured', result.khipu_configured,
            'ready', result.khipu_enabled and result.khipu_configured
          )
        )
      )
      from result
    ),
    pg_catalog.jsonb_build_object(
      'settingsFound', false,
      'active', false,
      'methodsValid', false,
      'ready', false,
      'methods', pg_catalog.jsonb_build_object(
        'manual', pg_catalog.jsonb_build_object(
          'enabled', false, 'configured', false, 'ready', false
        ),
        'mercadopago', pg_catalog.jsonb_build_object(
          'enabled', false, 'configured', false, 'ready', false
        ),
        'webpay', pg_catalog.jsonb_build_object(
          'enabled', false, 'configured', false, 'ready', false
        ),
        'khipu', pg_catalog.jsonb_build_object(
          'enabled', false, 'configured', false, 'ready', false
        )
      )
    )
  );
$$;

revoke all on function public.tenant_payment_provider_readiness(uuid)
  from public, anon, authenticated;
grant execute on function public.tenant_payment_provider_readiness(uuid)
  to service_role;

create or replace function public.tenant_live_readiness_report(
  p_tenant_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with facts as (
    select
      exists(
        select 1 from public.tenants tenant
        where tenant.id = p_tenant_id
          and tenant.lifecycle_status = 'active'
      ) as active,
      coalesce(
        (public.tenant_legal_gate_report(p_tenant_id) ->> 'ready')::boolean,
        false
      ) as legal_ready,
      exists(
        select 1 from public.services service
        where service.tenant_id = p_tenant_id and service.is_active
      ) as active_services,
      not exists(
        select 1 from public.services service
        where service.tenant_id = p_tenant_id
          and service.is_active
          and (
            not service.payment_configuration_complete
            or service.tax_description_review_status <> 'approved'
            or pg_catalog.length(
              pg_catalog.btrim(coalesce(service.tax_description, ''))
            ) < 2
            or service.tax_treatment is null
          )
      ) as services_ready,
      coalesce(
        (
          public.tenant_payment_provider_readiness(p_tenant_id)
          ->> 'ready'
        )::boolean,
        false
      ) as payment_provider_ready,
      exists(
        select 1 from public.dte_production_tenant_settings production
        where production.tenant_id = p_tenant_id
          and pg_catalog.length(
            pg_catalog.btrim(coalesce(production.issuer_legal_name, ''))
          ) > 1
          and pg_catalog.length(
            pg_catalog.btrim(coalesce(production.issuer_rut, ''))
          ) > 7
          and pg_catalog.length(
            pg_catalog.btrim(coalesce(production.issuer_address, ''))
          ) > 2
      ) as tax_identity_ready,
      exists(
        select 1 from public.dte_tenant_issuance_settings issuance
        where issuance.tenant_id = p_tenant_id
          and issuance.boleta_payment_document_model <> 'unconfigured'
          and issuance.boleta_model_verified_at is not null
          and issuance.boleta_model_verified_by is not null
      ) as boleta_model_ready
  )
  select pg_catalog.jsonb_build_object(
    'active', facts.active,
    'legalReady', facts.legal_ready,
    'activeServices', facts.active_services,
    'servicesReady', facts.services_ready,
    'paymentProviderReady', facts.payment_provider_ready,
    'taxIdentityReady', facts.tax_identity_ready,
    'boletaModelReady', facts.boleta_model_ready,
    'ready', facts.active
      and facts.legal_ready
      and facts.active_services
      and facts.services_ready
      and facts.payment_provider_ready
      and facts.tax_identity_ready
      and facts.boleta_model_ready
  )
  from facts;
$$;

revoke all on function public.tenant_live_readiness_report(uuid)
  from public, anon, authenticated;
grant execute on function public.tenant_live_readiness_report(uuid)
  to service_role;

-- set_tenant_operational_mode remains unchanged: promotion to live still
-- requires an explicit platform-admin action and consumes this stricter report.

commit;
