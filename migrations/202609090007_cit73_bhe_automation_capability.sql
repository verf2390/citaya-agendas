begin;

-- CIT-73:
-- BHE automation is a dedicated fail-closed capability.
-- It is independent from communications and Citaya DTE.
-- Only an external_bhe tenant whose dedicated SII mass-BHE readiness is
-- fully ready may expose bheAutomation=true.

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
      coalesce((public.tenant_tax_document_readiness(p_tenant_id)->>'ready')::boolean,false) as tax_document_ready,
      coalesce((public.tenant_bhe_automation_readiness(p_tenant_id)->>'ready')::boolean,false) as bhe_automation_ready
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
        'callExternalAutomation',false,'bheAutomation',false,'enqueueDte',false,'manualDteEnqueue',false,
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
        'callExternalAutomation',false,'bheAutomation',false,'enqueueDte',false,'manualDteEnqueue',false,
        'runDteWorker',false,'publicTaxDocument',false,'taxAdministration',false,
        'dteCertification',false,'ordinaryAdmin',false,'exceptionalPlatformAccess',false,
        'classificationAdmin',true)
    when (select operational_mode from state)='demo' then
      pg_catalog.jsonb_build_object(
        'exists',true,'lifecycleStatus','active','operationalMode','demo',
        'informationalPage',true,'demoSimulation',true,'createAppointment',true,
        'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
        'appointmentOperationalCommunication',true,'sendExternalEmail',false,'sendCampaign',false,
        'callExternalAutomation',false,'bheAutomation',false,'enqueueDte',false,'manualDteEnqueue',false,
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
        'bheAutomation',
          coalesce(feature.tax_document_mode,'unconfigured')='external_bhe'
          and live_gates.bhe_automation_ready,
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
        'callExternalAutomation',false,'bheAutomation',false,'enqueueDte',false,'manualDteEnqueue',true,
        'runDteWorker',false,'publicTaxDocument',false,'taxAdministration',true,
        'dteCertification',true,'ordinaryAdmin',true,'exceptionalPlatformAccess',false,
        'classificationAdmin',false)
    else
      pg_catalog.jsonb_build_object(
        'exists',true,'lifecycleStatus',(select lifecycle_status from state),'operationalMode','unclassified',
        'informationalPage',true,'demoSimulation',false,'createAppointment',false,
        'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
        'appointmentOperationalCommunication',false,'sendExternalEmail',false,'sendCampaign',false,
        'callExternalAutomation',false,'bheAutomation',false,'enqueueDte',false,'manualDteEnqueue',false,
        'runDteWorker',false,'publicTaxDocument',false,'taxAdministration',false,
        'dteCertification',false,'ordinaryAdmin',false,'exceptionalPlatformAccess',false,
        'classificationAdmin',true)
  end
  from state
  right join (select 1) singleton on true
  left join feature on true
  cross join live_gates;
$$;

commit;
