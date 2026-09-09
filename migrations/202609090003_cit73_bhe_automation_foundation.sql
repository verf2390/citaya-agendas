begin;

-- CIT-73 foundation: model the official SII mass-BHE authorization path
-- without inventing transport details, credentials, endpoints or formats.
-- Automatic execution remains fail-closed until the taxpayer has completed
-- the SII authorization/certification process and Citaya has the official
-- technical specification required for that taxpayer.

create table if not exists public.tenant_bhe_automation_settings (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  automation_mode text not null default 'external_manual'
    check (automation_mode in ('external_manual','sii_mass_webservice')),
  authorization_status text not null default 'not_configured'
    check (authorization_status in (
      'not_configured','ineligible','eligible_unapplied','application_pending',
      'certification','authorized','suspended','revoked'
    )),
  eligibility_basis text not null default 'not_assessed'
    check (eligibility_basis in (
      'not_assessed','volume_300_plus','simultaneity_case','sii_authorized_other'
    )),
  average_monthly_bhe integer
    check (average_monthly_bhe is null or average_monthly_bhe >= 0),
  evidence_period_months smallint
    check (evidence_period_months is null or evidence_period_months between 1 and 24),
  eligibility_evidence_reference text,
  form_2117_reference text,
  certification_reference text,
  sii_authorization_reference text,
  provider_included_in_certification boolean not null default false,
  ws_spec_received boolean not null default false,
  credentials_configured boolean not null default false,
  worker_ready boolean not null default false,
  automation_enabled boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by uuid,
  constraint tenant_bhe_volume_evidence_shape check (
    eligibility_basis <> 'volume_300_plus'
    or (
      average_monthly_bhe >= 300
      and evidence_period_months = 6
      and pg_catalog.length(pg_catalog.btrim(coalesce(eligibility_evidence_reference,''))) between 3 and 300
    )
  ),
  constraint tenant_bhe_simultaneity_evidence_shape check (
    eligibility_basis <> 'simultaneity_case'
    or pg_catalog.length(pg_catalog.btrim(coalesce(eligibility_evidence_reference,''))) between 3 and 300
  ),
  constraint tenant_bhe_authorized_shape check (
    authorization_status <> 'authorized'
    or (
      automation_mode = 'sii_mass_webservice'
      and pg_catalog.length(pg_catalog.btrim(coalesce(form_2117_reference,''))) between 3 and 300
      and pg_catalog.length(pg_catalog.btrim(coalesce(certification_reference,''))) between 3 and 300
      and pg_catalog.length(pg_catalog.btrim(coalesce(sii_authorization_reference,''))) between 3 and 300
    )
  ),
  constraint tenant_bhe_automation_enablement_shape check (
    not automation_enabled
    or (
      automation_mode = 'sii_mass_webservice'
      and authorization_status = 'authorized'
      and provider_included_in_certification
      and ws_spec_received
      and credentials_configured
      and worker_ready
    )
  )
);

alter table public.tenant_bhe_automation_settings enable row level security;
revoke all on table public.tenant_bhe_automation_settings from public, anon, authenticated;
grant select,insert,update on table public.tenant_bhe_automation_settings to service_role;

drop policy if exists tenant_bhe_automation_settings_service_role
  on public.tenant_bhe_automation_settings;
create policy tenant_bhe_automation_settings_service_role
  on public.tenant_bhe_automation_settings
  for all to service_role using (true) with check (true);

create table if not exists public.tenant_bhe_automation_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  actor_user_id uuid not null,
  reason text not null check (pg_catalog.length(pg_catalog.btrim(reason)) between 10 and 500),
  previous_settings jsonb not null,
  new_settings jsonb not null,
  occurred_at timestamptz not null default pg_catalog.now()
);

alter table public.tenant_bhe_automation_audit enable row level security;
revoke all on table public.tenant_bhe_automation_audit from public, anon, authenticated;
grant select,insert on table public.tenant_bhe_automation_audit to service_role;

drop policy if exists tenant_bhe_automation_audit_service_role
  on public.tenant_bhe_automation_audit;
create policy tenant_bhe_automation_audit_service_role
  on public.tenant_bhe_automation_audit
  for all to service_role using (true) with check (true);

create or replace function public.ensure_tenant_bhe_automation_settings()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.tenant_bhe_automation_settings(tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tenants_bhe_automation_default on public.tenants;
create trigger tenants_bhe_automation_default
after insert on public.tenants
for each row execute function public.ensure_tenant_bhe_automation_settings();

insert into public.tenant_bhe_automation_settings(tenant_id)
select tenant.id from public.tenants tenant
on conflict (tenant_id) do nothing;

create or replace function public.tenant_bhe_automation_readiness(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with settings as (
    select * from public.tenant_bhe_automation_settings where tenant_id=p_tenant_id
  )
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
    'automationEnabled',coalesce(settings.automation_enabled,false),
    'ready',coalesce(
      settings.automation_enabled
      and settings.automation_mode='sii_mass_webservice'
      and settings.authorization_status='authorized'
      and settings.provider_included_in_certification
      and settings.ws_spec_received
      and settings.credentials_configured
      and settings.worker_ready,
      false
    )
  )
  from settings right join (select 1) singleton on true;
$$;

revoke all on function public.tenant_bhe_automation_readiness(uuid)
  from public,anon,authenticated;
grant execute on function public.tenant_bhe_automation_readiness(uuid)
  to service_role;

comment on table public.tenant_bhe_automation_settings is
  'CIT-73 fail-closed SII mass-BHE authorization/certification state. Contains no transport secrets.';
comment on function public.tenant_bhe_automation_readiness(uuid) is
  'Reports whether SII mass-BHE automation is explicitly authorized, technically configured and enabled.';

commit;
