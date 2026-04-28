create table if not exists public.waitlist_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  date date not null,
  time time without time zone not null,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  notes text,
  status text not null default 'active'
    check (status in ('active', 'notified', 'booked', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists waitlist_requests_slot_idx
  on public.waitlist_requests (tenant_id, service_id, date, time, status);

create unique index if not exists waitlist_requests_active_email_slot_idx
  on public.waitlist_requests (
    tenant_id,
    service_id,
    date,
    time,
    lower(customer_email)
  )
  where status = 'active';
