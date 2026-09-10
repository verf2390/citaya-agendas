begin;

-- CIT-72 phase 1: live means "real operation", not "every Citaya feature".
-- Feature use is explicit and fail-closed per tenant. DTE and payments remain
-- independently disabled unless the platform profile enables them and their
-- own readiness gates are satisfied.

create table if not exists public.tenant_operational_features (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  appointments_enabled boolean not null default false,
  appointment_communications_enabled boolean not null default false,
  external_communications_enabled boolean not null default false,
  campaigns_enabled boolean not null default false,
  payments_enabled boolean not null default false,
  dte_enabled boolean not null default false,
  tax_document_mode text not null default 'unconfigured'
    check (tax_document_mode in ('unconfigured','citaya_dte','external_bhe')),
  tax_mode_verified_at timestamptz,
  tax_mode_verified_by uuid,
  tax_mode_evidence_reference text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by uuid,
  constraint tenant_operational_features_campaign_requires_external
    check (not campaigns_enabled or external_communications_enabled),
  constraint tenant_operational_features_appointment_comm_requires_agenda
    check (not appointment_communications_enabled or appointments_enabled),
  constraint tenant_operational_features_dte_mode_shape
    check (
      (dte_enabled and tax_document_mode='citaya_dte')
      or (not dte_enabled and tax_document_mode<>'citaya_dte')
    ),
  constraint tenant_operational_features_external_bhe_review_shape
    check (
      tax_document_mode<>'external_bhe'
      or (
        dte_enabled=false
        and tax_mode_verified_at is not null
        and tax_mode_verified_by is not null
        and pg_catalog.length(pg_catalog.btrim(coalesce(tax_mode_evidence_reference,''))) between 3 and 300
      )
    )
);

create table if not exists public.tenant_operational_features_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  actor_user_id uuid not null,
  reason text not null check (pg_catalog.length(pg_catalog.btrim(reason)) between 10 and 500),
  previous_settings jsonb not null,
  new_settings jsonb not null,
  occurred_at timestamptz not null default pg_catalog.now()
);

alter table public.tenant_operational_features enable row level security;
alter table public.tenant_operational_features_audit enable row level security;

revoke all on table public.tenant_operational_features from public, anon, authenticated;
revoke all on table public.tenant_operational_features_audit from public, anon, authenticated;
grant select, insert, update on table public.tenant_operational_features to service_role;
grant select, insert on table public.tenant_operational_features_audit to service_role;

drop policy if exists tenant_operational_features_service_role
  on public.tenant_operational_features;
create policy tenant_operational_features_service_role
  on public.tenant_operational_features
  for all to service_role using (true) with check (true);

drop policy if exists tenant_operational_features_audit_service_role
  on public.tenant_operational_features_audit;
create policy tenant_operational_features_audit_service_role
  on public.tenant_operational_features_audit
  for all to service_role using (true) with check (true);

-- Every future tenant receives a fail-closed feature profile, including tenants
-- created through provision_tenant(). This avoids coupling CIT-67 to this schema.
create or replace function public.ensure_tenant_operational_features()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.tenant_operational_features(tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tenants_operational_features_default on public.tenants;
create trigger tenants_operational_features_default
after insert on public.tenants
for each row execute function public.ensure_tenant_operational_features();

insert into public.tenant_operational_features(tenant_id)
select tenant.id from public.tenants tenant
on conflict (tenant_id) do nothing;

-- Preserve existing live tenants exactly as they operated before CIT-72.
-- New/non-live tenants remain fail-closed until explicitly configured.
update public.tenant_operational_features features
set appointments_enabled=true,
    appointment_communications_enabled=true,
    external_communications_enabled=true,
    campaigns_enabled=true,
    payments_enabled=true,
    dte_enabled=true,
    tax_document_mode='citaya_dte',
    updated_at=pg_catalog.now()
from public.tenants tenant
where tenant.id=features.tenant_id
  and tenant.lifecycle_status='active'
  and tenant.operational_mode='live';

-- Core legal readiness intentionally excludes DTE identity/authority. Those
-- belong to the citaya_dte tax-document capability, not to generic live agenda.
create or replace function public.tenant_core_legal_gate_report(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with facts as (
    select
      exists(
        select 1
        from public.tenant_legal_profiles profile
        join public.tenants tenant on tenant.id=profile.tenant_id
        where profile.tenant_id=p_tenant_id
          and profile.administrative_review_status='complete'
          and profile.tenant_is_service_provider
          and profile.sensitive_data_review_status in ('confirmed_no','confirmed_yes')
          and (
            (profile.sensitive_data_review_status='confirmed_no' and profile.handles_sensitive_data=false)
            or (
              profile.sensitive_data_review_status='confirmed_yes'
              and profile.handles_sensitive_data=true
              and pg_catalog.length(pg_catalog.btrim(coalesce(profile.sensitive_data_purpose,'')))>=10
            )
          )
          and pg_catalog.length(pg_catalog.btrim(coalesce(profile.trade_name,tenant.name,'')))>=2
          and pg_catalog.length(pg_catalog.btrim(coalesce(profile.contact_address,tenant.address,'')))>=5
          and pg_catalog.length(pg_catalog.btrim(coalesce(profile.support_email,tenant.contact_email,'')))>=3
          and pg_catalog.length(pg_catalog.btrim(coalesce(profile.privacy_contact_name,'')))>=3
          and pg_catalog.length(pg_catalog.btrim(coalesce(profile.privacy_contact_email,'')))>=3
      ) as identity_legal_complete,
      exists(
        select 1 from public.legal_documents document
        where document.tenant_id=p_tenant_id and document.owner_kind='tenant'
          and document.document_type='consumer_terms' and document.status='published'
          and document.effective_at<=pg_catalog.now()
      ) as terms_published,
      exists(
        select 1 from public.legal_documents document
        where document.tenant_id=p_tenant_id and document.owner_kind='tenant'
          and document.document_type='privacy_notice' and document.status='published'
          and document.effective_at<=pg_catalog.now()
      ) as privacy_published,
      exists(
        select 1 from public.legal_documents document
        where document.tenant_id=p_tenant_id and document.owner_kind='tenant'
          and document.document_type='cancellation_refund_policy' and document.status='published'
          and document.effective_at<=pg_catalog.now()
      ) as cancellation_published,
      coalesce((
        select profile.sensitive_data_review_status<>'pending'
        from public.tenant_legal_profiles profile where profile.tenant_id=p_tenant_id
      ),false) as sensitive_reviewed,
      coalesce((
        select case profile.sensitive_data_review_status
          when 'confirmed_no' then true
          when 'confirmed_yes' then exists(
            select 1 from public.legal_documents document
            where document.tenant_id=p_tenant_id and document.owner_kind='tenant'
              and document.document_type='sensitive_data_authorization'
              and document.status='published' and document.effective_at<=pg_catalog.now()
          )
          else false end
        from public.tenant_legal_profiles profile where profile.tenant_id=p_tenant_id
      ),false) as sensitive_consent_configured
  )
  select pg_catalog.jsonb_build_object(
    'identityLegalComplete',facts.identity_legal_complete,
    'termsPublished',facts.terms_published,
    'privacyPublished',facts.privacy_published,
    'cancellationRefundPublished',facts.cancellation_published,
    'sensitiveDataReviewed',facts.sensitive_reviewed,
    'sensitiveConsentConfigured',facts.sensitive_consent_configured,
    'ready',facts.identity_legal_complete
      and facts.terms_published
      and facts.privacy_published
      and facts.cancellation_published
      and facts.sensitive_reviewed
      and facts.sensitive_consent_configured
  ) from facts;
$$;

create or replace function public.tenant_tax_document_readiness(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with feature as (
    select * from public.tenant_operational_features where tenant_id=p_tenant_id
  ), dte as (
    select
      public.tenant_tax_identity_complete(p_tenant_id) as tax_identity_ready,
      coalesce((public.tenant_dte_authority_report(p_tenant_id)->>'ready')::boolean,false) as authority_ready,
      exists(
        select 1 from public.dte_tenant_issuance_settings issuance
        where issuance.tenant_id=p_tenant_id
          and issuance.boleta_payment_document_model<>'unconfigured'
          and issuance.boleta_model_verified_at is not null
          and issuance.boleta_model_verified_by is not null
      ) as boleta_model_ready,
      coalesce((public.tenant_legal_gate_report(p_tenant_id)->>'ready')::boolean,false) as full_dte_legal_ready
  )
  select pg_catalog.jsonb_build_object(
    'mode',coalesce(feature.tax_document_mode,'unconfigured'),
    'configured',coalesce(feature.tax_document_mode,'unconfigured')<>'unconfigured',
    'externalBheVerified',coalesce(
      feature.tax_document_mode='external_bhe'
      and feature.tax_mode_verified_at is not null
      and feature.tax_mode_verified_by is not null
      and pg_catalog.length(pg_catalog.btrim(coalesce(feature.tax_mode_evidence_reference,''))) between 3 and 300,
      false
    ),
    'taxIdentityReady',dte.tax_identity_ready,
    'dteAuthorityReady',dte.authority_ready,
    'boletaModelReady',dte.boleta_model_ready,
    'fullDteLegalReady',dte.full_dte_legal_ready,
    'ready',case coalesce(feature.tax_document_mode,'unconfigured')
      when 'external_bhe' then
        feature.tax_mode_verified_at is not null
        and feature.tax_mode_verified_by is not null
        and pg_catalog.length(pg_catalog.btrim(coalesce(feature.tax_mode_evidence_reference,''))) between 3 and 300
        and feature.dte_enabled=false
      when 'citaya_dte' then
        feature.dte_enabled
        and dte.tax_identity_ready
        and dte.authority_ready
        and dte.boleta_model_ready
        and dte.full_dte_legal_ready
      else false
    end
  )
  from feature right join dte on true;
$$;

create or replace function public.tenant_live_readiness_report(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with feature as (
    select * from public.tenant_operational_features where tenant_id=p_tenant_id
  ), facts as (
    select
      exists(
        select 1 from public.tenants tenant
        where tenant.id=p_tenant_id and tenant.lifecycle_status='active'
      ) as active,
      coalesce((public.tenant_core_legal_gate_report(p_tenant_id)->>'ready')::boolean,false)
        as core_legal_ready,
      coalesce((public.tenant_legal_gate_report(p_tenant_id)->>'ready')::boolean,false)
        as full_dte_legal_ready,
      exists(
        select 1 from public.services service
        where service.tenant_id=p_tenant_id and service.is_active
      ) as active_services,
      not exists(
        select 1 from public.services service
        where service.tenant_id=p_tenant_id and service.is_active
          and (
            (coalesce(feature.payments_enabled,false) and not service.payment_configuration_complete)
            or (
              coalesce(feature.tax_document_mode,'unconfigured')='citaya_dte'
              and (
                service.tax_description_review_status<>'approved'
                or pg_catalog.length(pg_catalog.btrim(coalesce(service.tax_description,'')))<2
                or service.tax_treatment is null
              )
            )
          )
      ) as services_ready,
      coalesce((public.tenant_payment_provider_readiness(p_tenant_id)->>'ready')::boolean,false)
        as payment_provider_ready,
      public.tenant_tax_identity_complete(p_tenant_id) as tax_identity_ready,
      exists(
        select 1 from public.dte_tenant_issuance_settings issuance
        where issuance.tenant_id=p_tenant_id
          and issuance.boleta_payment_document_model<>'unconfigured'
          and issuance.boleta_model_verified_at is not null
          and issuance.boleta_model_verified_by is not null
      ) as boleta_model_ready,
      coalesce((public.tenant_tax_document_readiness(p_tenant_id)->>'ready')::boolean,false)
        as tax_document_ready
    from feature right join (select 1) singleton on true
  ), evaluated as (
    select facts.*,
      coalesce(feature.appointments_enabled,false) as appointments_enabled,
      coalesce(feature.payments_enabled,false) as payments_required,
      coalesce(feature.dte_enabled,false) as dte_required,
      coalesce(feature.tax_document_mode,'unconfigured') as tax_document_mode,
      facts.core_legal_ready
        and (
          coalesce(feature.tax_document_mode,'unconfigured')<>'citaya_dte'
          or facts.full_dte_legal_ready
        ) as legal_ready,
      (not coalesce(feature.payments_enabled,false) or facts.payment_provider_ready)
        as payment_gate_ready
    from facts
    left join feature on true
  )
  select pg_catalog.jsonb_build_object(
    'active',evaluated.active,
    'legalReady',evaluated.legal_ready,
    'coreLegalReady',evaluated.core_legal_ready,
    'activeServices',evaluated.active_services,
    'servicesReady',evaluated.services_ready,
    'appointmentsEnabled',evaluated.appointments_enabled,
    'paymentsRequired',evaluated.payments_required,
    'paymentProviderReady',evaluated.payment_provider_ready,
    'paymentGateReady',evaluated.payment_gate_ready,
    'dteRequired',evaluated.dte_required,
    'taxDocumentMode',evaluated.tax_document_mode,
    'taxDocumentReady',evaluated.tax_document_ready,
    'taxIdentityReady',evaluated.tax_identity_ready,
    'boletaModelReady',evaluated.boleta_model_ready,
    'ready',evaluated.active
      and evaluated.legal_ready
      and evaluated.active_services
      and evaluated.services_ready
      and evaluated.appointments_enabled
      and evaluated.payment_gate_ready
      and evaluated.tax_document_ready
  ) from evaluated;
$$;

-- DB capability resolver becomes authoritative for privileged server paths.
-- Demo/internal keep their historical narrow behavior. Live derives each
-- feature from tenant_operational_features and current readiness.
create or replace function public.resolve_tenant_operational_capabilities(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with state as (
    select tenant.lifecycle_status, tenant.operational_mode
    from public.tenants tenant where tenant.id=p_tenant_id
  ), feature as (
    select * from public.tenant_operational_features where tenant_id=p_tenant_id
  ), live_gates as (
    select
      coalesce((public.tenant_core_legal_gate_report(p_tenant_id)->>'ready')::boolean,false) as core_legal_ready,
      coalesce((public.tenant_payment_provider_readiness(p_tenant_id)->>'ready')::boolean,false) as payment_ready,
      coalesce((public.tenant_tax_document_readiness(p_tenant_id)->>'ready')::boolean,false) as tax_document_ready
  )
  select case
    when not exists(select 1 from state) then
      pg_catalog.jsonb_build_object('exists',false,'allowed',false)
    when (select lifecycle_status from state)='archived' then
      pg_catalog.jsonb_build_object(
        'exists',true,'lifecycleStatus','archived','operationalMode',(select operational_mode from state),
        'informationalPage',false,'demoSimulation',false,'createAppointment',false,
        'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
        'appointmentOperationalCommunication',false,'sendExternalEmail',false,'sendCampaign',false,
        'callExternalAutomation',false,'enqueueDte',false,'manualDteEnqueue',false,
        'runDteWorker',false,'publicTaxDocument',false,'taxAdministration',false,
        'dteCertification',false,'ordinaryAdmin',false,'exceptionalPlatformAccess',true,
        'classificationAdmin',true)
    when (select lifecycle_status from state)<>'active' then
      pg_catalog.jsonb_build_object(
        'exists',true,'lifecycleStatus',(select lifecycle_status from state),
        'operationalMode',(select operational_mode from state),
        'informationalPage',false,'demoSimulation',false,'createAppointment',false,
        'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
        'appointmentOperationalCommunication',false,'sendExternalEmail',false,'sendCampaign',false,
        'callExternalAutomation',false,'enqueueDte',false,'manualDteEnqueue',false,
        'runDteWorker',false,'publicTaxDocument',false,'taxAdministration',false,
        'dteCertification',false,'ordinaryAdmin',false,'exceptionalPlatformAccess',false,
        'classificationAdmin',true)
    when (select operational_mode from state)='demo' then
      pg_catalog.jsonb_build_object(
        'exists',true,'lifecycleStatus','active','operationalMode','demo',
        'informationalPage',true,'demoSimulation',true,'createAppointment',true,
        'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
        'appointmentOperationalCommunication',true,'sendExternalEmail',false,'sendCampaign',false,
        'callExternalAutomation',false,'enqueueDte',false,'manualDteEnqueue',false,
        'runDteWorker',false,'publicTaxDocument',false,'taxAdministration',false,
        'dteCertification',false,'ordinaryAdmin',true,'exceptionalPlatformAccess',false,
        'classificationAdmin',false)
    when (select operational_mode from state)='live' then
      pg_catalog.jsonb_build_object(
        'exists',true,'lifecycleStatus','active','operationalMode','live',
        'informationalPage',true,'demoSimulation',false,
        'createAppointment',coalesce(feature.appointments_enabled,false) and live_gates.core_legal_ready,
        'createPayment',coalesce(feature.payments_enabled,false) and live_gates.payment_ready,
        'confirmTransfer',coalesce(feature.payments_enabled,false) and live_gates.payment_ready,
        'acceptPaymentWebhook',coalesce(feature.payments_enabled,false) and live_gates.payment_ready,
        'appointmentOperationalCommunication',coalesce(feature.appointments_enabled,false)
          and coalesce(feature.appointment_communications_enabled,false) and live_gates.core_legal_ready,
        'sendExternalEmail',coalesce(feature.external_communications_enabled,false) and live_gates.core_legal_ready,
        'sendCampaign',coalesce(feature.campaigns_enabled,false)
          and coalesce(feature.external_communications_enabled,false) and live_gates.core_legal_ready,
        'callExternalAutomation',(
          coalesce(feature.appointment_communications_enabled,false)
          or coalesce(feature.external_communications_enabled,false)
        ) and live_gates.core_legal_ready,
        'enqueueDte',coalesce(feature.dte_enabled,false) and live_gates.tax_document_ready,
        'manualDteEnqueue',coalesce(feature.dte_enabled,false) and live_gates.tax_document_ready,
        'runDteWorker',coalesce(feature.dte_enabled,false) and live_gates.tax_document_ready,
        'publicTaxDocument',coalesce(feature.dte_enabled,false) and live_gates.tax_document_ready,
        'taxAdministration',coalesce(feature.dte_enabled,false) and live_gates.tax_document_ready,
        'dteCertification',false,'ordinaryAdmin',true,'exceptionalPlatformAccess',false,
        'classificationAdmin',false)
    when (select operational_mode from state)='internal' then
      pg_catalog.jsonb_build_object(
        'exists',true,'lifecycleStatus','active','operationalMode','internal',
        'informationalPage',true,'demoSimulation',false,'createAppointment',false,
        'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
        'appointmentOperationalCommunication',false,'sendExternalEmail',false,'sendCampaign',false,
        'callExternalAutomation',false,'enqueueDte',false,'manualDteEnqueue',true,
        'runDteWorker',false,'publicTaxDocument',false,'taxAdministration',true,
        'dteCertification',true,'ordinaryAdmin',true,'exceptionalPlatformAccess',false,
        'classificationAdmin',false)
    else
      pg_catalog.jsonb_build_object(
        'exists',true,'lifecycleStatus',(select lifecycle_status from state),'operationalMode','unclassified',
        'informationalPage',true,'demoSimulation',false,'createAppointment',false,
        'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
        'appointmentOperationalCommunication',false,'sendExternalEmail',false,'sendCampaign',false,
        'callExternalAutomation',false,'enqueueDte',false,'manualDteEnqueue',false,
        'runDteWorker',false,'publicTaxDocument',false,'taxAdministration',false,
        'dteCertification',false,'ordinaryAdmin',false,'exceptionalPlatformAccess',false,
        'classificationAdmin',true)
  end
  from state
  right join (select 1) singleton on true
  left join feature on true
  cross join live_gates;
$$;

create or replace function public.set_tenant_operational_features(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_appointments_enabled boolean,
  p_appointment_communications_enabled boolean,
  p_external_communications_enabled boolean,
  p_campaigns_enabled boolean,
  p_payments_enabled boolean,
  p_dte_enabled boolean,
  p_tax_document_mode text,
  p_tax_mode_evidence_reference text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  tenant_row public.tenants%rowtype;
  previous_row public.tenant_operational_features%rowtype;
  updated_row public.tenant_operational_features%rowtype;
  post_readiness jsonb;
begin
  if not public.is_platform_admin(p_actor_id) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'FEATURE_CHANGE_REASON_REQUIRED';
  end if;
  if p_tax_document_mode not in ('unconfigured','citaya_dte','external_bhe') then
    raise exception 'TAX_DOCUMENT_MODE_INVALID';
  end if;
  if p_campaigns_enabled and not p_external_communications_enabled then
    raise exception 'CAMPAIGNS_REQUIRE_EXTERNAL_COMMUNICATIONS';
  end if;
  if p_appointment_communications_enabled and not p_appointments_enabled then
    raise exception 'APPOINTMENT_COMMUNICATIONS_REQUIRE_APPOINTMENTS';
  end if;
  if p_dte_enabled is distinct from (p_tax_document_mode='citaya_dte') then
    raise exception 'DTE_FEATURE_TAX_MODE_MISMATCH';
  end if;
  if p_tax_document_mode='external_bhe'
      and pg_catalog.length(pg_catalog.btrim(coalesce(p_tax_mode_evidence_reference,''))) not between 3 and 300 then
    raise exception 'EXTERNAL_BHE_EVIDENCE_REQUIRED';
  end if;

  select * into tenant_row from public.tenants where id=p_tenant_id for update;
  if not found then raise exception 'TENANT_NOT_FOUND'; end if;
  if tenant_row.lifecycle_status='archived' then raise exception 'USE_OFFBOARDING_FOR_ARCHIVED_TENANT'; end if;

  insert into public.tenant_operational_features(tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  select * into previous_row
  from public.tenant_operational_features
  where tenant_id=p_tenant_id
  for update;

  update public.tenant_operational_features
  set appointments_enabled=p_appointments_enabled,
      appointment_communications_enabled=p_appointment_communications_enabled,
      external_communications_enabled=p_external_communications_enabled,
      campaigns_enabled=p_campaigns_enabled,
      payments_enabled=p_payments_enabled,
      dte_enabled=p_dte_enabled,
      tax_document_mode=p_tax_document_mode,
      tax_mode_verified_at=case when p_tax_document_mode='external_bhe' then pg_catalog.now() else null end,
      tax_mode_verified_by=case when p_tax_document_mode='external_bhe' then p_actor_id else null end,
      tax_mode_evidence_reference=case
        when p_tax_document_mode='external_bhe' then pg_catalog.btrim(p_tax_mode_evidence_reference)
        else null end,
      updated_at=pg_catalog.now(),
      updated_by=p_actor_id
  where tenant_id=p_tenant_id
  returning * into updated_row;

  post_readiness:=public.tenant_live_readiness_report(p_tenant_id);
  if tenant_row.operational_mode='live'
      and coalesce((post_readiness->>'ready')::boolean,false) is not true then
    raise exception 'LIVE_TENANT_FEATURE_CHANGE_NOT_READY';
  end if;

  insert into public.tenant_operational_features_audit(
    tenant_id,actor_user_id,reason,previous_settings,new_settings
  ) values (
    p_tenant_id,p_actor_id,pg_catalog.btrim(p_reason),
    pg_catalog.to_jsonb(previous_row),pg_catalog.to_jsonb(updated_row)
  );

  return pg_catalog.jsonb_build_object(
    'tenantId',p_tenant_id,
    'settings',pg_catalog.to_jsonb(updated_row),
    'readiness',post_readiness,
    'capabilities',public.resolve_tenant_operational_capabilities(p_tenant_id)
  );
end;
$$;

revoke all on function public.tenant_core_legal_gate_report(uuid) from public,anon,authenticated;
revoke all on function public.tenant_tax_document_readiness(uuid) from public,anon,authenticated;
revoke all on function public.tenant_live_readiness_report(uuid) from public,anon,authenticated;
revoke all on function public.resolve_tenant_operational_capabilities(uuid) from public,anon,authenticated;
revoke all on function public.set_tenant_operational_features(uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text)
  from public,anon,authenticated;

grant execute on function public.tenant_core_legal_gate_report(uuid) to service_role;
grant execute on function public.tenant_tax_document_readiness(uuid) to service_role;
grant execute on function public.tenant_live_readiness_report(uuid) to service_role;
grant execute on function public.resolve_tenant_operational_capabilities(uuid) to service_role;
grant execute on function public.set_tenant_operational_features(uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text)
  to service_role;

comment on table public.tenant_operational_features is
  'Explicit per-tenant production feature profile. Live mode does not imply payments or DTE.';
comment on function public.tenant_tax_document_readiness(uuid) is
  'Capability-aware tax-document gate: Citaya DTE or externally verified BHE, never implicit.';
comment on function public.set_tenant_operational_features(uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text) is
  'Platform-admin audited setter for production features; fail-closed and atomic for already-live tenants.';

commit;
