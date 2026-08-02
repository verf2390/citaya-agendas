-- Accounting completion for service payment policies. This migration creates
-- review drafts only. It never creates productive intents/outbox work, enables
-- issuance, allocates a folio, calls a payment provider or contacts the SII.

alter table public.services
  add column if not exists deposit_min_amount bigint,
  add column if not exists deposit_max_amount bigint;

alter table public.services drop constraint if exists services_payment_policy_deposit_shape;
alter table public.services add constraint services_payment_policy_deposit_shape check (
  price is not null and price=trunc(price) and price>=0 and
  ((payment_policy='no_advance' and deposit_type is null and deposit_value is null
      and deposit_min_amount is null and deposit_max_amount is null) or
   (payment_policy='full_payment' and price>0 and deposit_type is null and deposit_value is null
      and deposit_min_amount is null and deposit_max_amount is null) or
   (payment_policy='deposit' and price>0 and (
      (deposit_type='fixed_amount' and deposit_value>0 and deposit_value<=price::bigint) or
      (deposit_type='percentage' and deposit_value between 1 and 9999)
    ) and (deposit_min_amount is null or deposit_min_amount between 1 and price::bigint)
      and (deposit_max_amount is null or deposit_max_amount between 1 and price::bigint)
      and (deposit_min_amount is null or deposit_max_amount is null or deposit_min_amount<=deposit_max_amount))
));

create or replace function public.billing_calculate_initial_due(
  p_total bigint,p_policy text,p_deposit_type text,p_deposit_value bigint,
  p_minimum bigint default null,p_maximum bigint default null
) returns bigint language plpgsql immutable set search_path=public as $$
declare calculated bigint;
begin
  if p_total<0 then raise exception 'PAYMENT_TOTAL_INVALID'; end if;
  if p_policy='no_advance' then return 0; end if;
  if p_total=0 then raise exception 'ZERO_PRICE_ADVANCE_UNSUPPORTED'; end if;
  if p_policy='full_payment' then return p_total; end if;
  if p_policy<>'deposit' then raise exception 'PAYMENT_POLICY_INVALID'; end if;
  if p_deposit_type='percentage' then
    if p_deposit_value not between 1 and 9999 then raise exception 'DEPOSIT_PERCENTAGE_OUT_OF_RANGE'; end if;
    calculated:=(p_total*p_deposit_value+5000)/10000;
  elsif p_deposit_type='fixed_amount' then
    if p_deposit_value<=0 then raise exception 'DEPOSIT_FIXED_AMOUNT_INVALID'; end if;
    calculated:=p_deposit_value;
  else raise exception 'DEPOSIT_TYPE_INVALID'; end if;
  if p_minimum is not null then calculated:=greatest(calculated,p_minimum); end if;
  if p_maximum is not null then calculated:=least(calculated,p_maximum); end if;
  return least(calculated,p_total);
end;
$$;

create or replace function public.service_commercial_publication_guard()
returns trigger language plpgsql set search_path=public as $$
declare legal_ready boolean;tenant_deposit_status text;boleta_model text;
  model_verified_at timestamptz;model_verified_by uuid;model_reference text;
begin
  if new.is_active and (
    new.payment_configuration_complete is not true or
    new.tax_description_review_status<>'approved' or
    length(trim(coalesce(new.tax_description,'')))<2
  ) then raise exception 'SERVICE_COMMERCIAL_OR_TAX_REVIEW_INCOMPLETE'; end if;
  if new.is_active and new.payment_policy in ('deposit','full_payment') and coalesce(new.price,0)<=0
  then raise exception 'ZERO_PRICE_ADVANCE_UNSUPPORTED'; end if;
  if new.is_active and new.payment_policy='deposit' then
    if new.tax_treatment='exempt' then raise exception 'EXEMPT_DOCUMENT_TYPE_UNSUPPORTED'; end if;
    if not public.tenant_is_operational(new.tenant_id) then raise exception 'TENANT_ARCHIVED'; end if;
    select coalesce((public.tenant_legal_gate_report(new.tenant_id)->>'ready')::boolean,false)
      into legal_ready;
    select deposit_tax_document_policy_status,boleta_payment_document_model,
      boleta_model_verified_at,boleta_model_verified_by,boleta_model_evidence_reference
      into tenant_deposit_status,boleta_model,model_verified_at,model_verified_by,model_reference
      from public.dte_tenant_issuance_settings where tenant_id=new.tenant_id;
    if new.deposit_tax_document_policy_status<>'enabled' or
       coalesce(tenant_deposit_status,'unconfigured')<>'enabled' or not legal_ready or
       coalesce(boleta_model,'unconfigured')='unconfigured' or model_verified_at is null or
       model_verified_by is null or length(trim(coalesce(model_reference,'')))<3
    then raise exception 'DEPOSIT_TAX_DOCUMENT_POLICY_NOT_ENABLED'; end if;
  end if;
  return new;
end;
$$;

alter table public.billing_sale_items
  add column if not exists deposit_min_amount_snapshot bigint,
  add column if not exists deposit_max_amount_snapshot bigint,
  add column if not exists rounding_policy_snapshot text not null default 'HALF_UP_BASIS_POINTS'
    check (rounding_policy_snapshot='HALF_UP_BASIS_POINTS');

alter table public.billing_payment_schedule
  add column if not exists payment_intent_id uuid,
  add column if not exists expires_at timestamptz,
  add column if not exists completion_condition text not null default 'VERIFIED_PAYMENT'
    check (completion_condition='VERIFIED_PAYMENT');

do $$declare c record;begin
  for c in select conname from pg_constraint where conrelid='public.billing_payment_schedule'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%status%PENDING%PARTIALLY_PAID%PAID%CANCELED%'
  loop execute format('alter table public.billing_payment_schedule drop constraint %I',c.conname);end loop;
end$$;
alter table public.billing_payment_schedule add constraint billing_payment_schedule_status_check
  check (status in ('PENDING','PARTIALLY_PAID','PAID','CANCELED','EXPIRED'));
create unique index if not exists billing_payment_schedule_one_kind_per_sale
  on public.billing_payment_schedule(tenant_id,sale_id,installment_kind)
  where installment_kind in ('initial','balance');

create table public.billing_payment_schedule_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  schedule_id uuid not null,
  sale_id uuid not null,
  sale_item_id uuid not null,
  position integer not null check (position between 1 and 50),
  amount_from bigint not null check (amount_from>=0),
  amount_to bigint not null check (amount_to>amount_from),
  amount_range int8range generated always as (int8range(amount_from,amount_to,'[)')) stored,
  allocated_amount bigint generated always as (amount_to-amount_from) stored,
  created_at timestamptz not null default now(),
  foreign key (tenant_id,schedule_id) references public.billing_payment_schedule(tenant_id,id) on delete restrict,
  foreign key (tenant_id,sale_id,sale_item_id) references public.billing_sale_items(tenant_id,sale_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,schedule_id,sale_item_id),
  exclude using gist (tenant_id with =,sale_item_id with =,amount_range with &&)
);
create or replace function public.billing_schedule_allocation_immutable()
returns trigger language plpgsql set search_path=public as $$begin
  raise exception 'BILLING_SCHEDULE_ALLOCATION_IMMUTABLE';
end$$;
create trigger billing_schedule_allocation_immutable before update or delete
on public.billing_payment_schedule_allocations for each row execute function public.billing_schedule_allocation_immutable();

alter table public.payment_intents
  add column if not exists billing_payment_schedule_id uuid,
  add column if not exists tax_document_method_classification text not null default 'unconfigured'
    check (tax_document_method_classification in ('unconfigured','voucher_as_boleta','requires_boleta')),
  add column if not exists reconciliation_reason text;
alter table public.payment_intents add constraint payment_intents_schedule_tenant_fk
  foreign key (tenant_id,billing_payment_schedule_id)
  references public.billing_payment_schedule(tenant_id,id) on delete restrict;
create unique index if not exists payment_intents_one_active_per_schedule
  on public.payment_intents(tenant_id,billing_payment_schedule_id)
  where billing_payment_schedule_id is not null and status in ('created','pending','processing');

alter table public.billing_sale_payments
  add column if not exists schedule_id uuid,
  add column if not exists refund_tax_status text not null default 'NOT_REQUESTED'
    check (refund_tax_status in ('NOT_REQUESTED','REFUND_TAX_DOCUMENT_REQUIRED','CLEARED_FOR_FINANCIAL_REVIEW')),
  add column if not exists refund_reviewed_at timestamptz,
  add column if not exists refund_reviewed_by uuid;
alter table public.billing_sale_payments add constraint billing_sale_payments_schedule_tenant_fk
  foreign key (tenant_id,schedule_id) references public.billing_payment_schedule(tenant_id,id) on delete restrict;

alter table public.dte_invoice_drafts
  add column if not exists billing_sale_payment_id uuid;
alter table public.dte_invoice_drafts add constraint dte_invoice_drafts_sale_payment_tenant_fk
  foreign key (tenant_id,billing_sale_payment_id) references public.billing_sale_payments(tenant_id,id) on delete restrict;
create unique index if not exists dte_invoice_drafts_one_per_verified_sale_payment
  on public.dte_invoice_drafts(tenant_id,billing_sale_payment_id)
  where billing_sale_payment_id is not null;

drop index if exists public.dte_one_active_intent_per_sale;
create unique index if not exists dte_one_active_intent_per_verified_sale_payment
  on public.dte_payment_document_intents(tenant_id,payment_intent_id)
  where payment_intent_id is not null and status in (
    'PENDING','PREPARING','READY','SUBMITTING','SUBMITTED','ACCEPTED',
    'ACCEPTED_WITH_OBJECTIONS','AMBIGUOUS','DELIVERY_PENDING','DELIVERED'
  );

alter table public.billing_sale_item_document_coverage
  add column if not exists payment_schedule_allocation_id uuid;
alter table public.billing_sale_item_document_coverage add constraint billing_coverage_schedule_allocation_tenant_fk
  foreign key (tenant_id,payment_schedule_allocation_id)
  references public.billing_payment_schedule_allocations(tenant_id,id) on delete restrict;
do $$declare c record;begin
  for c in select conname from pg_constraint where conrelid='public.billing_sale_item_document_coverage'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%coverage_source%'
  loop execute format('alter table public.billing_sale_item_document_coverage drop constraint %I',c.conname);end loop;
end$$;
alter table public.billing_sale_item_document_coverage add constraint billing_coverage_source_shape check (
  (coverage_source='DTE' and (draft_id is not null or production_document_id is not null)) or
  (coverage_source='ELECTRONIC_PAYMENT_VOUCHER' and dte_type=39 and sale_payment_id is not null
    and draft_id is null and production_document_id is null)
);
create unique index if not exists billing_coverage_one_per_schedule_allocation
  on public.billing_sale_item_document_coverage(tenant_id,payment_schedule_allocation_id)
  where payment_schedule_allocation_id is not null and status<>'VOID';

create or replace function public.billing_document_coverage_immutable()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'DOCUMENT_COVERAGE_APPEND_ONLY';end if;
  if old.tenant_id is distinct from new.tenant_id or old.sale_id is distinct from new.sale_id or
     old.sale_item_id is distinct from new.sale_item_id or old.dte_type is distinct from new.dte_type or
     old.amount_from is distinct from new.amount_from or old.amount_to is distinct from new.amount_to or
     old.coverage_source is distinct from new.coverage_source or
     old.sale_payment_id is distinct from new.sale_payment_id or
     old.payment_schedule_allocation_id is distinct from new.payment_schedule_allocation_id or
     old.related_coverage_id is distinct from new.related_coverage_id or
     old.document_relation_status is distinct from new.document_relation_status or
     old.draft_id is distinct from new.draft_id or old.production_document_id is distinct from new.production_document_id or
     not (old.status='PLANNED' and new.status in ('PLANNED','ISSUED','VOID') or
          old.status='ISSUED' and new.status in ('ISSUED','ACCEPTED','VOID') or old.status=new.status)
  then raise exception 'DOCUMENT_COVERAGE_IMMUTABLE';end if;
  new.updated_at:=now();return new;
end$$;

create table public.billing_payment_schedule_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  schedule_id uuid not null,
  event_type text not null check (event_type in ('CREATED','INTENT_LINKED','PAID','EXPIRED','RECONCILIATION_REQUIRED')),
  safe_reason text,
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id,schedule_id) references public.billing_payment_schedule(tenant_id,id) on delete restrict
);

create table public.tenant_payment_method_tax_policies (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  provider text not null check (provider in ('mercadopago','webpay','khipu','manual')),
  classification text not null check (classification in ('voucher_as_boleta','requires_boleta')),
  verified_at timestamptz not null,
  verified_by uuid not null,
  evidence_reference text not null check (length(trim(evidence_reference)) between 3 and 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,provider)
);
create or replace function public.billing_schedule_events_append_only()
returns trigger language plpgsql set search_path=public as $$begin
  raise exception 'BILLING_SCHEDULE_EVENTS_APPEND_ONLY';
end$$;
create trigger billing_schedule_events_append_only before update or delete
on public.billing_payment_schedule_events for each row execute function public.billing_schedule_events_append_only();

create or replace function public.billing_schedule_reference_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.payment_intent_id is not null and not exists(select 1 from public.payment_intents p
    where p.tenant_id=new.tenant_id and p.id=new.payment_intent_id
      and p.billing_payment_schedule_id=new.id)
  then raise exception 'BILLING_SCHEDULE_PAYMENT_INTENT_MISMATCH';end if;
  return new;
end$$;
create trigger billing_schedule_payment_intent_guard before update of payment_intent_id
on public.billing_payment_schedule for each row execute function public.billing_schedule_reference_guard();

create or replace function public.deposit_payment_intent_gate()
returns trigger language plpgsql security definer set search_path=public as $$
declare a public.appointments%rowtype;tenant_status text;boleta_model text;
  boleta_verified_at timestamptz;boleta_verified_by uuid;boleta_evidence text;
  schedule_sale uuid;deposit_unready boolean;expected_amount bigint;
begin
  select * into a from public.appointments where id=new.appointment_id and tenant_id=new.tenant_id;
  if new.billing_payment_schedule_id is null then raise exception 'PAYMENT_SCHEDULE_REQUIRED'; end if;
  select sale_id,amount-paid_amount into schedule_sale,expected_amount
    from public.billing_payment_schedule where tenant_id=new.tenant_id
      and id=new.billing_payment_schedule_id and status in ('PENDING','PARTIALLY_PAID');
  if schedule_sale is null or new.amount<>trunc(new.amount) or new.amount::bigint<>expected_amount
  then raise exception 'PAYMENT_SCHEDULE_AMOUNT_MISMATCH';end if;
  select deposit_tax_document_policy_status,boleta_payment_document_model,
    boleta_model_verified_at,boleta_model_verified_by,boleta_model_evidence_reference
    into tenant_status,boleta_model,boleta_verified_at,boleta_verified_by,boleta_evidence
    from public.dte_tenant_issuance_settings where tenant_id=new.tenant_id;
  select exists(select 1 from public.billing_sale_items i where i.tenant_id=new.tenant_id
    and i.sale_id=schedule_sale and i.payment_policy_snapshot='deposit'
    and (i.deposit_tax_document_policy_status_snapshot<>'enabled' or
      coalesce(tenant_status,'unconfigured')<>'enabled')) into deposit_unready;
  if deposit_unready then raise exception 'DEPOSIT_TAX_DOCUMENT_POLICY_NOT_ENABLED';end if;
  if a.requested_document_type=39 and (coalesce(boleta_model,'unconfigured')='unconfigured'
     or boleta_verified_at is null or boleta_verified_by is null
     or length(trim(coalesce(boleta_evidence,'')))<3)
  then raise exception 'BOLETA_PAYMENT_DOCUMENT_MODEL_UNCONFIGURED';end if;
  if a.requested_document_type=39 and boleta_model='always_issue_boleta'
     and new.tax_document_method_classification<>'requires_boleta'
  then raise exception 'PAYMENT_METHOD_TAX_CLASSIFICATION_REQUIRED';end if;
  if a.requested_document_type=39 and boleta_model='electronic_payment_voucher_as_boleta'
     and not exists(select 1 from public.tenant_payment_method_tax_policies p
       where p.tenant_id=new.tenant_id and p.provider=new.provider and p.active
         and p.classification=new.tax_document_method_classification)
  then raise exception 'PAYMENT_METHOD_TAX_CLASSIFICATION_REQUIRED';end if;
  if not public.tenant_is_operational(new.tenant_id) then raise exception 'TENANT_ARCHIVED';end if;
  return new;
end$$;

create or replace function public.billing_initialize_sale_from_appointments(
  p_tenant_id uuid,p_customer_id uuid,p_appointment_ids uuid[],p_requested_document_type integer
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_appointment_id uuid;a public.appointments%rowtype;s public.services%rowtype;
  v_sale_id uuid:=gen_random_uuid();line_position integer:=0;line_total bigint;line_initial bigint;
  line_net bigint;line_tax bigint;sale_total bigint:=0;sale_initial bigint:=0;
  sale_net bigint:=0;sale_tax bigint:=0;initial_schedule uuid;balance_schedule uuid;
begin
  if p_requested_document_type not in (33,39) or cardinality(p_appointment_ids) not between 1 and 50
  then raise exception 'SALE_INPUT_INVALID';end if;
  if not public.tenant_is_operational(p_tenant_id) then raise exception 'TENANT_ARCHIVED';end if;
  if exists(select 1 from public.billing_sale_appointments where tenant_id=p_tenant_id
    and appointment_id=any(p_appointment_ids)) then
    if cardinality(p_appointment_ids)=1 then
      return (select sale_id from public.billing_sale_appointments where tenant_id=p_tenant_id
        and appointment_id=p_appointment_ids[1]);
    end if;
    raise exception 'APPOINTMENT_ALREADY_LINKED_TO_SALE';
  end if;
  foreach v_appointment_id in array p_appointment_ids loop
    select * into a from public.appointments where tenant_id=p_tenant_id and id=v_appointment_id for update;
    if not found or a.customer_id is distinct from p_customer_id then raise exception 'SALE_APPOINTMENT_CUSTOMER_MISMATCH';end if;
    if coalesce(a.requested_document_type,p_requested_document_type)<>p_requested_document_type
    then raise exception 'SALE_DOCUMENT_SELECTION_MISMATCH';end if;
    select * into s from public.services where tenant_id=p_tenant_id and id=a.service_id for share;
    if not found or not s.is_active or s.payment_configuration_complete is not true
      or s.tax_description_review_status<>'approved' or length(trim(coalesce(s.tax_description,'')))<2
    then raise exception 'SERVICE_PAYMENT_OR_TAX_CONFIGURATION_INCOMPLETE';end if;
    if s.tax_treatment='exempt' then raise exception 'EXEMPT_DOCUMENT_TYPE_UNSUPPORTED';end if;
    line_total:=s.price::bigint;
    line_initial:=public.billing_calculate_initial_due(line_total,s.payment_policy,
      coalesce(s.deposit_type,''),coalesce(s.deposit_value,0),s.deposit_min_amount,s.deposit_max_amount);
    line_net:=(line_total*100+59)/119;line_tax:=line_total-line_net;
    sale_total:=sale_total+line_total;sale_initial:=sale_initial+line_initial;
    sale_net:=sale_net+line_net;sale_tax:=sale_tax+line_tax;
  end loop;
  insert into public.billing_sales(id,tenant_id,customer_id,currency,status,net_amount,tax_amount,total_amount,
    paid_amount,initial_payment_due,balance_due,payment_state,tax_treatment_status,document_status,
    requested_document_type,payment_snapshot,pending_documentation_amount)
  values(v_sale_id,p_tenant_id,p_customer_id,'CLP','PAYMENT_PENDING',sale_net,sale_tax,sale_total,0,
    sale_initial,sale_total,'UNPAID','PENDING','UNCOVERED',p_requested_document_type,
    jsonb_build_object('policySource','immutable_service_line_snapshots','priceSemantics','gross_clp','containsPII',false),sale_total);
  foreach v_appointment_id in array p_appointment_ids loop
    line_position:=line_position+1;
    select * into a from public.appointments where tenant_id=p_tenant_id and id=v_appointment_id;
    select * into s from public.services where tenant_id=p_tenant_id and id=a.service_id;
    line_total:=s.price::bigint;
    line_initial:=public.billing_calculate_initial_due(line_total,s.payment_policy,
      coalesce(s.deposit_type,''),coalesce(s.deposit_value,0),s.deposit_min_amount,s.deposit_max_amount);
    line_net:=(line_total*100+59)/119;line_tax:=line_total-line_net;
    insert into public.billing_sale_items(tenant_id,sale_id,service_id,appointment_id,position,description,
      quantity,unit_net_amount,discount_amount,net_amount,tax_amount,total_amount,pricing_mode,
      catalog_unit_gross_amount,service_snapshot,public_description_snapshot,tax_description_snapshot,
      tax_description_review_status_snapshot,contains_sensitive_information_snapshot,payment_policy_snapshot,
      deposit_type_snapshot,deposit_value_snapshot,deposit_min_amount_snapshot,deposit_max_amount_snapshot,
      deposit_tax_document_policy_status_snapshot,initial_payment_due,balance_due,tax_treatment_snapshot,
      rounding_policy_snapshot)
    values(p_tenant_id,v_sale_id,s.id,a.id,line_position,s.tax_description,1,greatest(line_net,1),0,
      line_net,line_tax,line_total,'catalog_gross',greatest(line_total,1),
      jsonb_build_object('serviceId',s.id,'name',s.name,'containsPII',false,'priceSemantics','gross_clp'),
      s.public_description,s.tax_description,s.tax_description_review_status,
      s.contains_potentially_sensitive_information,s.payment_policy,s.deposit_type,s.deposit_value,
      s.deposit_min_amount,s.deposit_max_amount,s.deposit_tax_document_policy_status,line_initial,line_total,
      s.tax_treatment,'HALF_UP_BASIS_POINTS');
    insert into public.billing_sale_appointments(tenant_id,sale_id,appointment_id)
    values(p_tenant_id,v_sale_id,a.id);
    update public.appointments set payment_policy_snapshot=s.payment_policy,deposit_type_snapshot=s.deposit_type,
      deposit_value_snapshot=s.deposit_value,
      deposit_tax_document_policy_status_snapshot=s.deposit_tax_document_policy_status,
      sale_total_amount=line_total,initial_payment_due=line_initial,balance_due=line_total,
      provisional_expires_at=case when sale_initial>0 then now()+make_interval(mins=>s.provisional_expiry_minutes) end,
      tax_treatment_status='PENDING',payment_required=(sale_initial>0),payment_required_amount=sale_initial,
      payment_remaining_amount=sale_total,status=case when sale_initial=0 then 'confirmed' else 'pending_payment' end,
      booking_status=case when sale_initial=0 then 'confirmed' else 'pending_payment' end,updated_at=now()
    where id=a.id and tenant_id=p_tenant_id;
  end loop;
  if sale_initial>0 then
    insert into public.billing_payment_schedule(tenant_id,sale_id,installment_kind,amount,due_at,expires_at)
    values(p_tenant_id,v_sale_id,'initial',sale_initial,now(),
      (select min(provisional_expires_at) from public.appointments where tenant_id=p_tenant_id and id=any(p_appointment_ids)))
    returning id into initial_schedule;
    insert into public.billing_payment_schedule_allocations(tenant_id,schedule_id,sale_id,sale_item_id,position,amount_from,amount_to)
    select tenant_id,initial_schedule,sale_id,id,position,0,initial_payment_due
    from public.billing_sale_items where tenant_id=p_tenant_id and sale_id=v_sale_id
      and initial_payment_due>0 order by position;
    insert into public.billing_payment_schedule_events(tenant_id,schedule_id,event_type,safe_reason)
    values(p_tenant_id,initial_schedule,'CREATED','INITIAL_POLICY_ALLOCATION');
  end if;
  if sale_total-sale_initial>0 then
    insert into public.billing_payment_schedule(tenant_id,sale_id,installment_kind,amount)
    values(p_tenant_id,v_sale_id,'balance',sale_total-sale_initial) returning id into balance_schedule;
    insert into public.billing_payment_schedule_allocations(tenant_id,schedule_id,sale_id,sale_item_id,position,amount_from,amount_to)
    select tenant_id,balance_schedule,sale_id,id,position,initial_payment_due,total_amount
    from public.billing_sale_items where tenant_id=p_tenant_id and sale_id=v_sale_id
      and initial_payment_due<total_amount order by position;
    insert into public.billing_payment_schedule_events(tenant_id,schedule_id,event_type,safe_reason)
    values(p_tenant_id,balance_schedule,'CREATED','BALANCE_POLICY_ALLOCATION');
  end if;
  return v_sale_id;
end$$;

create or replace function public.billing_initialize_appointment_sale(
  p_tenant_id uuid,p_appointment_id uuid,p_requested_document_type integer
) returns uuid language sql security definer set search_path=public as $$
  select public.billing_initialize_sale_from_appointments(
    p_tenant_id,(select customer_id from public.appointments where tenant_id=p_tenant_id and id=p_appointment_id),
    array[p_appointment_id],p_requested_document_type
  );
$$;

create or replace function public.billing_create_payment_review_document(
  p_tenant_id uuid,p_sale_payment_id uuid,p_payment_intent_id uuid,p_schedule_id uuid,p_provider text,
  p_method_classification text
) returns uuid language plpgsql security definer set search_path=public as $$
declare sale public.billing_sales%rowtype;sale_payment public.billing_sale_payments%rowtype;
  decision jsonb;draft_id uuid;document_net bigint;document_tax bigint;uncovered bigint;
begin
  select * into sale_payment from public.billing_sale_payments where tenant_id=p_tenant_id and id=p_sale_payment_id;
  select * into sale from public.billing_sales where tenant_id=p_tenant_id and id=sale_payment.sale_id;
  if sale.tax_treatment_status='EXEMPT_DOCUMENT_TYPE_UNSUPPORTED' then return null;end if;
  if sale.requested_document_type=39 and p_method_classification='requires_boleta' then
    decision:=jsonb_build_object('action','ISSUE_BOLETA_39','createBoleta39',true,
      'coveredByVoucher',false,'blocked',false);
  else
    decision:=public.dte_payment_document_policy_decision(
      p_tenant_id,sale.requested_document_type,p_provider,p_method_classification='voucher_as_boleta');
  end if;
  select coalesce(sum(a.allocated_amount),0) into uncovered
  from public.billing_payment_schedule_allocations a
  where a.tenant_id=p_tenant_id and a.schedule_id=p_schedule_id and not exists(
    select 1 from public.billing_sale_item_document_coverage c where c.tenant_id=a.tenant_id
      and c.sale_item_id=a.sale_item_id and c.status<>'VOID' and c.amount_range&&a.amount_range);
  if uncovered=0 then return null;end if;
  if uncovered<>sale_payment.amount then
    update public.billing_sale_payments set reconciliation_status='REVIEW_REQUIRED'
      where tenant_id=p_tenant_id and id=p_sale_payment_id;
    return null;
  end if;
  if decision->>'action'='COVERED_BY_ELECTRONIC_PAYMENT_VOUCHER' then
    insert into public.billing_sale_item_document_coverage(
      tenant_id,sale_id,sale_item_id,dte_type,amount_from,amount_to,status,coverage_source,
      sale_payment_id,payment_schedule_allocation_id,document_relation_status)
    select a.tenant_id,a.sale_id,a.sale_item_id,39,a.amount_from,a.amount_to,'ACCEPTED',
      'ELECTRONIC_PAYMENT_VOUCHER',p_sale_payment_id,a.id,'VALIDATED'
    from public.billing_payment_schedule_allocations a where a.tenant_id=p_tenant_id and a.schedule_id=p_schedule_id;
    update public.billing_sale_payments set voucher_tax_document_qualifies=true,
      voucher_reference_hash=encode(digest(convert_to('voucher:'||id::text,'UTF8'),'sha256'),'hex')
      where tenant_id=p_tenant_id and id=p_sale_payment_id;
    return null;
  end if;
  if coalesce((decision->>'blocked')::boolean,true) or
     decision->>'action' not in ('ISSUE_FACTURA_33','ISSUE_BOLETA_39') then
    update public.billing_sale_payments set reconciliation_status='REVIEW_REQUIRED'
      where tenant_id=p_tenant_id and id=p_sale_payment_id;
    return null;
  end if;
  if sale.requested_document_type=33 and not exists(
    select 1 from public.customer_tax_profiles p where p.tenant_id=p_tenant_id
      and p.customer_id=sale.customer_id and length(trim(p.rut_normalized))>=8
      and length(trim(p.legal_name))>=2 and length(trim(p.business_activity))>=2
      and length(trim(p.tax_address))>=2 and length(trim(p.tax_commune))>=2
      and length(trim(p.tax_city))>=2
  ) then
    update public.billing_sale_payments set reconciliation_status='REVIEW_REQUIRED'
      where tenant_id=p_tenant_id and id=p_sale_payment_id;
    return null;
  end if;
  select id into draft_id from public.dte_invoice_drafts
    where tenant_id=p_tenant_id and billing_sale_payment_id=p_sale_payment_id;
  if draft_id is not null then return draft_id;end if;
  if sale.payment_state='PAID' and not exists(
    select 1 from public.billing_sale_item_document_coverage c where c.tenant_id=p_tenant_id
      and c.sale_id=sale.id and c.status<>'VOID' and c.coverage_source='ELECTRONIC_PAYMENT_VOUCHER'
  ) then
    -- The final DTE tranche absorbs the net/IVA rounding residue so all partial
    -- documents reconcile exactly with the frozen gross sale.
    select sale.net_amount-coalesce(sum(d.net_amount),0) into document_net
    from public.dte_invoice_drafts d where d.tenant_id=p_tenant_id and d.sale_id=sale.id;
  else
    document_net:=(sale_payment.amount*100+59)/119;
  end if;
  document_tax:=sale_payment.amount-document_net;
  insert into public.dte_invoice_drafts(tenant_id,sale_id,customer_id,appointment_id,payment_intent_id,
    billing_sale_payment_id,dte_type,source,status,issuer_preview,recipient_preview,net_amount,tax_amount,
    total_amount,payment_amount_snapshot,review_reason,idempotency_key)
  values(p_tenant_id,sale.id,sale.customer_id,sale_payment.appointment_id,p_payment_intent_id,
    p_sale_payment_id,sale.requested_document_type,'payment','REVIEW_REQUIRED','{}',
    case when sale.requested_document_type=39 then jsonb_build_object('documentType',39,'consumerIdentityIncluded',false)
      else jsonb_build_object('documentType',33,'recipientFrozen',false) end,
    document_net,document_tax,sale_payment.amount,sale_payment.amount,'MANUAL_DTE_REVIEW_REQUIRED',
    encode(digest(convert_to('sale-payment:'||p_sale_payment_id::text||':type:'||sale.requested_document_type::text,'UTF8'),'sha256'),'hex'))
  returning id into draft_id;
  with source_lines as (
    select a.*,i.service_id,i.appointment_id,i.tax_description_snapshot,i.payment_policy_snapshot,
      a.allocated_amount gross_amount,(a.allocated_amount*document_net)/sale_payment.amount base_net,
      (a.allocated_amount*document_net)%sale_payment.amount remainder
    from public.billing_payment_schedule_allocations a join public.billing_sale_items i
      on i.tenant_id=a.tenant_id and i.sale_id=a.sale_id and i.id=a.sale_item_id
    where a.tenant_id=p_tenant_id and a.schedule_id=p_schedule_id
  ), ranked as (
    select s.*,row_number() over(order by remainder desc,position) remainder_rank,
      document_net-sum(base_net) over() residual from source_lines s
  ), allocated as (
    select *,base_net+case when remainder_rank<=residual then 1 else 0 end line_net from ranked
  ) insert into public.dte_invoice_draft_lines(tenant_id,draft_id,service_id,appointment_id,position,
    description,quantity,unit_net_amount,discount_basis_points,discount_amount,net_amount,tax_amount,
    total_amount,pricing_mode,catalog_unit_gross_amount,catalog_snapshot)
  select p_tenant_id,draft_id,service_id,appointment_id,row_number() over(order by position),
    left(case when (select installment_kind from public.billing_payment_schedule where tenant_id=p_tenant_id and id=p_schedule_id)='initial'
      and payment_policy_snapshot='deposit' then 'Anticipo ' else '' end||tax_description_snapshot,180),
    1,greatest(line_net,1),0,0,line_net,gross_amount-line_net,gross_amount,'catalog_gross',gross_amount,
    jsonb_build_object('saleItemId',sale_item_id,'scheduleAllocationId',id,'containsPII',false)
  from allocated order by position;
  insert into public.billing_sale_item_document_coverage(
    tenant_id,sale_id,sale_item_id,dte_type,amount_from,amount_to,status,coverage_source,
    sale_payment_id,payment_schedule_allocation_id,draft_id,document_relation_status)
  select a.tenant_id,a.sale_id,a.sale_item_id,sale.requested_document_type,a.amount_from,a.amount_to,
    'PLANNED','DTE',p_sale_payment_id,a.id,draft_id,'REVIEW_REQUIRED'
  from public.billing_payment_schedule_allocations a where a.tenant_id=p_tenant_id and a.schedule_id=p_schedule_id;
  return draft_id;
end$$;

create or replace function public.finalize_verified_payment(
  p_intent_id uuid,p_provider text,p_provider_payment_id text,p_audit_metadata jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare pi public.payment_intents%rowtype;sale public.billing_sales%rowtype;
  schedule public.billing_payment_schedule%rowtype;safe_audit jsonb;next_paid bigint;next_state text;
  sale_payment_id uuid;expected bigint;deposit_reconciliation boolean;
begin
  select * into pi from public.payment_intents where id=p_intent_id for update;
  if not found or pi.provider<>p_provider or pi.provider_payment_id<>p_provider_payment_id
  then raise exception 'payment_intent_mismatch';end if;
  if pi.status in ('succeeded','reconciliation_required') then return false;end if;
  if pi.status not in ('pending','processing') then raise exception 'payment_intent_not_payable';end if;
  select * into schedule from public.billing_payment_schedule where tenant_id=pi.tenant_id
    and id=pi.billing_payment_schedule_id for update;
  if not found then raise exception 'PAYMENT_SCHEDULE_REQUIRED';end if;
  select * into sale from public.billing_sales where tenant_id=pi.tenant_id and id=schedule.sale_id for update;
  expected:=schedule.amount-schedule.paid_amount;
  safe_audit:=public.payment_audit_metadata_minimal(p_provider,coalesce(p_audit_metadata,'{}'::jsonb));
  if pi.amount<>trunc(pi.amount) or pi.amount::bigint<>expected then
    update public.payment_intents set status='reconciliation_required',reconciliation_reason='PAYMENT_SCHEDULE_AMOUNT_MISMATCH',
      audit_metadata=safe_audit,processed_at=now(),updated_at=now() where id=pi.id;
    update public.payments set status='reconciliation_required',audit_metadata=safe_audit,processed_at=now(),updated_at=now()
      where tenant_id=pi.tenant_id and payment_intent_id=pi.id;
    insert into public.billing_sale_payments(tenant_id,sale_id,appointment_id,payment_intent_id,schedule_id,
      external_payment_reference,provider,amount,currency,status,validation_result,evidence_sha256,reconciliation_status)
    values(pi.tenant_id,sale.id,pi.appointment_id,pi.id,schedule.id,p_provider_payment_id,p_provider,
      pi.amount::bigint,pi.currency,'VERIFIED','amount_mismatch',
      encode(digest(convert_to(safe_audit::text,'UTF8'),'sha256'),'hex'),'REVIEW_REQUIRED');
    insert into public.billing_payment_schedule_events(tenant_id,schedule_id,event_type,safe_reason)
    values(pi.tenant_id,schedule.id,'RECONCILIATION_REQUIRED','PAYMENT_SCHEDULE_AMOUNT_MISMATCH');
    return false;
  end if;
  select exists(select 1 from public.billing_sale_items i where i.tenant_id=sale.tenant_id
    and i.sale_id=sale.id and i.payment_policy_snapshot='deposit'
    and (i.deposit_tax_document_policy_status_snapshot<>'enabled' or
      coalesce((select deposit_tax_document_policy_status from public.dte_tenant_issuance_settings
        where tenant_id=sale.tenant_id),'unconfigured')<>'enabled')) into deposit_reconciliation;
  if deposit_reconciliation then
    update public.payment_intents set status='reconciliation_required',reconciliation_reason='DEPOSIT_POLICY_NOT_ENABLED',
      audit_metadata=safe_audit,processed_at=now(),updated_at=now() where id=pi.id;
    insert into public.billing_sale_payments(tenant_id,sale_id,appointment_id,payment_intent_id,schedule_id,
      external_payment_reference,provider,amount,currency,status,validation_result,evidence_sha256,reconciliation_status)
    values(pi.tenant_id,sale.id,pi.appointment_id,pi.id,schedule.id,p_provider_payment_id,p_provider,
      pi.amount::bigint,pi.currency,'VERIFIED','historical_unexpected_deposit',
      encode(digest(convert_to(safe_audit::text,'UTF8'),'sha256'),'hex'),'REVIEW_REQUIRED');
    return false;
  end if;
  update public.payment_intents set status='succeeded',audit_metadata=safe_audit,processed_at=now(),updated_at=now() where id=pi.id;
  update public.payments set status='paid',provider=p_provider,currency=pi.currency,amount=pi.amount,
    external_reference=p_provider_payment_id,audit_metadata=safe_audit,processed_at=now(),updated_at=now()
    where tenant_id=pi.tenant_id and payment_intent_id=pi.id;
  insert into public.billing_sale_payments(tenant_id,sale_id,appointment_id,payment_intent_id,schedule_id,
    external_payment_reference,provider,amount,currency,status,validation_result,evidence_sha256,reconciliation_status)
  values(pi.tenant_id,sale.id,pi.appointment_id,pi.id,schedule.id,p_provider_payment_id,p_provider,pi.amount::bigint,
    pi.currency,'VERIFIED','provider_verified',encode(digest(convert_to(safe_audit::text,'UTF8'),'sha256'),'hex'),'NOT_REQUIRED')
  returning id into sale_payment_id;
  update public.billing_payment_schedule set paid_amount=amount,status='PAID',payment_intent_id=pi.id,updated_at=now()
    where tenant_id=pi.tenant_id and id=schedule.id;
  insert into public.billing_payment_schedule_events(tenant_id,schedule_id,event_type,safe_reason)
  values(pi.tenant_id,schedule.id,'PAID','VERIFIED_PROVIDER_PAYMENT');
  next_paid:=sale.paid_amount+pi.amount::bigint;
  next_state:=case when next_paid=sale.total_amount then 'PAID' else 'PARTIALLY_PAID' end;
  update public.billing_sales set paid_amount=next_paid,balance_due=total_amount-next_paid,payment_state=next_state,
    status=next_state,updated_at=now() where tenant_id=pi.tenant_id and id=sale.id;
  update public.appointments set payment_paid_amount=next_paid,payment_remaining_amount=sale.total_amount-next_paid,
    balance_due=sale.total_amount-next_paid,payment_status=case when next_state='PAID' then 'paid' else 'partially_paid' end,
    status=case when schedule.installment_kind='initial' then 'confirmed' else status end,
    booking_status=case when schedule.installment_kind='initial' then 'confirmed' else booking_status end,
    payment_provider=p_provider,payment_reference=p_provider_payment_id,updated_at=now()
    where tenant_id=pi.tenant_id and id in(select appointment_id from public.billing_sale_appointments
      where tenant_id=pi.tenant_id and sale_id=sale.id) and coalesce(status,'') not in ('canceled','cancelled');
  perform public.billing_create_payment_review_document(pi.tenant_id,sale_payment_id,pi.id,schedule.id,
    p_provider,pi.tax_document_method_classification);
  return true;
end$$;

create or replace function public.billing_record_unapplied_provider_payment(
  p_intent_id uuid,p_provider text,p_provider_payment_id text,p_received_amount numeric,p_audit_metadata jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare pi public.payment_intents%rowtype;schedule public.billing_payment_schedule%rowtype;
  sale public.billing_sales%rowtype;safe_audit jsonb;
begin
  select * into pi from public.payment_intents where id=p_intent_id for update;
  if not found or pi.provider<>p_provider then raise exception 'payment_intent_mismatch';end if;
  if pi.status in ('succeeded','reconciliation_required') then return false;end if;
  if p_received_amount<>trunc(p_received_amount) or p_received_amount<=0 or p_received_amount=pi.amount
  then raise exception 'UNAPPLIED_PAYMENT_AMOUNT_INVALID';end if;
  select * into schedule from public.billing_payment_schedule where tenant_id=pi.tenant_id
    and id=pi.billing_payment_schedule_id;
  select * into sale from public.billing_sales where tenant_id=pi.tenant_id and id=schedule.sale_id;
  safe_audit:=public.payment_audit_metadata_minimal(p_provider,coalesce(p_audit_metadata,'{}'::jsonb));
  update public.payment_intents set status='reconciliation_required',reconciliation_reason='PROVIDER_AMOUNT_MISMATCH',
    audit_metadata=safe_audit,processed_at=now(),updated_at=now() where id=pi.id;
  update public.payments set status='reconciliation_required',amount=p_received_amount,audit_metadata=safe_audit,
    processed_at=now(),updated_at=now() where tenant_id=pi.tenant_id and payment_intent_id=pi.id;
  insert into public.billing_sale_payments(tenant_id,sale_id,appointment_id,payment_intent_id,schedule_id,
    external_payment_reference,provider,amount,currency,status,validation_result,evidence_sha256,reconciliation_status)
  values(pi.tenant_id,sale.id,pi.appointment_id,pi.id,schedule.id,left(p_provider_payment_id,256),p_provider,
    p_received_amount::bigint,pi.currency,'VERIFIED','provider_amount_mismatch',
    encode(digest(convert_to(safe_audit::text,'UTF8'),'sha256'),'hex'),'REVIEW_REQUIRED');
  insert into public.billing_payment_schedule_events(tenant_id,schedule_id,event_type,safe_reason)
  values(pi.tenant_id,schedule.id,'RECONCILIATION_REQUIRED','PROVIDER_AMOUNT_MISMATCH');
  return true;
end$$;

create or replace function public.billing_record_manual_verified_payment(
  p_tenant_id uuid,p_appointment_id uuid,p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare sale public.billing_sales%rowtype;schedule public.billing_payment_schedule%rowtype;
  intent_id uuid:=gen_random_uuid();reference_value text;method_classification text:='unconfigured';boleta_model text;
begin
  select s.* into sale from public.billing_sales s join public.billing_sale_appointments a
    on a.tenant_id=s.tenant_id and a.sale_id=s.id where a.tenant_id=p_tenant_id
      and a.appointment_id=p_appointment_id for update of s;
  if not found then raise exception 'PAYMENT_SALE_NOT_INITIALIZED';end if;
  if sale.requested_document_type=33 and not exists(
    select 1 from public.customer_tax_profiles p where p.tenant_id=p_tenant_id
      and p.customer_id=sale.customer_id and length(trim(p.rut_normalized))>=8
      and length(trim(p.legal_name))>=2 and length(trim(p.business_activity))>=2
      and length(trim(p.tax_address))>=2 and length(trim(p.tax_commune))>=2
      and length(trim(p.tax_city))>=2
  ) then raise exception 'INVOICE_TAX_PROFILE_INCOMPLETE';end if;
  select * into schedule from public.billing_payment_schedule where tenant_id=p_tenant_id and sale_id=sale.id
    and status in ('PENDING','PARTIALLY_PAID') order by case installment_kind when 'initial' then 0 else 1 end for update limit 1;
  if not found then raise exception 'SALE_ALREADY_PAID';end if;
  if sale.requested_document_type=39 then
    select boleta_payment_document_model into boleta_model from public.dte_tenant_issuance_settings
      where tenant_id=p_tenant_id;
    if boleta_model='always_issue_boleta' then method_classification:='requires_boleta';
    elsif boleta_model='electronic_payment_voucher_as_boleta' then
      select classification into method_classification from public.tenant_payment_method_tax_policies
        where tenant_id=p_tenant_id and provider='manual' and active;
      if method_classification is null then raise exception 'PAYMENT_METHOD_TAX_CLASSIFICATION_REQUIRED';end if;
    else raise exception 'BOLETA_PAYMENT_DOCUMENT_MODEL_UNCONFIGURED';end if;
  end if;
  reference_value:='manual:'||intent_id::text;
  insert into public.payment_intents(id,tenant_id,appointment_id,billing_payment_schedule_id,provider,amount,currency,
    status,provider_payment_id,idempotency_key,audit_metadata,tax_document_method_classification,updated_at)
  values(intent_id,p_tenant_id,p_appointment_id,schedule.id,'manual',schedule.amount-schedule.paid_amount,'CLP','pending',
    reference_value,'manual-schedule:'||schedule.id::text,'{}',method_classification,now());
  insert into public.payments(tenant_id,appointment_id,external_reference,amount,status,provider,currency,payment_intent_id)
  values(p_tenant_id,p_appointment_id,reference_value,schedule.amount-schedule.paid_amount,'pending','manual','CLP',intent_id);
  perform public.finalize_verified_payment(intent_id,'manual',reference_value,'{}');
  update public.billing_sale_payments set verified_by=p_actor_id where tenant_id=p_tenant_id and payment_intent_id=intent_id;
  return intent_id;
end$$;

create or replace function public.billing_expire_provisional_schedule(
  p_tenant_id uuid,p_schedule_id uuid,p_at timestamptz default now()
) returns boolean language plpgsql security definer set search_path=public as $$
declare schedule public.billing_payment_schedule%rowtype;
begin
  select * into schedule from public.billing_payment_schedule where tenant_id=p_tenant_id and id=p_schedule_id for update;
  if not found or schedule.installment_kind<>'initial' or schedule.status<>'PENDING'
    or schedule.expires_at is null or schedule.expires_at>p_at then return false;end if;
  update public.billing_payment_schedule set status='EXPIRED',updated_at=now() where tenant_id=p_tenant_id and id=p_schedule_id;
  update public.payment_intents set status='expired',updated_at=now() where tenant_id=p_tenant_id
    and billing_payment_schedule_id=p_schedule_id and status in ('created','pending','processing');
  update public.appointments set status='expired',booking_status='expired',updated_at=now()
    where tenant_id=p_tenant_id and id in(select appointment_id from public.billing_sale_appointments
      where tenant_id=p_tenant_id and sale_id=schedule.sale_id) and status='pending_payment';
  insert into public.billing_payment_schedule_events(tenant_id,schedule_id,event_type,safe_reason)
  values(p_tenant_id,p_schedule_id,'EXPIRED','PROVISIONAL_HOLD_EXPIRED');
  return true;
end$$;

create or replace function public.billing_request_refund_review(
  p_tenant_id uuid,p_sale_payment_id uuid,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare documented boolean;
begin
  select exists(select 1 from public.billing_sale_item_document_coverage where tenant_id=p_tenant_id
    and sale_payment_id=p_sale_payment_id and status in ('ISSUED','ACCEPTED')) into documented;
  update public.billing_sale_payments set refund_tax_status=case when documented
    then 'REFUND_TAX_DOCUMENT_REQUIRED' else 'CLEARED_FOR_FINANCIAL_REVIEW' end,
    refund_reviewed_at=now(),refund_reviewed_by=p_actor_id
  where tenant_id=p_tenant_id and id=p_sale_payment_id;
  if not found then raise exception 'SALE_PAYMENT_NOT_FOUND';end if;
  return jsonb_build_object('automaticRefundAllowed',false,'taxDocumentRequired',documented,
    'type61Supported',false);
end$$;

alter table public.billing_payment_schedule_allocations enable row level security;
alter table public.billing_payment_schedule_events enable row level security;
alter table public.tenant_payment_method_tax_policies enable row level security;
revoke all on public.billing_payment_schedule_allocations,public.billing_payment_schedule_events from anon,authenticated;
revoke all on public.tenant_payment_method_tax_policies from anon,authenticated;
grant select on public.billing_payment_schedule_allocations,public.billing_payment_schedule_events to authenticated;
grant select on public.tenant_payment_method_tax_policies to authenticated;
create policy billing_schedule_allocations_tenant_read on public.billing_payment_schedule_allocations
for select to authenticated using(public.is_tenant_member(tenant_id,auth.uid()) or public.is_platform_admin(auth.uid()));
create policy billing_schedule_events_tenant_read on public.billing_payment_schedule_events
for select to authenticated using(public.is_tenant_member(tenant_id,auth.uid()) or public.is_platform_admin(auth.uid()));
create policy tenant_payment_method_tax_policies_member_read on public.tenant_payment_method_tax_policies
for select to authenticated using(public.is_tenant_member(tenant_id,auth.uid()) or public.is_platform_admin(auth.uid()));

revoke all on function public.billing_initialize_sale_from_appointments(uuid,uuid,uuid[],integer),
  public.billing_create_payment_review_document(uuid,uuid,uuid,uuid,text,text),
  public.billing_record_unapplied_provider_payment(uuid,text,text,numeric,jsonb),
  public.billing_expire_provisional_schedule(uuid,uuid,timestamptz),
  public.billing_request_refund_review(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.billing_initialize_sale_from_appointments(uuid,uuid,uuid[],integer),
  public.billing_create_payment_review_document(uuid,uuid,uuid,uuid,text,text),
  public.billing_record_unapplied_provider_payment(uuid,text,text,numeric,jsonb),
  public.billing_expire_provisional_schedule(uuid,uuid,timestamptz),
  public.billing_request_refund_review(uuid,uuid,uuid) to service_role;

comment on function public.billing_calculate_initial_due(bigint,text,text,bigint,bigint,bigint)
is 'Integer CLP policy: percentage uses half-up basis-point rounding, then optional minimum/maximum and total cap.';
comment on table public.billing_payment_schedule_allocations
is 'PII-free immutable monetary ranges assigning INITIAL/BALANCE schedules to frozen sale items.';
comment on column public.payment_intents.tax_document_method_classification
is 'Explicit per-intent tax classification. Defaults fail-closed; providers are never inferred automatically.';
