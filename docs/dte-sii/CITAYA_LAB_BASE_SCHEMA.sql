-- Citaya LAB base schema for DTE/SII certification sandbox.
-- LAB / PENDIENTE / NO PRODUCTIVO.
-- Apply manually ONLY in an empty Supabase LAB/certification project before DTE_SUPABASE_MIGRATION.sql.
-- This schema is intentionally minimal and does not activate legal invoicing, SII submit,
-- agenda/payment automation, production DTE, secrets storage, private keys, CAF XML or tokens.

create extension if not exists pgcrypto;

create or replace function public.citaya_lab_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  admin_email text,
  contact_email text,
  phone_display text,
  whatsapp text,
  logo_url text,
  description text,
  address text,
  city text,
  min_lead_time_min integer not null default 0 check (min_lead_time_min >= 0),
  show_address boolean not null default true,
  show_phone boolean not null default true,
  show_address_home boolean not null default true,
  show_phone_home boolean not null default true,
  show_address_after_booking boolean not null default true,
  show_phone_after_booking boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slug = lower(slug)),
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

comment on table public.tenants is
  'Citaya LAB minimal tenants table for DTE/SII certification sandbox. NO PRODUCTIVO.';
comment on column public.tenants.admin_email is
  'Legacy/contact email used by existing admin flows. Not an authorization source for DTE.';

create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff', 'viewer', 'professional')),
  is_active boolean not null default true,
  -- Compatibility alias for current DTE migration/readiness guards. is_active is canonical in this LAB schema.
  active boolean generated always as (is_active) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

comment on table public.tenant_members is
  'Citaya LAB tenant membership table for admin authorization tests. DTE permits owner/admin only.';
comment on column public.tenant_members.is_active is
  'Canonical LAB membership enabled flag. Generated active column exists only for compatibility.';

create table if not exists public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  role text not null default 'support' check (role in ('support', 'admin', 'owner')),
  is_active boolean not null default true,
  -- Compatibility alias for current DTE migration/readiness guards. is_active is canonical in this LAB schema.
  active boolean generated always as (is_active) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Citaya LAB platform support/admin table for DTE trace support tests. NO PRODUCTIVO.';

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customers is
  'Citaya LAB minimal customers table for DTE references and admin/customer views. NO PRODUCTIVO.';

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  professional_id uuid,
  service_id uuid,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  customer_email text,
  customer_phone text,
  service_name text,
  start_at timestamptz,
  end_at timestamptz,
  status text not null default 'confirmed',
  booking_status text not null default 'confirmed',
  payment_status text default 'not_required',
  payment_provider text,
  payment_required boolean not null default false,
  payment_required_amount numeric,
  payment_paid_amount numeric not null default 0,
  payment_remaining_amount numeric,
  payment_reference text,
  payment_url text,
  manage_token text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('confirmed', 'pending', 'pending_payment', 'cancelled', 'canceled', 'completed')),
  check (booking_status in ('confirmed', 'pending', 'pending_payment', 'cancelled', 'canceled', 'completed')),
  check (payment_status is null or payment_status in ('not_required', 'pending', 'pending_payment', 'paid', 'failed', 'refunded', 'pay_later')),
  check (payment_required_amount is null or payment_required_amount >= 0),
  check (payment_paid_amount >= 0),
  check (payment_remaining_amount is null or payment_remaining_amount >= 0)
);

comment on table public.appointments is
  'Citaya LAB minimal appointments table for DTE/payment reference tests. Does not activate real agenda automation.';
comment on column public.appointments.professional_id is
  'Nullable UUID reference placeholder. No FK in LAB base schema because professionals table is outside this DTE bootstrap.';
comment on column public.appointments.service_id is
  'Nullable UUID reference placeholder. No FK in LAB base schema because services table is outside this DTE bootstrap.';

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  external_reference text,
  amount numeric not null default 0 check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'canceled', 'refunded')),
  provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payments is
  'Citaya LAB minimal payments table for DTE references. Does not activate payment collection or real agenda/payment integration.';

create index if not exists tenants_slug_idx on public.tenants (slug);
create index if not exists tenant_members_tenant_id_idx on public.tenant_members (tenant_id);
create index if not exists tenant_members_user_id_idx on public.tenant_members (user_id);
create index if not exists platform_admins_user_id_idx on public.platform_admins (user_id);
create index if not exists customers_tenant_id_idx on public.customers (tenant_id);
create index if not exists appointments_tenant_id_idx on public.appointments (tenant_id);
create index if not exists appointments_tenant_start_idx on public.appointments (tenant_id, start_at);
create index if not exists appointments_customer_id_idx on public.appointments (customer_id);
create index if not exists payments_tenant_id_idx on public.payments (tenant_id);
create index if not exists payments_appointment_id_idx on public.payments (appointment_id);
create index if not exists payments_external_reference_idx on public.payments (tenant_id, external_reference);

drop trigger if exists trg_citaya_lab_tenants_updated_at on public.tenants;
create trigger trg_citaya_lab_tenants_updated_at
  before update on public.tenants
  for each row execute function public.citaya_lab_set_updated_at();

drop trigger if exists trg_citaya_lab_tenant_members_updated_at on public.tenant_members;
create trigger trg_citaya_lab_tenant_members_updated_at
  before update on public.tenant_members
  for each row execute function public.citaya_lab_set_updated_at();

drop trigger if exists trg_citaya_lab_platform_admins_updated_at on public.platform_admins;
create trigger trg_citaya_lab_platform_admins_updated_at
  before update on public.platform_admins
  for each row execute function public.citaya_lab_set_updated_at();

drop trigger if exists trg_citaya_lab_customers_updated_at on public.customers;
create trigger trg_citaya_lab_customers_updated_at
  before update on public.customers
  for each row execute function public.citaya_lab_set_updated_at();

drop trigger if exists trg_citaya_lab_appointments_updated_at on public.appointments;
create trigger trg_citaya_lab_appointments_updated_at
  before update on public.appointments
  for each row execute function public.citaya_lab_set_updated_at();

drop trigger if exists trg_citaya_lab_payments_updated_at on public.payments;
create trigger trg_citaya_lab_payments_updated_at
  before update on public.payments
  for each row execute function public.citaya_lab_set_updated_at();

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.platform_admins enable row level security;
alter table public.customers enable row level security;
alter table public.appointments enable row level security;
alter table public.payments enable row level security;

create or replace function public.citaya_lab_current_user_is_tenant_member(row_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = row_tenant_id
      and tm.user_id = auth.uid()
      and tm.is_active = true
  );
$$;

create or replace function public.citaya_lab_current_user_is_tenant_admin(row_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = row_tenant_id
      and tm.user_id = auth.uid()
      and tm.is_active = true
      and tm.role in ('owner', 'admin')
  );
$$;

create or replace function public.citaya_lab_current_user_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.is_active = true
      and pa.role in ('support', 'admin', 'owner')
  );
$$;

-- Basic read policies for LAB/certification. Service role bypasses RLS for controlled server-side API tests.
drop policy if exists tenants_select_lab_members on public.tenants;
create policy tenants_select_lab_members on public.tenants
  for select using (
    public.citaya_lab_current_user_is_tenant_member(id)
    or public.citaya_lab_current_user_is_platform_admin()
  );

drop policy if exists tenant_members_select_self_or_admin on public.tenant_members;
create policy tenant_members_select_self_or_admin on public.tenant_members
  for select using (
    user_id = auth.uid()
    or public.citaya_lab_current_user_is_tenant_admin(tenant_id)
    or public.citaya_lab_current_user_is_platform_admin()
  );

drop policy if exists platform_admins_select_self on public.platform_admins;
create policy platform_admins_select_self on public.platform_admins
  for select using (user_id = auth.uid());

drop policy if exists customers_select_lab_members on public.customers;
create policy customers_select_lab_members on public.customers
  for select using (
    public.citaya_lab_current_user_is_tenant_member(tenant_id)
    or public.citaya_lab_current_user_is_platform_admin()
  );

drop policy if exists appointments_select_lab_members on public.appointments;
create policy appointments_select_lab_members on public.appointments
  for select using (
    public.citaya_lab_current_user_is_tenant_member(tenant_id)
    or public.citaya_lab_current_user_is_platform_admin()
  );

drop policy if exists payments_select_lab_members on public.payments;
create policy payments_select_lab_members on public.payments
  for select using (
    public.citaya_lab_current_user_is_tenant_member(tenant_id)
    or public.citaya_lab_current_user_is_platform_admin()
  );

-- No direct client writes in LAB base schema. Use Supabase SQL editor for seed data or server-side service role APIs.
drop policy if exists tenants_no_client_insert on public.tenants;
create policy tenants_no_client_insert on public.tenants for insert with check (false);
drop policy if exists tenants_no_client_update on public.tenants;
create policy tenants_no_client_update on public.tenants for update using (false) with check (false);
drop policy if exists tenant_members_no_client_insert on public.tenant_members;
create policy tenant_members_no_client_insert on public.tenant_members for insert with check (false);
drop policy if exists tenant_members_no_client_update on public.tenant_members;
create policy tenant_members_no_client_update on public.tenant_members for update using (false) with check (false);
drop policy if exists platform_admins_no_client_insert on public.platform_admins;
create policy platform_admins_no_client_insert on public.platform_admins for insert with check (false);
drop policy if exists platform_admins_no_client_update on public.platform_admins;
create policy platform_admins_no_client_update on public.platform_admins for update using (false) with check (false);
drop policy if exists customers_no_client_insert on public.customers;
create policy customers_no_client_insert on public.customers for insert with check (false);
drop policy if exists customers_no_client_update on public.customers;
create policy customers_no_client_update on public.customers for update using (false) with check (false);
drop policy if exists appointments_no_client_insert on public.appointments;
create policy appointments_no_client_insert on public.appointments for insert with check (false);
drop policy if exists appointments_no_client_update on public.appointments;
create policy appointments_no_client_update on public.appointments for update using (false) with check (false);
drop policy if exists payments_no_client_insert on public.payments;
create policy payments_no_client_insert on public.payments for insert with check (false);
drop policy if exists payments_no_client_update on public.payments;
create policy payments_no_client_update on public.payments for update using (false) with check (false);
