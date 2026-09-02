-- Message logs schema for Citaya admin automations.
-- Apply manually in Supabase before relying on delivery history.

create table if not exists message_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  type text not null,
  recipient text not null,
  subject text null,
  status text not null,
  error_message text null,
  created_at timestamptz not null default now()
);

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
