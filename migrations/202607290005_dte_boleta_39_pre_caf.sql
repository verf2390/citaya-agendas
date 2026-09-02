-- PRE-CAF type 39 is deliberately fail-closed. This migration stores an
-- explicit document choice and the tenant/environment capability separately
-- from the existing type 33 production activation.

create table if not exists public.dte_tenant_document_capabilities (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  environment text not null check (environment in ('certification','production')),
  dte_type integer not null check (dte_type in (33,39,56,61)),
  customer_selection_enabled boolean not null default false,
  admin_draft_enabled boolean not null default false,
  issuance_enabled boolean not null default false,
  endpoint_profile text,
  schema_version text,
  certification_status text not null default 'not_started'
    check (certification_status in (
      'not_started','pre_caf_ready','caf_imported','set_submitted',
      'sii_approved','compliance_declared','production_authorized'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,environment,dte_type),
  check (
    dte_type <> 39 or environment <> 'production' or
    not issuance_enabled or certification_status='production_authorized'
  ),
  check (
    issuance_enabled=false or
    (endpoint_profile is not null and length(trim(endpoint_profile)) > 0)
  )
);

insert into public.dte_tenant_document_capabilities(
  tenant_id,environment,dte_type,customer_selection_enabled,
  admin_draft_enabled,issuance_enabled,endpoint_profile,schema_version,
  certification_status
)
select tenant_id,'certification',39,false,true,false,
  'boleta_rest_certification','EnvioBOLETA_v11','pre_caf_ready'
from public.dte_production_tenant_settings
on conflict (tenant_id,environment,dte_type) do nothing;

alter table public.appointments
  add column if not exists tax_document_selection integer
    check (tax_document_selection in (33,39)),
  add column if not exists tax_document_selection_locked_at timestamptz;
alter table public.appointments
  alter column requested_document_type drop default,
  alter column requested_document_type drop not null;

alter table public.billing_sales
  add column if not exists requested_document_type integer
    check (requested_document_type in (33,39)),
  add column if not exists document_selection_locked_at timestamptz;

alter table public.dte_invoice_drafts
  drop constraint if exists dte_invoice_drafts_dte_type_check;
alter table public.dte_invoice_drafts
  add constraint dte_invoice_drafts_dte_type_check
  check (dte_type in (33,39));

alter table public.dte_production_documents
  drop constraint if exists dte_production_documents_dte_type_check;
alter table public.dte_production_documents
  add constraint dte_production_documents_dte_type_check
  check (dte_type in (33,39,56,61));

alter table public.dte_production_cafs
  drop constraint if exists dte_production_cafs_dte_type_check;
alter table public.dte_production_cafs
  add constraint dte_production_cafs_dte_type_check
  check (dte_type in (33,39,56,61));

alter table public.dte_production_folio_ledger
  drop constraint if exists dte_production_folio_ledger_dte_type_check;
alter table public.dte_production_folio_ledger
  add constraint dte_production_folio_ledger_dte_type_check
  check (dte_type in (33,39,56,61));

create or replace function public.dte_appointment_document_selection_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.tax_document_selection is distinct from new.tax_document_selection then
    if old.tax_document_selection_locked_at is not null or
       exists (
         select 1 from public.payment_intents p
         where p.tenant_id=old.tenant_id and p.appointment_id=old.id
           and p.status='succeeded'
       ) or exists (
         select 1 from public.dte_payment_document_intents i
         where i.tenant_id=old.tenant_id and i.appointment_id=old.id
           and i.status not in ('CANCELED','REJECTED')
       ) then
      raise exception 'DTE_DOCUMENT_SELECTION_LOCKED';
    end if;
  end if;
  if old.tax_document_selection_locked_at is not null and
     old.tax_document_selection_locked_at is distinct from
       new.tax_document_selection_locked_at then
    raise exception 'DTE_DOCUMENT_SELECTION_LOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists dte_appointment_document_selection_guard
  on public.appointments;
create trigger dte_appointment_document_selection_guard
before update on public.appointments
for each row execute function public.dte_appointment_document_selection_guard();

create or replace function public.dte_billing_sale_document_selection_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.requested_document_type is distinct from new.requested_document_type
     and (
       old.document_selection_locked_at is not null or
       old.status not in ('DRAFT','PAYMENT_PENDING')
     ) then
    raise exception 'DTE_DOCUMENT_SELECTION_LOCKED';
  end if;
  if old.document_selection_locked_at is not null and (
    old.document_selection_locked_at is distinct from
      new.document_selection_locked_at or
    old.requested_document_type is distinct from new.requested_document_type
  ) then
    raise exception 'DTE_DOCUMENT_SELECTION_LOCKED';
  end if;
  return new;
end;
$$;

create or replace function public.dte_billing_sale_default_document_selection()
returns trigger language plpgsql set search_path=public as $$
begin
  -- Existing administrative behavior is factura 33. Type 39 callers must
  -- always pass 39 explicitly; historical appointments without a choice never
  -- reach sale creation because their intent is blocked first.
  new.requested_document_type := coalesce(new.requested_document_type,33);
  return new;
end;
$$;

drop trigger if exists dte_billing_sale_00_default_document_selection
  on public.billing_sales;
create trigger dte_billing_sale_00_default_document_selection
before insert on public.billing_sales
for each row execute function public.dte_billing_sale_default_document_selection();

drop trigger if exists dte_billing_sale_document_selection_guard
  on public.billing_sales;
create trigger dte_billing_sale_document_selection_guard
before update on public.billing_sales
for each row execute function public.dte_billing_sale_document_selection_guard();

create or replace function public.dte_draft_document_type_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.dte_type is distinct from new.dte_type and
     old.status not in ('DRAFT','REVIEW_REQUIRED','VALIDATED') then
    raise exception 'DTE_DOCUMENT_SELECTION_LOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists dte_draft_document_type_guard
  on public.dte_invoice_drafts;
create trigger dte_draft_document_type_guard
before update on public.dte_invoice_drafts
for each row execute function public.dte_draft_document_type_guard();

-- Normalize the intent from the new explicit choice before the pre-existing
-- snapshot trigger runs. Historical rows with no choice stay blocked instead
-- of inheriting the former consumer-document default (39).
create or replace function public.dte_apply_explicit_document_selection()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  selected_type integer;
begin
  if new.appointment_id is null then return new; end if;
  select a.tax_document_selection into selected_type
    from public.appointments a
   where a.tenant_id=new.tenant_id and a.id=new.appointment_id;
  if not found then raise exception 'DTE_APPOINTMENT_TENANT_MISMATCH'; end if;

  if selected_type is null then
    -- `requested_document` is legacy NOT NULL invoice/consumer. Invoice is
    -- used only as a neutral non-consumer sentinel; resolved type stays NULL.
    new.requested_document := 'invoice';
    new.resolved_dte_type := null;
    new.status := 'BLOCKED';
    new.safe_blocking_reason := 'DOCUMENT_SELECTION_REQUIRED';
  elsif selected_type=33 then
    new.requested_document := 'invoice';
    new.resolved_dte_type := 33;
  elsif selected_type=39 then
    new.requested_document := 'consumer';
    new.resolved_dte_type := 39;
  else
    raise exception 'DTE_DOCUMENT_SELECTION_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists dte_intent_00_explicit_document_selection
  on public.dte_payment_document_intents;
create trigger dte_intent_00_explicit_document_selection
before insert on public.dte_payment_document_intents
for each row execute function public.dte_apply_explicit_document_selection();

-- Type 39 payment intents create one review draft through the same sales
-- snapshot model. Automation is still disabled, so no executable outbox exists.
create or replace function public.dte_mirror_boleta_intent_to_draft()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  sale_id_value uuid;
  draft_id_value uuid;
  line_description text;
  line_net bigint;
  line_tax bigint;
begin
  if new.resolved_dte_type <> 39 or new.customer_id is null then return new; end if;
  line_description := coalesce(
    new.immutable_snapshot#>>'{lines,0,description}',
    new.appointment_snapshot->>'serviceName','Servicio'
  );
  line_net := coalesce(
    (new.immutable_snapshot#>>'{money,netAmount}')::bigint,
    (new.immutable_snapshot#>>'{taxes,net}')::bigint,
    round(new.amount_snapshot/1.19)
  );
  line_tax := new.amount_snapshot-line_net;

  insert into public.billing_sales(
    tenant_id,customer_id,payment_intent_id,status,net_amount,tax_amount,
    total_amount,paid_amount,payment_snapshot,requested_document_type,
    created_by
  ) values (
    new.tenant_id,new.customer_id,new.payment_intent_id,'DRAFT',line_net,line_tax,
    new.amount_snapshot,new.amount_snapshot,new.immutable_snapshot->'payment',39,
    new.created_by
  ) on conflict (tenant_id,payment_intent_id) do update
    set updated_at=public.billing_sales.updated_at
  returning id into sale_id_value;

  insert into public.billing_sale_items(
    tenant_id,sale_id,service_id,position,description,quantity,unit_net_amount,
    discount_amount,net_amount,tax_amount,total_amount,pricing_mode,
    catalog_unit_gross_amount,service_snapshot
  ) values (
    new.tenant_id,sale_id_value,
    nullif(new.appointment_snapshot->>'serviceId','')::uuid,1,
    line_description,1,line_net,0,line_net,line_tax,new.amount_snapshot,
    'catalog_gross',new.amount_snapshot,
    jsonb_build_object('capturedFrom','verified_payment','documentType',39)
  ) on conflict (tenant_id,sale_id,position) do nothing;

  update public.billing_sales
     set status='PAID',document_selection_locked_at=now(),updated_at=now()
   where tenant_id=new.tenant_id and id=sale_id_value and status='DRAFT';

  insert into public.dte_invoice_drafts(
    tenant_id,sale_id,customer_id,appointment_id,payment_intent_id,
    source_intent_id,dte_type,source,status,issuer_preview,recipient_preview,
    net_amount,tax_amount,total_amount,payment_amount_snapshot,review_reason,
    idempotency_key,intent_id,created_by
  ) values (
    new.tenant_id,sale_id_value,new.customer_id,new.appointment_id,
    new.payment_intent_id,new.id,39,'automatic_payment','REVIEW_REQUIRED',
    coalesce(new.immutable_snapshot->'issuer','{}'::jsonb),
    coalesce(new.immutable_snapshot->'receiver','{}'::jsonb),
    line_net,line_tax,new.amount_snapshot,new.amount_snapshot,
    coalesce(new.safe_blocking_reason,'BOLETA_39_REQUIRES_REVIEW'),
    new.idempotency_key,new.id,new.created_by
  ) on conflict (tenant_id,payment_intent_id)
    where payment_intent_id is not null do nothing
  returning id into draft_id_value;

  if draft_id_value is not null then
    insert into public.dte_invoice_draft_lines(
      tenant_id,draft_id,service_id,appointment_id,position,description,
      quantity,unit_net_amount,discount_amount,net_amount,tax_amount,total_amount,
      pricing_mode,catalog_unit_gross_amount,catalog_snapshot
    ) values (
      new.tenant_id,draft_id_value,
      nullif(new.appointment_snapshot->>'serviceId','')::uuid,new.appointment_id,
      1,line_description,1,line_net,0,line_net,line_tax,new.amount_snapshot,
      'catalog_gross',new.amount_snapshot,
      jsonb_build_object('capturedFrom','verified_payment','documentType',39)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists dte_intent_mirror_boleta_draft
  on public.dte_payment_document_intents;
create trigger dte_intent_mirror_boleta_draft
after insert on public.dte_payment_document_intents
for each row execute function public.dte_mirror_boleta_intent_to_draft();

alter table public.dte_tenant_document_capabilities enable row level security;
revoke all on public.dte_tenant_document_capabilities from anon,authenticated;
grant select on public.dte_tenant_document_capabilities to authenticated;

create policy dte_tenant_document_capabilities_tenant_read
  on public.dte_tenant_document_capabilities
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id,auth.uid()) or
    public.is_platform_admin(auth.uid())
  );

comment on table public.dte_tenant_document_capabilities is
  'Fail-closed tenant/environment/type capability. PRE-CAF never enables production issuance.';
comment on column public.appointments.tax_document_selection is
  'Explicit customer/admin choice: 33 factura, 39 boleta, NULL historical/unselected.';
comment on column public.billing_sales.requested_document_type is
  'Single primary tax document choice frozen with the commercial sale snapshot.';
