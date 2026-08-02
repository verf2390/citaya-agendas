-- Fail-closed tenant operating mode. Existing and new tenants remain
-- unclassified until a platform administrator performs an explicit, audited
-- classification. This migration never updates tenant rows or enables DTE.

alter table public.tenants
  add column if not exists operational_mode text not null default 'unclassified'
    check (operational_mode in ('unclassified','demo','live','internal')),
  add column if not exists operational_mode_changed_at timestamptz,
  add column if not exists operational_mode_changed_by uuid,
  add column if not exists operational_mode_change_reason text,
  add constraint tenants_operational_mode_change_shape check (
    (operational_mode_changed_at is null and operational_mode_changed_by is null
      and operational_mode_change_reason is null) or
    (operational_mode_changed_at is not null and operational_mode_changed_by is not null
      and length(trim(coalesce(operational_mode_change_reason,''))) between 10 and 500)
  );

create table public.tenant_operational_mode_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  previous_mode text not null check (previous_mode in ('unclassified','demo','live','internal')),
  new_mode text not null check (new_mode in ('unclassified','demo','live','internal')),
  lifecycle_status text not null check (lifecycle_status in ('active','archived')),
  actor_user_id uuid not null,
  reason text not null check (length(trim(reason)) between 10 and 500),
  readiness_snapshot jsonb not null default '{}'::jsonb,
  changed_at timestamptz not null default now()
);

create table public.tenant_operational_rejections (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  operation text not null check (operation in (
    'appointment','payment','transfer','payment_webhook','external_email',
    'campaign','external_automation','dte_intent','dte_outbox','dte_worker',
    'public_tax_document','sensitive_admin'
  )),
  source text not null check (length(source) between 2 and 80),
  safe_reference_hash text check (safe_reference_hash is null or safe_reference_hash ~ '^[a-f0-9]{64}$'),
  reason_code text not null check (reason_code ~ '^[A-Z0-9_:-]{3,100}$'),
  occurred_at timestamptz not null default now()
);

create table public.tenant_exceptional_access_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  actor_user_id uuid not null,
  access_context text not null check (length(access_context) between 3 and 100),
  occurred_at timestamptz not null default now()
);

create or replace function public.tenant_operational_append_only_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'TENANT_OPERATIONAL_AUDIT_APPEND_ONLY';
end;
$$;

create trigger tenant_operational_mode_audit_append_only
before update or delete on public.tenant_operational_mode_audit
for each row execute function public.tenant_operational_append_only_guard();
create trigger tenant_operational_rejections_append_only
before update or delete on public.tenant_operational_rejections
for each row execute function public.tenant_operational_append_only_guard();
create trigger tenant_exceptional_access_audit_append_only
before update or delete on public.tenant_exceptional_access_audit
for each row execute function public.tenant_operational_append_only_guard();

create or replace function public.resolve_tenant_operational_capabilities(p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
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
      'enqueueDte',false,'runDteWorker',false,'publicTaxDocument',false,
      'taxAdministration',false,'dteCertification',false,'ordinaryAdmin',false,
      'exceptionalPlatformAccess',true,'classificationAdmin',true)
    when (select operational_mode from state)='demo' then jsonb_build_object(
      'exists',true,'lifecycleStatus','active','operationalMode','demo',
      'informationalPage',true,'demoSimulation',true,'createAppointment',false,
      'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
      'sendExternalEmail',false,'sendCampaign',false,'callExternalAutomation',false,
      'enqueueDte',false,'runDteWorker',false,'publicTaxDocument',false,
      'taxAdministration',false,'dteCertification',false,'ordinaryAdmin',true,
      'exceptionalPlatformAccess',false,'classificationAdmin',false)
    when (select operational_mode from state)='live' then jsonb_build_object(
      'exists',true,'lifecycleStatus','active','operationalMode','live',
      'informationalPage',true,'demoSimulation',false,'createAppointment',true,
      'createPayment',true,'confirmTransfer',true,'acceptPaymentWebhook',true,
      'sendExternalEmail',true,'sendCampaign',true,'callExternalAutomation',true,
      'enqueueDte',true,'runDteWorker',true,'publicTaxDocument',true,
      'taxAdministration',true,'dteCertification',false,'ordinaryAdmin',true,
      'exceptionalPlatformAccess',false,'classificationAdmin',false)
    when (select operational_mode from state)='internal' then jsonb_build_object(
      'exists',true,'lifecycleStatus','active','operationalMode','internal',
      'informationalPage',false,'demoSimulation',false,'createAppointment',false,
      'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
      'sendExternalEmail',false,'sendCampaign',false,'callExternalAutomation',false,
      'enqueueDte',false,'runDteWorker',false,'publicTaxDocument',false,
      'taxAdministration',true,'dteCertification',true,'ordinaryAdmin',true,
      'exceptionalPlatformAccess',false,'classificationAdmin',false)
    else jsonb_build_object(
      'exists',true,'lifecycleStatus','active','operationalMode','unclassified',
      'informationalPage',true,'demoSimulation',false,'createAppointment',false,
      'createPayment',false,'confirmTransfer',false,'acceptPaymentWebhook',false,
      'sendExternalEmail',false,'sendCampaign',false,'callExternalAutomation',false,
      'enqueueDte',false,'runDteWorker',false,'publicTaxDocument',false,
      'taxAdministration',false,'dteCertification',false,'ordinaryAdmin',false,
      'exceptionalPlatformAccess',false,'classificationAdmin',true)
  end from state right join (select 1) singleton on true;
$$;

create or replace function public.tenant_operational_capability_allowed(
  p_tenant_id uuid,p_capability text
) returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((public.resolve_tenant_operational_capabilities(p_tenant_id)->>p_capability)::boolean,false);
$$;

create or replace function public.assert_tenant_can_create_appointment(p_tenant_id uuid)
returns void language plpgsql stable security definer set search_path=public as $$
begin
  if not public.tenant_operational_capability_allowed(p_tenant_id,'createAppointment')
  then raise exception 'TENANT_MODE_APPOINTMENT_BLOCKED';end if;
end;
$$;

create or replace function public.assert_tenant_can_create_payment(p_tenant_id uuid)
returns void language plpgsql stable security definer set search_path=public as $$
begin
  if not public.tenant_operational_capability_allowed(p_tenant_id,'createPayment')
  then raise exception 'TENANT_MODE_PAYMENT_BLOCKED';end if;
end;
$$;

create or replace function public.assert_tenant_can_enqueue_dte(p_tenant_id uuid)
returns void language plpgsql stable security definer set search_path=public as $$
begin
  if not public.tenant_operational_capability_allowed(p_tenant_id,'enqueueDte')
  then raise exception 'TENANT_MODE_DTE_BLOCKED';end if;
end;
$$;

create or replace function public.assert_tenant_can_send_external_communication(p_tenant_id uuid)
returns void language plpgsql stable security definer set search_path=public as $$
begin
  if not public.tenant_operational_capability_allowed(p_tenant_id,'sendExternalEmail')
  then raise exception 'TENANT_MODE_EXTERNAL_COMMUNICATION_BLOCKED';end if;
end;
$$;

create or replace function public.tenant_live_readiness_report(p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  with facts as (
    select
      exists(select 1 from public.tenants t where t.id=p_tenant_id and t.lifecycle_status='active') active,
      coalesce((public.tenant_legal_gate_report(p_tenant_id)->>'ready')::boolean,false) legal_ready,
      exists(select 1 from public.services s where s.tenant_id=p_tenant_id and s.is_active) active_services,
      not exists(select 1 from public.services s where s.tenant_id=p_tenant_id and s.is_active and (
        not s.payment_configuration_complete or s.tax_description_review_status<>'approved'
        or length(trim(coalesce(s.tax_description,'')))<2 or s.tax_treatment is null
      )) services_ready,
      exists(select 1 from public.tenant_payment_settings p where p.tenant_id=p_tenant_id and p.active) payment_provider_ready,
      exists(select 1 from public.dte_production_tenant_settings d where d.tenant_id=p_tenant_id
        and length(trim(coalesce(d.issuer_legal_name,'')))>1
        and length(trim(coalesce(d.issuer_rut,'')))>7
        and length(trim(coalesce(d.issuer_address,'')))>2) tax_identity_ready,
      exists(select 1 from public.dte_tenant_issuance_settings i where i.tenant_id=p_tenant_id
        and i.boleta_payment_document_model<>'unconfigured'
        and i.boleta_model_verified_at is not null and i.boleta_model_verified_by is not null) boleta_model_ready
  )
  select jsonb_build_object(
    'active',active,'legalReady',legal_ready,'activeServices',active_services,
    'servicesReady',services_ready,'paymentProviderReady',payment_provider_ready,
    'taxIdentityReady',tax_identity_ready,'boletaModelReady',boleta_model_ready,
    'ready',active and legal_ready and active_services and services_ready
      and payment_provider_ready and tax_identity_ready and boleta_model_ready
  ) from facts;
$$;

create or replace function public.set_tenant_operational_mode(
  p_tenant_id uuid,p_new_mode text,p_actor_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare tenant_row public.tenants%rowtype;readiness jsonb;
begin
  if not public.is_platform_admin(p_actor_id) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
  if p_new_mode not in ('unclassified','demo','live','internal') then raise exception 'OPERATIONAL_MODE_INVALID';end if;
  if length(trim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'CLASSIFICATION_REASON_REQUIRED';end if;
  select * into tenant_row from public.tenants where id=p_tenant_id for update;
  if not found then raise exception 'TENANT_NOT_FOUND';end if;
  if tenant_row.lifecycle_status='archived' then raise exception 'USE_OFFBOARDING_FOR_ARCHIVED_TENANT';end if;
  readiness:=public.tenant_live_readiness_report(p_tenant_id);
  if p_new_mode='live' and coalesce((readiness->>'ready')::boolean,false) is not true
  then raise exception 'LIVE_TENANT_CHECKLIST_INCOMPLETE';end if;
  if tenant_row.operational_mode=p_new_mode then raise exception 'OPERATIONAL_MODE_UNCHANGED';end if;
  update public.tenants set operational_mode=p_new_mode,operational_mode_changed_at=now(),
    operational_mode_changed_by=p_actor_id,operational_mode_change_reason=trim(p_reason)
    where id=p_tenant_id;
  insert into public.tenant_operational_mode_audit(
    tenant_id,previous_mode,new_mode,lifecycle_status,actor_user_id,reason,readiness_snapshot
  ) values(p_tenant_id,tenant_row.operational_mode,p_new_mode,tenant_row.lifecycle_status,
    p_actor_id,trim(p_reason),readiness);
  return jsonb_build_object('tenantId',p_tenant_id,'previousMode',tenant_row.operational_mode,
    'operationalMode',p_new_mode,'capabilities',public.resolve_tenant_operational_capabilities(p_tenant_id));
end;
$$;

create or replace function public.record_tenant_operational_rejection(
  p_tenant_id uuid,p_operation text,p_source text,p_safe_reference_hash text,p_reason_code text
) returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.tenant_operational_rejections(
    tenant_id,operation,source,safe_reference_hash,reason_code
  ) values(p_tenant_id,p_operation,left(trim(p_source),80),p_safe_reference_hash,p_reason_code);
end;
$$;

create or replace function public.record_tenant_exceptional_access(
  p_tenant_id uuid,p_actor_user_id uuid,p_access_context text
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_platform_admin(p_actor_user_id) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
  insert into public.tenant_exceptional_access_audit(tenant_id,actor_user_id,access_context)
  values(p_tenant_id,p_actor_user_id,left(trim(p_access_context),100));
end;
$$;

create or replace function public.assert_tenant_operational_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='appointments' then perform public.assert_tenant_can_create_appointment(new.tenant_id);
  elsif tg_table_name in ('payment_intents','payments','billing_sale_payments') then
    perform public.assert_tenant_can_create_payment(new.tenant_id);
  elsif tg_table_name in ('dte_payment_document_intents','dte_issuance_outbox') then
    perform public.assert_tenant_can_enqueue_dte(new.tenant_id);
  else raise exception 'TENANT_MODE_TRIGGER_TABLE_UNSUPPORTED';end if;
  return new;
end;
$$;

-- These names sort before the pre-existing payment/document validation
-- triggers, so mode rejection occurs before any operation-specific work.
drop trigger if exists appointments_tenant_operational on public.appointments;
create trigger a_tenant_mode_appointments before insert on public.appointments
for each row execute function public.assert_tenant_operational_trigger();
drop trigger if exists payment_intents_tenant_operational on public.payment_intents;
create trigger a_tenant_mode_payment_intents before insert on public.payment_intents
for each row execute function public.assert_tenant_operational_trigger();
drop trigger if exists dte_intents_tenant_operational on public.dte_payment_document_intents;
create trigger a_tenant_mode_dte_intents before insert on public.dte_payment_document_intents
for each row execute function public.assert_tenant_operational_trigger();
drop trigger if exists dte_outbox_tenant_operational on public.dte_issuance_outbox;
create trigger a_tenant_mode_dte_outbox before insert on public.dte_issuance_outbox
for each row execute function public.assert_tenant_operational_trigger();
drop trigger if exists payments_tenant_operational on public.payments;
create trigger a_tenant_mode_payments before insert on public.payments
for each row execute function public.assert_tenant_operational_trigger();
drop trigger if exists billing_sale_payments_tenant_operational on public.billing_sale_payments;
create trigger a_tenant_mode_billing_sale_payments before insert on public.billing_sale_payments
for each row execute function public.assert_tenant_operational_trigger();

create or replace function public.tenant_mode_payment_status_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('pending','processing','succeeded','paid','VERIFIED')
    and new.status is distinct from old.status
  then perform public.assert_tenant_can_create_payment(new.tenant_id);end if;
  return new;
end;
$$;
drop trigger if exists payment_intents_tenant_mode_status on public.payment_intents;
create trigger payment_intents_tenant_mode_status before update of status on public.payment_intents
for each row execute function public.tenant_mode_payment_status_guard();
drop trigger if exists payments_tenant_mode_status on public.payments;
create trigger payments_tenant_mode_status before update of status on public.payments
for each row execute function public.tenant_mode_payment_status_guard();

create or replace function public.tenant_mode_type39_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.dte_type=39 and new.issuance_enabled and not public.tenant_operational_capability_allowed(new.tenant_id,'enqueueDte')
  then raise exception 'TENANT_MODE_TYPE39_BLOCKED';end if;
  return new;
end;
$$;
drop trigger if exists tenant_mode_type39_guard on public.dte_tenant_document_capabilities;
create trigger tenant_mode_type39_guard before insert or update of issuance_enabled,tenant_id,dte_type
on public.dte_tenant_document_capabilities for each row execute function public.tenant_mode_type39_guard();

alter table public.tenant_operational_mode_audit enable row level security;
alter table public.tenant_operational_rejections enable row level security;
alter table public.tenant_exceptional_access_audit enable row level security;
revoke all on public.tenant_operational_mode_audit,public.tenant_operational_rejections,
  public.tenant_exceptional_access_audit from anon,authenticated;
grant select on public.tenant_operational_mode_audit,public.tenant_operational_rejections,
  public.tenant_exceptional_access_audit to authenticated;
create policy tenant_operational_mode_audit_platform_read on public.tenant_operational_mode_audit
for select to authenticated using(public.is_platform_admin(auth.uid()));
create policy tenant_operational_rejections_platform_read on public.tenant_operational_rejections
for select to authenticated using(public.is_platform_admin(auth.uid()));
create policy tenant_exceptional_access_audit_platform_read on public.tenant_exceptional_access_audit
for select to authenticated using(public.is_platform_admin(auth.uid()));

revoke all on function public.set_tenant_operational_mode(uuid,text,uuid,text),
  public.record_tenant_operational_rejection(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.record_tenant_exceptional_access(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_tenant_operational_mode(uuid,text,uuid,text),
  public.record_tenant_operational_rejection(uuid,text,text,text,text),
  public.record_tenant_exceptional_access(uuid,uuid,text) to service_role;
grant execute on function public.resolve_tenant_operational_capabilities(uuid),
  public.tenant_operational_capability_allowed(uuid,text) to authenticated,service_role;

comment on column public.tenants.operational_mode is 'Operational exposure is independent from contractual lifecycle. Defaults fail-closed to unclassified.';
comment on table public.tenant_operational_mode_audit is 'Append-only platform classification evidence; tenant administrators cannot write it.';
comment on table public.tenant_operational_rejections is 'Sanitized technical rejection evidence; never stores provider payloads or visitor PII.';
