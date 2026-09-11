begin;

-- Phase 1B composes legacy prerequisites with the canonical authority report.
-- Keep 007's ready key as an alias of effectiveReady; its resolver is unchanged.
-- No data writes, authority backfill or execution enablement.
create or replace function public.tenant_bhe_automation_readiness(p_tenant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  with settings as (
    select * from public.tenant_bhe_automation_settings where tenant_id=p_tenant_id
  ), foundation as (
    -- Preserve 003's diagnostic fields and exact legacy prerequisite conjunction.
    -- Even legacy authorization/enablement flags are prerequisites, never authority.
    select pg_catalog.jsonb_build_object(
      'configured',coalesce(settings.authorization_status,'not_configured')<>'not_configured',
      'mode',coalesce(settings.automation_mode,'external_manual'),
      'authorizationStatus',coalesce(settings.authorization_status,'not_configured'),
      'eligibilityBasis',coalesce(settings.eligibility_basis,'not_assessed'),
      'eligibleForApplication',case
        when settings.eligibility_basis='volume_300_plus' then
          coalesce(settings.average_monthly_bhe,0)>=300
          and settings.evidence_period_months=6
          and pg_catalog.length(pg_catalog.btrim(coalesce(settings.eligibility_evidence_reference,''))) between 3 and 300
        when settings.eligibility_basis='simultaneity_case' then
          pg_catalog.length(pg_catalog.btrim(coalesce(settings.eligibility_evidence_reference,''))) between 3 and 300
        when settings.eligibility_basis='sii_authorized_other' then true
        else false
      end,
      'siiAuthorized',coalesce(settings.authorization_status='authorized',false),
      'providerCertified',coalesce(settings.provider_included_in_certification,false),
      'technicalSpecReceived',coalesce(settings.ws_spec_received,false),
      'credentialsConfigured',coalesce(settings.credentials_configured,false),
      'workerReady',coalesce(settings.worker_ready,false),
      'automationEnabled',coalesce(settings.automation_enabled,false)
    ) as diagnostics,
    coalesce(settings.automation_enabled
      and settings.automation_mode='sii_mass_webservice'
      and settings.authorization_status='authorized'
      and settings.provider_included_in_certification
      and settings.ws_spec_received and settings.credentials_configured and settings.worker_ready,false) as ready
    from settings right join (select 1) singleton on true
  ), authority as materialized (
    -- Direct operational callers use service_role. Indirect capability guards
    -- can run under other session roles: no internal authority report is exposed
    -- in that context, and only BHE readiness closes, preserving other capabilities.
    select case when pg_catalog.current_setting('role',true)='service_role'
      then public.tenant_bhe_authority_report(p_tenant_id) else null::jsonb end as report
  ), gates as (
    select foundation.diagnostics,foundation.ready as foundation_ready,
      coalesce(authority.report @> '{"controlReady":true,"issuerVerified":true,"authorizationActive":true,"evidenceComplete":true}'::jsonb
        and case when pg_catalog.jsonb_typeof(authority.report->'generation')='number' then
          (authority.report->>'generation')::numeric>0
          and (authority.report->>'generation')::numeric=pg_catalog.trunc((authority.report->>'generation')::numeric)
        else false end,false) as authority_control_ready,
      coalesce(authority.report @> '{"executionEnabled":true,"requiresExplicitEnablement":false}'::jsonb,false)
        as authority_execution_enabled
    from foundation cross join authority
  )
  select diagnostics || pg_catalog.jsonb_build_object(
    'foundationReady',foundation_ready,
    'authorityControlReady',authority_control_ready,
    'authorityExecutionEnabled',authority_execution_enabled,
    'effectiveReady',foundation_ready and authority_control_ready and authority_execution_enabled,
    'ready',foundation_ready and authority_control_ready and authority_execution_enabled
  ) from gates;
$$;

-- 009 already grants service_role SELECT on settings and EXECUTE on the report.
-- This composition needs no definer privileges and grants no new surface.
revoke all on function public.tenant_bhe_automation_readiness(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.tenant_bhe_automation_readiness(uuid) to service_role;

comment on function public.tenant_bhe_automation_readiness(uuid) is
  'Read-only legacy foundation AND canonical authority control AND authority execution enablement. ready aliases effectiveReady for 007. Phase 1B cannot enable execution: 009 reports executionEnabled=false.';

commit;
