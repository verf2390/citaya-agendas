-- Message logs schema for Citaya admin automations.
-- Apply manually in Supabase before relying on delivery history.

create table if not exists message_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  type text not null,
  recipient text not null,
  recipient_name text null,
  subject text null,
  headline text null,
  status text not null,
  error_message text null,
  campaign_id uuid null,
  template_key text null,
  segment_key text null,
  channel text null default 'email',
  media_type text null default 'none',
  recipient_count integer null,
  metadata jsonb null,
  created_at timestamptz not null default now()
);

alter table message_logs
  add column if not exists recipient_name text null;

alter table message_logs
  add column if not exists headline text null;

alter table message_logs
  add column if not exists campaign_id uuid null;

alter table message_logs
  add column if not exists template_key text null;

alter table message_logs
  add column if not exists segment_key text null;

alter table message_logs
  add column if not exists channel text null default 'email';

alter table message_logs
  add column if not exists media_type text null default 'none';

alter table message_logs
  add column if not exists recipient_count integer null;

alter table message_logs
  add column if not exists metadata jsonb null;

alter table message_logs
  drop constraint if exists message_logs_type_check;

alter table message_logs
  add constraint message_logs_type_check
  check (type in ('payment_resend', 'campaign'));

alter table message_logs
  drop constraint if exists message_logs_status_check;

alter table message_logs
  add constraint message_logs_status_check
  check (status in ('sent', 'error'));

create index if not exists message_logs_tenant_created_at_idx
  on message_logs (tenant_id, created_at desc);

create index if not exists message_logs_type_created_at_idx
  on message_logs (type, created_at desc);

create index if not exists message_logs_campaign_id_idx
  on message_logs (campaign_id);
