-- Platform admins foundation for Citaya.
-- Goal: allow internal Citaya admins/support users to access any tenant
-- without adding them to tenant_members for every business.
--
-- Important separation:
-- - platform_admins = Citaya internal platform access.
-- - tenant_members = users that administer one specific tenant.
-- Do not hardcode platform admin emails in TypeScript.

-- 1) Create table if it does not exist yet.
create table if not exists public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'super_admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Upgrade old/partial table structure safely.
alter table public.platform_admins
  add column if not exists id uuid default gen_random_uuid();

alter table public.platform_admins
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.platform_admins
  add column if not exists email text;

alter table public.platform_admins
  add column if not exists role text not null default 'super_admin';

alter table public.platform_admins
  add column if not exists is_active boolean not null default true;

alter table public.platform_admins
  add column if not exists created_at timestamptz not null default now();

alter table public.platform_admins
  add column if not exists updated_at timestamptz not null default now();

alter table public.platform_admins
  alter column id set default gen_random_uuid();

alter table public.platform_admins
  alter column role set default 'super_admin';

alter table public.platform_admins
  alter column is_active set default true;

alter table public.platform_admins
  alter column created_at set default now();

alter table public.platform_admins
  alter column updated_at set default now();

-- 3) Backfill required fields for legacy rows.
update public.platform_admins
set id = gen_random_uuid()
where id is null;

update public.platform_admins
set role = 'super_admin'
where role is null
  or trim(role) = ''
  or role not in ('super_admin', 'support');

update public.platform_admins
set is_active = true
where is_active is null;

update public.platform_admins
set created_at = now()
where created_at is null;

update public.platform_admins
set updated_at = now()
where updated_at is null;

-- 4) Backfill email from auth.users where possible.
update public.platform_admins pa
set email = lower(u.email)
from auth.users u
where pa.user_id = u.id
  and (pa.email is null or trim(pa.email) = '');

-- 5) Fallback for legacy rows without email.
update public.platform_admins
set email = user_id::text || '@missing-email.local'
where email is null or trim(email) = '';

alter table public.platform_admins
  alter column id set not null;

alter table public.platform_admins
  alter column user_id set not null;

alter table public.platform_admins
  alter column email set not null;

alter table public.platform_admins
  alter column role set not null;

alter table public.platform_admins
  alter column is_active set not null;

alter table public.platform_admins
  alter column created_at set not null;

alter table public.platform_admins
  alter column updated_at set not null;

-- 6) Primary key constraint.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_admins_pkey'
      and conrelid = 'public.platform_admins'::regclass
  ) then
    alter table public.platform_admins
      add constraint platform_admins_pkey
      primary key (id);
  end if;
end $$;

-- 7) Role constraint.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_admins_role_check'
      and conrelid = 'public.platform_admins'::regclass
  ) then
    alter table public.platform_admins
      add constraint platform_admins_role_check
      check (role in ('super_admin', 'support'));
  end if;
end $$;

-- 8) Auth user foreign key constraint.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_admins_user_id_fkey'
      and conrelid = 'public.platform_admins'::regclass
  ) then
    alter table public.platform_admins
      add constraint platform_admins_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end $$;

-- 9) Unique user constraint.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_admins_user_id_unique'
      and conrelid = 'public.platform_admins'::regclass
  ) then
    alter table public.platform_admins
      add constraint platform_admins_user_id_unique
      unique (user_id);
  end if;
end $$;

-- 10) Indexes.
create index if not exists platform_admins_user_id_idx
  on public.platform_admins(user_id);

create index if not exists platform_admins_email_idx
  on public.platform_admins(lower(email));

create index if not exists platform_admins_active_role_idx
  on public.platform_admins(user_id, role)
  where is_active = true;

-- 11) updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists platform_admins_set_updated_at on public.platform_admins;

create trigger platform_admins_set_updated_at
before update on public.platform_admins
for each row
execute function public.set_updated_at();

-- 12) Enable RLS.
alter table public.platform_admins enable row level security;

-- Users may only read their own platform_admins record from the client.
-- Do not create a client policy that can list all platform admins.
drop policy if exists "platform_admins_select_own_record" on public.platform_admins;

create policy "platform_admins_select_own_record"
on public.platform_admins
for select
to authenticated
using (
  user_id = auth.uid()
);

-- 13) Initial backfill example.
-- Replace TU_CORREO_ADMIN_AQUI before running manually in Supabase SQL editor.
--
-- insert into public.platform_admins (user_id, email, role, is_active)
-- select id, lower(email), 'super_admin', true
-- from auth.users
-- where lower(email) = lower('TU_CORREO_ADMIN_AQUI')
-- on conflict (user_id) do update set
--   email = excluded.email,
--   role = excluded.role,
--   is_active = true,
--   updated_at = now();

-- Verification:
-- select id, user_id, email, role, is_active, created_at, updated_at
-- from public.platform_admins
-- order by role, email;
