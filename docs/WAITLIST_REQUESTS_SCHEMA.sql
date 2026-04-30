create table if not exists public.waitlist_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete set null,
  date date not null,
  time time without time zone not null,
  desired_from_at timestamptz,
  desired_to_at timestamptz,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  notes text,
  source text not null default 'booking_flow',
  status text not null default 'active'
    check (status in ('active', 'notified', 'booked', 'expired', 'deleted')),
  notified_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Safe additive migration for existing installations.
alter table public.waitlist_requests
  add column if not exists professional_id uuid references public.professionals(id) on delete set null,
  add column if not exists desired_from_at timestamptz,
  add column if not exists desired_to_at timestamptz,
  add column if not exists source text not null default 'booking_flow',
  add column if not exists notified_at timestamptz,
  add column if not exists deleted_at timestamptz;

-- If the table already exists with the old status check, replace it manually in Supabase:
-- alter table public.waitlist_requests drop constraint if exists waitlist_requests_status_check;
-- alter table public.waitlist_requests add constraint waitlist_requests_status_check
--   check (status in ('active', 'notified', 'booked', 'expired', 'deleted'));

create index if not exists waitlist_requests_slot_idx
  on public.waitlist_requests (tenant_id, service_id, date, time, status);

create index if not exists waitlist_requests_range_idx
  on public.waitlist_requests (tenant_id, service_id, desired_from_at, desired_to_at, status)
  where deleted_at is null;

create unique index if not exists waitlist_requests_active_email_slot_idx
  on public.waitlist_requests (
    tenant_id,
    service_id,
    date,
    time,
    lower(customer_email)
  )
  where status = 'active';

-- Keep public clients going through the Next.js API/service role.
-- Admin reads/writes should also go through tenant-scoped API routes.
alter table public.waitlist_requests enable row level security;
