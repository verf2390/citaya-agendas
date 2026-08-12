-- Migration: 202608050001_fix_db_enqueue_manual_dte_internal_mode.sql
--
-- ROOT CAUSE:
-- The DB function resolve_tenant_operational_capabilities had 'internal' mode missing
-- 'manualDteEnqueue:true'. This matches what operational-mode.mjs already sets.
-- Additionally, assert_tenant_can_enqueue_dte only checked 'enqueueDte' and ignored
-- 'manualDteEnqueue', blocking explicit manual issuances for 'internal' tenants.
--
-- FIX:
-- 1. Add manualDteEnqueue:true to 'internal' mode in resolve_tenant_operational_capabilities.
-- 2. Update assert_tenant_can_enqueue_dte to allow 'manualDteEnqueue' as an alternative
--    when the trigger_source is 'manual_admin' (passed via NEW row context).
--
-- SAFETY:
-- - Does NOT enable automatic enqueueDte for 'internal' mode.
-- - Does NOT enable 'verified_payment', 'automatic', 'scheduler', or 'webhook' paths.
-- - manualDteEnqueue is only used when trigger_source='manual_admin' via a_tenant_mode_dte_intents
--   trigger context check.
-- - Idempotent: uses CREATE OR REPLACE for all functions.

-- 1. Sync resolve_tenant_operational_capabilities to match operational-mode.mjs
--    Add manualDteEnqueue:true for 'internal' mode (already present in .mjs, missing in SQL)
create or replace function public.resolve_tenant_operational_capabilities(p_tenant_id uuid)
  returns jsonb
  language sql
  stable security definer
  set search_path to 'public'
as $function$
  with state as (
    select lifecycle_status,operational_mode from public.tenants where id=p_tenant_id
  )
  select case
    when not exists(select 1 from state) then jsonb_build_object('exists',false,'allowed',false)
    when (select lifecycle_status from state)='archived' then jsonb_build_object(
      'exists',true,'lifecycleStatus','archived','operationalMode',(select operational_mode from state),
      'informationalPage',false,'demoSimulation',false,'createAppointment',false,
      'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
      'sendExternalEmail',false,'sendCampaign',false,'callExternalAutomation',false,
      'enqueueDte',false,'manualDteEnqueue',false,'runDteWorker',false,'publicTaxDocument',false,
      'taxAdministration',false,'dteCertification',false,'ordinaryAdmin',false,
      'exceptionalPlatformAccess',true,'classificationAdmin',true)
    when (select operational_mode from state)='demo' then jsonb_build_object(
      'exists',true,'lifecycleStatus','active','operationalMode','demo',
      'informationalPage',true,'demoSimulation',true,'createAppointment',false,
      'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
      'sendExternalEmail',false,'sendCampaign',false,'callExternalAutomation',false,
      'enqueueDte',false,'manualDteEnqueue',false,'runDteWorker',false,'publicTaxDocument',false,
      'taxAdministration',false,'dteCertification',false,'ordinaryAdmin',true,
      'exceptionalPlatformAccess',false,'classificationAdmin',false)
    when (select operational_mode from state)='live' then jsonb_build_object(
      'exists',true,'lifecycleStatus','active','operationalMode','live',
      'informationalPage',true,'demoSimulation',false,'createAppointment',true,
      'createPayment',true,'confirmTransfer',true,'acceptPaymentWebhook',true,
      'sendExternalEmail',true,'sendCampaign',true,'callExternalAutomation',true,
      'enqueueDte',true,'manualDteEnqueue',true,'runDteWorker',true,'publicTaxDocument',true,
      'taxAdministration',true,'dteCertification',false,'ordinaryAdmin',true,
      'exceptionalPlatformAccess',false,'classificationAdmin',false)
    when (select operational_mode from state)='internal' then jsonb_build_object(
      'exists',true,'lifecycleStatus','active','operationalMode','internal',
      'informationalPage',true,'demoSimulation',false,'createAppointment',false,
      'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
      'sendExternalEmail',false,'sendCampaign',false,'callExternalAutomation',false,
      'enqueueDte',false,'manualDteEnqueue',true,'runDteWorker',false,'publicTaxDocument',false,
      'taxAdministration',true,'dteCertification',true,'ordinaryAdmin',true,
      'exceptionalPlatformAccess',false,'classificationAdmin',false)
    else jsonb_build_object(
      'exists',true,'lifecycleStatus','active','operationalMode','unclassified',
      'informationalPage',true,'demoSimulation',false,'createAppointment',false,
      'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
      'sendExternalEmail',false,'sendCampaign',false,'callExternalAutomation',false,
      'enqueueDte',false,'manualDteEnqueue',false,'runDteWorker',false,'publicTaxDocument',false,
      'taxAdministration',false,'dteCertification',false,'ordinaryAdmin',false,
      'exceptionalPlatformAccess',false,'classificationAdmin',true)
  end from state right join (select 1) singleton on true;
$function$;

-- 2. Update assert_tenant_can_enqueue_dte to accept manualDteEnqueue as alternative.
--    This allows manual issuances (trigger_source='manual_admin') from 'internal' tenants
--    without enabling automatic DTE enqueueing.
create or replace function public.assert_tenant_can_enqueue_dte(
  p_tenant_id uuid,
  p_trigger_source text default null
)
  returns void
  language plpgsql
  stable security definer
  set search_path to 'public'
as $function$
declare
  caps jsonb;
begin
  caps := public.resolve_tenant_operational_capabilities(p_tenant_id);
  -- Allow if enqueueDte OR (manualDteEnqueue AND origin is manual_admin)
  if coalesce((caps->>'enqueueDte')::boolean, false) then
    return;
  end if;
  if coalesce((caps->>'manualDteEnqueue')::boolean, false)
    and (p_trigger_source = 'manual_admin' or p_trigger_source is null) then
    return;
  end if;
  raise exception 'TENANT_MODE_DTE_BLOCKED';
end;
$function$;

-- 3. Update the trigger to pass trigger_source to the assertion function.
--    For dte_payment_document_intents: read new.trigger_source directly.
--    For dte_issuance_outbox: the trigger WHEN condition already guarantees trigger_source='manual_admin'
--    (see dte_intent_mirror_boleta_draft WHEN clause), so pass 'manual_admin' explicitly.
--    For other tables: pass null (falls back to enqueueDte check).
create or replace function public.assert_tenant_operational_trigger()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_trigger_source text;
begin
  if tg_table_name='appointments' then perform public.assert_tenant_can_create_appointment(new.tenant_id);
  elsif tg_table_name in ('payment_intents','payments','billing_sale_payments') then
    perform public.assert_tenant_can_create_payment(new.tenant_id);
  elsif tg_table_name = 'dte_payment_document_intents' then
    -- NEW is a dte_payment_document_intents row, trigger_source exists
    perform public.assert_tenant_can_enqueue_dte(new.tenant_id, new.trigger_source);
  elsif tg_table_name = 'dte_issuance_outbox' then
    -- Outbox inserts from dte_enqueue_manual_intent trigger which only fires for manual_admin
    -- Look up the trigger_source from the parent intent for precise check
    select trigger_source into v_trigger_source
      from public.dte_payment_document_intents
      where id = new.intent_id and tenant_id = new.tenant_id;
    perform public.assert_tenant_can_enqueue_dte(new.tenant_id, coalesce(v_trigger_source, 'manual_admin'));
  else raise exception 'TENANT_MODE_TRIGGER_TABLE_UNSUPPORTED';end if;
  return new;
end;
$function$;
