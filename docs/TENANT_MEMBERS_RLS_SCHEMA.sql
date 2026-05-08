-- Tenant members / roles foundation for Citaya.
-- Goal: stop depending only on tenants.admin_email for admin authorization.
-- This migration is safe for an existing tenant_members table.

-- 1) Create table if it does not exist yet.
create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

-- 2) Upgrade old table structure.
alter table public.tenant_members
  add column if not exists email text;

alter table public.tenant_members
  add column if not exists is_active boolean not null default true;

alter table public.tenant_members
  add column if not exists updated_at timestamptz not null default now();

-- 3) Backfill email from auth.users.
update public.tenant_members tm
set email = lower(u.email)
from auth.users u
where tm.user_id = u.id
  and (tm.email is null or trim(tm.email) = '');

-- 4) Fallback for any legacy row without email.
update public.tenant_members
set email = user_id::text || '@missing-email.local'
where email is null or trim(email) = '';

alter table public.tenant_members
  alter column email set not null;

-- 5) Role constraint.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_members_role_check'
      and conrelid = 'public.tenant_members'::regclass
  ) then
    alter table public.tenant_members
      add constraint tenant_members_role_check
      check (role in ('owner', 'admin', 'staff', 'professional', 'viewer'));
  end if;
end $$;

-- 6) Unique tenant/user constraint.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_members_tenant_user_unique'
      and conrelid = 'public.tenant_members'::regclass
  ) then
    alter table public.tenant_members
      add constraint tenant_members_tenant_user_unique
      unique (tenant_id, user_id);
  end if;
end $$;

-- 7) Indexes.
create index if not exists tenant_members_tenant_id_idx
  on public.tenant_members(tenant_id);

create index if not exists tenant_members_user_id_idx
  on public.tenant_members(user_id);

create index if not exists tenant_members_email_idx
  on public.tenant_members(lower(email));

create index if not exists tenant_members_active_role_idx
  on public.tenant_members(tenant_id, user_id, role)
  where is_active = true;

-- 8) updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenant_members_set_updated_at on public.tenant_members;

create trigger tenant_members_set_updated_at
before update on public.tenant_members
for each row
execute function public.set_updated_at();

-- 9) Enable RLS only on tenant_members.
alter table public.tenant_members enable row level security;

-- Important:
-- Avoid same-table lookup policies here because they can trigger infinite
-- recursion in Postgres/Supabase.
-- Admin/staff management should go through server-side API routes using
-- supabaseAdmin + requireTenantAdmin.

drop policy if exists "tenant_members_select_own_memberships" on public.tenant_members;
drop policy if exists "tenant_members_select_same_tenant_admins" on public.tenant_members;

create policy "tenant_members_select_own_memberships"
on public.tenant_members
for select
to authenticated
using (
  user_id = auth.uid()
);

-- 10) Backfill owners from tenants.admin_email where auth user exists.
insert into public.tenant_members (
  tenant_id,
  user_id,
  email,
  role,
  is_active
)
select
  t.id as tenant_id,
  u.id as user_id,
  lower(trim(t.admin_email)) as email,
  'owner' as role,
  true as is_active
from public.tenants t
join auth.users u
  on lower(u.email) = lower(trim(t.admin_email))
where coalesce(trim(t.admin_email), '') <> ''
on conflict (tenant_id, user_id)
do update set
  email = excluded.email,
  role = case
    when public.tenant_members.role in ('owner', 'admin') then public.tenant_members.role
    else excluded.role
  end,
  is_active = true,
  updated_at = now();

-- Verification:
-- select tm.id, t.slug, t.name, tm.user_id, tm.email, tm.role, tm.is_active, tm.created_at, tm.updated_at
-- from public.tenant_members tm
-- join public.tenants t on t.id = tm.tenant_id
-- order by t.slug, tm.role, tm.email;
