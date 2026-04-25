-- Flexible payments schema for Citaya.
-- Apply manually in Supabase before enabling Webpay/Khipu/manual payments.

alter table tenant_payment_settings
  add column if not exists payment_methods_enabled jsonb default '["mercadopago"]'::jsonb,
  add column if not exists payment_collection_mode text default 'full',
  add column if not exists webpay_commerce_code text null,
  add column if not exists webpay_api_key text null,
  add column if not exists webpay_environment text default 'integration',
  add column if not exists khipu_receiver_id text null,
  add column if not exists khipu_secret text null,
  add column if not exists khipu_environment text default 'development',
  add column if not exists bank_name text null,
  add column if not exists bank_account_type text null,
  add column if not exists bank_account_number text null,
  add column if not exists bank_account_holder text null,
  add column if not exists bank_rut text null,
  add column if not exists bank_email text null;

alter table appointments
  add column if not exists payment_provider text null,
  add column if not exists payment_required_amount numeric null,
  add column if not exists payment_paid_amount numeric default 0,
  add column if not exists payment_remaining_amount numeric null,
  add column if not exists payment_reference text null,
  add column if not exists payment_url text null;

alter table tenant_payment_settings
  drop constraint if exists tenant_payment_settings_payment_collection_mode_check;

alter table tenant_payment_settings
  add constraint tenant_payment_settings_payment_collection_mode_check
  check (payment_collection_mode in ('none', 'full', 'deposit'));

alter table tenant_payment_settings
  drop constraint if exists tenant_payment_settings_webpay_environment_check;

alter table tenant_payment_settings
  add constraint tenant_payment_settings_webpay_environment_check
  check (webpay_environment in ('integration', 'production'));

alter table tenant_payment_settings
  drop constraint if exists tenant_payment_settings_khipu_environment_check;

alter table tenant_payment_settings
  add constraint tenant_payment_settings_khipu_environment_check
  check (khipu_environment in ('development', 'production'));
