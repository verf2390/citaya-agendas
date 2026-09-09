-- CIT-72 preflight: read-only validation before capability-aware live migration.
-- Run against the target database BEFORE applying 202609090002_cit72_capability_aware_live.sql.
-- This script never writes data.

\set ON_ERROR_STOP on

select
  tenant.id,
  tenant.slug,
  tenant.name,
  tenant.lifecycle_status,
  tenant.operational_mode,
  public.tenant_live_readiness_report(tenant.id) as current_live_readiness
from public.tenants tenant
where tenant.lifecycle_status='active'
  and tenant.operational_mode='live'
order by tenant.slug;

do $preflight$
declare
  blockers text;
begin
  select pg_catalog.string_agg(
    pg_catalog.format(
      '%s (%s)',
      tenant.slug,
      coalesce(public.tenant_live_readiness_report(tenant.id)::text,'null')
    ),
    E'\n'
    order by tenant.slug
  )
  into blockers
  from public.tenants tenant
  where tenant.lifecycle_status='active'
    and tenant.operational_mode='live'
    and coalesce(
      (public.tenant_live_readiness_report(tenant.id)->>'ready')::boolean,
      false
    ) is not true;

  if blockers is not null then
    raise exception E'CIT72_LIVE_TRANSITION_BLOCKED:\n%', blockers;
  end if;
end;
$preflight$;

select 'CIT72_LIVE_TRANSITION_PREFLIGHT_OK' as result;
