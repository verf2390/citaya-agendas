begin;

create function public.list_demo_settlement_appointments(
  p_tenant_id uuid, p_appointment_id uuid, p_start_at timestamptz, p_end_at timestamptz
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
    and (p_start_at is null or a.start_at >= p_start_at)
    and (p_end_at is null or a.start_at < p_end_at)
    and a.start_at is not null and p.name is not null
    and coalesce(nullif(a.service_name, ''), s.name) is not null
    and coalesce(a.status::text, '') not in ('cancelled', 'canceled', 'no_show')
    and coalesce(a.booking_status::text, '') not in ('cancelled', 'canceled', 'no_show')
    and not exists (
      select 1 from public.demo_professional_settlements d where d.tenant_id = a.tenant_id and d.appointment_id = a.id
    )
  order by a.start_at desc, a.id;
$$;

revoke all on function public.list_demo_settlement_appointments(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.list_demo_settlement_appointments(uuid, uuid, timestamptz, timestamptz)
  to service_role;

-- Keep the original signature for existing callers and for the save RPC.
create or replace function public.list_demo_settlement_appointments(
  p_tenant_id uuid, p_appointment_id uuid default null
) returns table (
  id uuid, professional_id uuid, professional_name text, service_name text, start_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select *
  from public.list_demo_settlement_appointments(p_tenant_id, p_appointment_id, null, null)
  order by start_at desc, id
  limit 100;
$$;

commit;
