begin;

create table public.demo_professional_profiles (
  professional_id uuid primary key references public.professionals(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  rut text not null,
  role text not null check (role in ('professional', 'assistant')),
  unique (tenant_id, rut)
);

create table public.demo_professional_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null,
  professional_id uuid not null,
  professional_name text not null,
  service_name text not null,
  start_at timestamptz not null,
  simulated_amount integer not null check (simulated_amount between 1 and 999999999),
  percentage_bps integer not null check (percentage_bps between 0 and 10000),
  professional_amount integer generated always as (
    round(simulated_amount::numeric * percentage_bps / 10000)::integer
  ) stored,
  business_amount integer generated always as (
    simulated_amount - round(simulated_amount::numeric * percentage_bps / 10000)::integer
  ) stored,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, appointment_id)
);

alter table public.demo_professional_profiles enable row level security;
alter table public.demo_professional_settlements enable row level security;

revoke all on public.demo_professional_profiles, public.demo_professional_settlements
  from public, anon, authenticated, service_role;
grant select on public.demo_professional_profiles, public.demo_professional_settlements to service_role;

create function public.create_demo_settlement_professional(
  p_tenant_id uuid, p_name text, p_email text, p_rut text, p_role text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_professional_id uuid;
begin
  perform 1 from public.tenants
  where id = p_tenant_id and slug = 'demo' and lifecycle_status = 'active' and operational_mode = 'demo'
  for share;
  if not found then
    return null;
  end if;

  insert into public.professionals (tenant_id, name, active)
  values (p_tenant_id, p_name, true)
  returning id into v_professional_id;

  insert into public.demo_professional_profiles (professional_id, tenant_id, email, rut, role)
  values (v_professional_id, p_tenant_id, p_email, p_rut, p_role);

  return v_professional_id;
end;
$$;

create function public.list_demo_settlement_appointments(
  p_tenant_id uuid, p_appointment_id uuid default null
) returns table (
  id uuid, professional_id uuid, professional_name text, service_name text, start_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.id, p.id, p.name, coalesce(nullif(a.service_name, ''), s.name), a.start_at
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  join public.professionals p on p.id = a.professional_id and p.tenant_id = a.tenant_id
  left join public.services s on s.id = a.service_id and s.tenant_id = a.tenant_id
  where t.id = p_tenant_id and t.slug = 'demo' and t.lifecycle_status = 'active' and t.operational_mode = 'demo'
    and (p_appointment_id is null or a.id = p_appointment_id)
    and a.start_at is not null and p.name is not null
    and coalesce(nullif(a.service_name, ''), s.name) is not null
    and coalesce(a.status::text, '') not in ('cancelled', 'canceled', 'no_show')
    and coalesce(a.booking_status::text, '') not in ('cancelled', 'canceled', 'no_show')
    and not exists (
      select 1 from public.demo_professional_settlements d where d.tenant_id = a.tenant_id and d.appointment_id = a.id
    )
  order by a.start_at desc, a.id
  limit 100;
$$;

create function public.create_demo_professional_settlement(
  p_tenant_id uuid, p_appointment_id uuid, p_simulated_amount integer,
  p_percentage_bps integer, p_actor_id uuid
) returns setof public.demo_professional_settlements
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.tenants
  where id = p_tenant_id and slug = 'demo' and lifecycle_status = 'active' and operational_mode = 'demo'
  for share;
  if not found then
    return;
  end if;

  perform 1 from public.appointments
  where tenant_id = p_tenant_id and id = p_appointment_id
  for share;

  return query
    insert into public.demo_professional_settlements (
      tenant_id, appointment_id, professional_id, professional_name, service_name, start_at,
      simulated_amount, percentage_bps, created_by
    )
    select p_tenant_id, a.id, a.professional_id, a.professional_name, a.service_name, a.start_at,
      p_simulated_amount, p_percentage_bps, p_actor_id
    from public.list_demo_settlement_appointments(p_tenant_id, p_appointment_id) a
    on conflict (tenant_id, appointment_id) do nothing
    returning *;
end;
$$;

revoke all on function public.create_demo_settlement_professional(uuid, text, text, text, text),
  public.list_demo_settlement_appointments(uuid, uuid),
  public.create_demo_professional_settlement(uuid, uuid, integer, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_demo_settlement_professional(uuid, text, text, text, text),
  public.list_demo_settlement_appointments(uuid, uuid),
  public.create_demo_professional_settlement(uuid, uuid, integer, integer, uuid)
  to service_role;

commit;
