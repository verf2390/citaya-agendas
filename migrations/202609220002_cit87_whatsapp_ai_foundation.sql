begin;

create table if not exists public.whatsapp_tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  provider text not null default 'meta_cloud'
    check (provider = 'meta_cloud'),
  enabled boolean not null default false,
  readiness_status text not null default 'disconnected'
    check (readiness_status in ('disconnected','pending','ready','revoked','error')),
  phone_number_id text,
  waba_id text,
  business_account_id text,
  access_token_secret_ref text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone_number_id is null or length(phone_number_id) between 5 and 64),
  check (waba_id is null or length(waba_id) between 5 and 128),
  check (
    enabled = false
    or (
      readiness_status = 'ready'
      and phone_number_id is not null
      and access_token_secret_ref is not null
      and length(trim(access_token_secret_ref)) between 3 and 255
    )
  )
);

create unique index if not exists whatsapp_tenant_settings_phone_number_id_uidx
  on public.whatsapp_tenant_settings(phone_number_id)
  where phone_number_id is not null;

create table if not exists public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_key text not null check (event_key ~ '^[0-9a-f]{64}$'),
  phone_number_id text not null check (length(phone_number_id) between 5 and 64),
  provider_message_id text not null check (length(provider_message_id) between 1 and 255),
  direction text not null check (direction in ('inbound','status')),
  event_type text not null check (
    event_type in ('message','sent','delivered','read','failed')
  ),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, event_key)
);

create index if not exists whatsapp_webhook_events_tenant_created_idx
  on public.whatsapp_webhook_events(tenant_id, created_at desc);

create index if not exists whatsapp_webhook_events_provider_message_idx
  on public.whatsapp_webhook_events(tenant_id, provider_message_id);

alter table public.whatsapp_tenant_settings enable row level security;
alter table public.whatsapp_webhook_events enable row level security;

revoke all on table public.whatsapp_tenant_settings from anon, authenticated;
revoke all on table public.whatsapp_webhook_events from anon, authenticated;

grant select, insert, update, delete
  on table public.whatsapp_tenant_settings to service_role;
grant select, insert, update, delete
  on table public.whatsapp_webhook_events to service_role;

comment on table public.whatsapp_tenant_settings is
  'CIT-87 WhatsApp capability. Stores provider identifiers and a secret reference only; never the access token itself.';
comment on table public.whatsapp_webhook_events is
  'CIT-87 idempotent webhook metadata. Message bodies, customer phone numbers and provider payloads are intentionally not persisted.';

commit;
