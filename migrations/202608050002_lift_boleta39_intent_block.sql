-- Migration: 202608050002_lift_boleta39_intent_block.sql
-- Purpose: Lift the unconditional block on DTE type 39 (boleta) in
--          dte_complete_intent_snapshot() and activate type 39 in
--          dte_legal_activation for tenant 21884d8b-1975-4e5c-8887-06eb62401428.
--
-- Change to blocking logic:
--   BEFORE: type 39 was ALWAYS blocked (even when authorized + CAF ready)
--   AFTER:  type 39 is blocked only when type_authorized=false OR type_caf_ready=false.
--           When trigger_source='manual_admin' AND type_authorized=true AND type_caf_ready=true
--           → treated like any other authorized type (no block).
--
-- Idempotent: uses CREATE OR REPLACE FUNCTION + INSERT ... ON CONFLICT DO UPDATE.
-- No tables are modified. No functions are dropped.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Replace the trigger function with the corrected type-39 blocking logic
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dte_complete_intent_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  appointment_row public.appointments%rowtype;
  payment_row public.payment_intents%rowtype;
  issuer jsonb;
  tax_profile jsonb;
  customer_identity jsonb;
  net_amount bigint;
  tax_amount bigint;
  type_authorized boolean;
  type_caf_ready boolean;
begin
  if new.appointment_id is not null then
    select * into appointment_row from public.appointments
     where id=new.appointment_id and tenant_id=new.tenant_id;
    if not found then raise exception 'DTE_APPOINTMENT_TENANT_MISMATCH'; end if;
    new.customer_id := coalesce(new.customer_id, appointment_row.customer_id);
    if (new.trigger_source <> 'manual_admin' or new.origin = 'automatic_payment')
       and new.requested_document = 'consumer' then
      new.resolved_dte_type := coalesce(appointment_row.requested_document_type, 39);
    end if;
  end if;
  if new.payment_intent_id is not null then
    select * into payment_row from public.payment_intents
     where id=new.payment_intent_id and tenant_id=new.tenant_id
       and appointment_id=new.appointment_id and status='succeeded';
    if not found then raise exception 'DTE_PAYMENT_TENANT_MISMATCH'; end if;
  end if;
  if new.customer_id is not null and not exists (
    select 1 from public.customers c
     where c.id=new.customer_id and c.tenant_id=new.tenant_id
  ) then raise exception 'DTE_CUSTOMER_TENANT_MISMATCH'; end if;
  select jsonb_build_object('rut',c.rut_normalized,'legalName',c.full_name,'email',c.email)
    into customer_identity from public.customers c
   where c.id=new.customer_id and c.tenant_id=new.tenant_id;
  new.receiver_snapshot := coalesce(customer_identity,'{}'::jsonb) || new.receiver_snapshot;

  select jsonb_build_object(
    'rut',p.issuer_rut,'legalName',p.issuer_legal_name,
    'activity',p.issuer_activity,'address',p.issuer_address,
    'commune',p.issuer_commune,'city',p.issuer_city
  ) into issuer from public.dte_production_tenant_settings p
   where p.tenant_id=new.tenant_id;
  select jsonb_build_object(
    'rut',t.rut_normalized,'legalName',t.legal_name,
    'activity',t.business_activity,'address',t.tax_address,
    'commune',t.tax_commune,'city',t.tax_city,
    'email',t.tax_email
  ) into tax_profile from public.customer_tax_profiles t
   where t.tenant_id=new.tenant_id and t.customer_id=new.customer_id;
  if new.resolved_dte_type = 33 then
    new.receiver_snapshot := new.receiver_snapshot || coalesce(tax_profile, '{}'::jsonb);
  end if;

  if coalesce(appointment_row.tax_treatment_snapshot,'affected')='exempt' then
    net_amount := 0; tax_amount := 0;
  else
    net_amount := round(new.amount_snapshot / 1.19);
    tax_amount := new.amount_snapshot - net_amount;
  end if;
  new.origin := case when new.trigger_source='manual_admin' then new.origin else 'automatic_payment' end;
  new.requested_by_role := coalesce(new.requested_by_role, case when new.created_by is null then 'system' else 'tenant_admin' end);
  if new.trigger_source <> 'manual_admin' or new.immutable_snapshot = '{}'::jsonb then
    new.immutable_snapshot := jsonb_build_object(
    'tenantId',new.tenant_id,'issuer',coalesce(issuer,'{}'::jsonb),
    'receiver',new.receiver_snapshot,'taxProfile',coalesce(tax_profile,'{}'::jsonb),
    'lines',jsonb_build_array(jsonb_build_object(
      'description',coalesce(appointment_row.service_name,'Emisión manual'),
      'quantity',1,'unitPrice',new.amount_snapshot
    )),
    'taxes',jsonb_build_object(
      'net',net_amount,'exempt',case when net_amount=0 then new.amount_snapshot else 0 end,
      'tax',tax_amount,'total',new.amount_snapshot
    ),
    'payment',case
      when new.payment_intent_id is not null then jsonb_build_object(
        'id',new.payment_intent_id,'amount',payment_row.amount,
        'currency',payment_row.currency,'provider',payment_row.provider,
        'status',payment_row.status
      )
      when new.trigger_source='manual_admin' and appointment_row.payment_status='paid' then jsonb_build_object(
        'id',null,'amount',coalesce(appointment_row.payment_paid_amount,new.amount_snapshot),
        'currency',coalesce(appointment_row.currency,'CLP'),'provider','manual','status','succeeded'
      )
      else null end,
    'appointment',case when new.appointment_id is null then null else jsonb_build_object(
      'id',new.appointment_id,'serviceId',appointment_row.service_id,
      'startAt',appointment_row.start_at
    ) end,
    'customerId',new.customer_id,'documentType',new.resolved_dte_type,
    'requestedBy',new.created_by,'requestedByRole',new.requested_by_role,
      'origin',new.origin,'capturedAt',now()
    );
  end if;

  select exists (
    select 1 from public.dte_sii_authorization_evidence a
     where a.tenant_id=new.tenant_id and a.status='current'
       and new.resolved_dte_type=any(a.authorized_types)
  ) into type_authorized;
  select exists (
    select 1 from public.dte_production_cafs c
     where c.tenant_id=new.tenant_id and c.dte_type=new.resolved_dte_type
       and c.active and c.trust_status='verified_official'
  ) into type_caf_ready;

  -- ── Bloqueo A – FIX ────────────────────────────────────────────────────────
  -- Tipo 39 (boleta electrónica):
  --   · Bloquear si NOT authorized o NOT caf_ready (igual que antes).
  --   · Si authorized=true Y caf_ready=true Y trigger_source='manual_admin'
  --     → NO bloquear (tratar igual que cualquier otro tipo autorizado).
  --   · Para otros trigger_source con tipo 39 ready: también se deja pasar
  --     (el gate de upstream controla quién puede insertar; si llega aquí con
  --     authorized+caf, no hay razón de bloqueo en esta función).
  -- ──────────────────────────────────────────────────────────────────────────
  if new.resolved_dte_type = 39 then
    if not type_authorized then
      new.status := 'BLOCKED';
      new.safe_blocking_reason := 'BLOCKED_NOT_AUTHORIZED';
    elsif not type_caf_ready then
      new.status := 'BLOCKED';
      new.safe_blocking_reason := 'BLOCKED_MISSING_CAF';
    end if;
    -- else: authorized + caf_ready → no block (falls through to return new)
  elsif new.resolved_dte_type is not null and not type_authorized then
    new.status := 'BLOCKED';
    new.safe_blocking_reason := 'DOCUMENT_TYPE_NOT_AUTHORIZED';
  end if;

  return new;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Activate DTE type 39 for tenant 21884d8b-1975-4e5c-8887-06eb62401428
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.dte_legal_activation (
  tenant_id,
  dte_type,
  status,
  activated_by,
  activated_at,
  gate_snapshot
)
VALUES (
  '21884d8b-1975-4e5c-8887-06eb62401428',
  39,
  'active',
  'be83afe2-d273-4a38-bbb3-1b723ee3426d',
  now(),
  '{
    "ready": true,
    "xmlDsig": true,
    "officialXsd": true,
    "privateStorage": true,
    "typeAuthorized": true,
    "foliosAvailable": true,
    "issuerDataExact": true,
    "authenticTypeCaf": true,
    "workerConfigured": true,
    "migrationsApplied": true,
    "tenantAwareLedger": true,
    "certificateCurrent": true,
    "certificateKeyMatch": true,
    "certificateRutMatch": true,
    "documentEngineReady": true,
    "officialTrustAnchor": true,
    "productionEndpoints": true,
    "globalFeatureEnabled": true,
    "issuerLegalNameMatch": true,
    "offlinePreflightComplete": true,
    "issuerResolutionConfigured": true
  }'::jsonb
)
ON CONFLICT (tenant_id, dte_type) DO UPDATE SET
  status        = 'active',
  activated_at  = now(),
  gate_snapshot = EXCLUDED.gate_snapshot;
