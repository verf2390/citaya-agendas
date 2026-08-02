begin;

-- Local-only commercial, payment and privacy controls. This migration creates
-- no DTE intent/outbox row, reserves no folio and never enables issuance.
create extension if not exists btree_gist;

-- Compatible before the separate lifecycle migration adds the physical column.
create or replace function public.tenant_is_operational(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.tenants t where t.id=p_tenant_id
    and coalesce(to_jsonb(t)->>'lifecycle_status','active')='active');
$$;

alter table public.services
  add column if not exists public_description text,
  add column if not exists internal_description text,
  add column if not exists tax_description text,
  add column if not exists tax_description_review_status text not null default 'pending'
    check (tax_description_review_status in ('pending','approved','rejected')),
  add column if not exists contains_potentially_sensitive_information boolean not null default false,
  add column if not exists payment_policy text not null default 'no_advance'
    check (payment_policy in ('no_advance','deposit','full_payment')),
  add column if not exists deposit_type text
    check (deposit_type in ('fixed_amount','percentage')),
  add column if not exists deposit_value bigint,
  add column if not exists provisional_expiry_minutes integer not null default 30
    check (provisional_expiry_minutes between 5 and 10080),
  add column if not exists payment_configuration_complete boolean not null default false;

alter table public.services drop constraint if exists services_payment_policy_shape;
alter table public.services add constraint services_payment_policy_shape check (
  price is null or price = trunc(price)
) not valid;
alter table public.services add constraint services_payment_policy_deposit_shape check (
  (payment_policy <> 'deposit' and deposit_type is null and deposit_value is null) or
  (payment_policy = 'deposit' and deposit_type = 'fixed_amount' and deposit_value > 0
    and deposit_value <= price::bigint) or
  (payment_policy = 'deposit' and deposit_type = 'percentage' and deposit_value between 1 and 10000)
);

create or replace function public.service_commercial_publication_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.is_active and (
    new.payment_configuration_complete is not true or
    new.tax_description_review_status<>'approved' or
    length(trim(coalesce(new.tax_description,'')))<2
  ) then raise exception 'SERVICE_COMMERCIAL_OR_TAX_REVIEW_INCOMPLETE'; end if;
  return new;
end;
$$;
create trigger service_commercial_publication_guard
before insert or update on public.services for each row
execute function public.service_commercial_publication_guard();

alter table public.appointments
  add column if not exists payment_policy_snapshot text
    check (payment_policy_snapshot in ('no_advance','deposit','full_payment')),
  add column if not exists deposit_type_snapshot text
    check (deposit_type_snapshot in ('fixed_amount','percentage')),
  add column if not exists deposit_value_snapshot bigint,
  add column if not exists sale_total_amount bigint,
  add column if not exists initial_payment_due bigint,
  add column if not exists balance_due bigint,
  add column if not exists provisional_expires_at timestamptz,
  add column if not exists tax_treatment_status text not null default 'PENDING'
    check (tax_treatment_status in (
      'PENDING','READY','REVIEW_REQUIRED','TAX_DESCRIPTION_REVIEW_REQUIRED',
      'EXEMPT_DOCUMENT_TYPE_UNSUPPORTED'
    ));

alter table public.billing_sales
  add column if not exists initial_payment_due bigint not null default 0,
  add column if not exists balance_due bigint not null default 0,
  add column if not exists payment_state text not null default 'UNPAID'
    check (payment_state in ('UNPAID','PARTIALLY_PAID','PAID','REFUNDED')),
  add column if not exists tax_treatment_status text not null default 'PENDING'
    check (tax_treatment_status in (
      'PENDING','READY','REVIEW_REQUIRED','TAX_DESCRIPTION_REVIEW_REQUIRED',
      'EXEMPT_DOCUMENT_TYPE_UNSUPPORTED'
    )),
  add column if not exists document_status text not null default 'UNCOVERED'
    check (document_status in ('UNCOVERED','PARTIALLY_COVERED','COVERED','VOID')),
  add column if not exists closed_at timestamptz;

alter table public.billing_sales drop constraint if exists billing_sales_balance_consistent;
alter table public.billing_sales add constraint billing_sales_balance_consistent check (
  initial_payment_due between 0 and total_amount and
  paid_amount between 0 and total_amount and
  balance_due = total_amount - paid_amount and
  ((payment_state='UNPAID' and paid_amount=0) or
   (payment_state='PARTIALLY_PAID' and paid_amount>0 and balance_due>0) or
   (payment_state='PAID' and balance_due=0) or
   payment_state='REFUNDED') and
  (closed_at is null or (payment_state='PAID' and document_status='COVERED'))
);

alter table public.billing_sale_items
  add column if not exists appointment_id uuid references public.appointments(id) on delete restrict,
  add column if not exists public_description_snapshot text,
  add column if not exists tax_description_snapshot text,
  add column if not exists tax_description_review_status_snapshot text not null default 'pending'
    check (tax_description_review_status_snapshot in ('pending','approved','rejected')),
  add column if not exists contains_sensitive_information_snapshot boolean not null default false,
  add column if not exists payment_policy_snapshot text not null default 'no_advance'
    check (payment_policy_snapshot in ('no_advance','deposit','full_payment')),
  add column if not exists deposit_type_snapshot text
    check (deposit_type_snapshot in ('fixed_amount','percentage')),
  add column if not exists deposit_value_snapshot bigint,
  add column if not exists initial_payment_due bigint not null default 0,
  add column if not exists balance_due bigint not null default 0,
  add column if not exists tax_treatment_snapshot text
    check (tax_treatment_snapshot in ('affected','exempt'));

create unique index if not exists billing_sale_items_tenant_sale_id_uidx
  on public.billing_sale_items(tenant_id,sale_id,id);
create unique index if not exists billing_sale_appointments_one_sale_per_appointment
  on public.billing_sale_appointments(tenant_id,appointment_id);

alter table public.billing_sale_items drop constraint if exists billing_sale_items_policy_snapshot_shape;
alter table public.billing_sale_items add constraint billing_sale_items_policy_snapshot_shape check (
  initial_payment_due between 0 and total_amount and balance_due = total_amount and
  ((payment_policy_snapshot <> 'deposit' and deposit_type_snapshot is null and deposit_value_snapshot is null) or
   (payment_policy_snapshot='deposit' and deposit_type_snapshot='fixed_amount' and deposit_value_snapshot>0) or
   (payment_policy_snapshot='deposit' and deposit_type_snapshot='percentage' and deposit_value_snapshot between 1 and 10000))
);

create table public.billing_payment_schedule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  sale_item_id uuid,
  appointment_id uuid,
  installment_kind text not null check (installment_kind in ('initial','balance','manual_adjustment')),
  amount bigint not null check (amount > 0),
  currency text not null default 'CLP' check (currency='CLP'),
  due_at timestamptz,
  status text not null default 'PENDING' check (status in ('PENDING','PARTIALLY_PAID','PAID','CANCELED')),
  paid_amount bigint not null default 0 check (paid_amount >= 0 and paid_amount <= amount),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,sale_id) references public.billing_sales(tenant_id,id) on delete restrict,
  foreign key (tenant_id,sale_id,sale_item_id) references public.billing_sale_items(tenant_id,sale_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,sale_item_id,installment_kind)
);

create table public.billing_sale_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  appointment_id uuid,
  payment_intent_id uuid not null,
  external_payment_reference text not null check (length(external_payment_reference) between 1 and 256),
  provider text not null check (provider in ('mercadopago','webpay','khipu','manual')),
  amount bigint not null check (amount > 0),
  currency text not null default 'CLP' check (currency='CLP'),
  status text not null check (status in ('VERIFIED','REFUNDED','REVERSED')),
  validation_result text not null default 'verified' check (length(validation_result) between 1 and 64),
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$'),
  verified_by uuid,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id,sale_id) references public.billing_sales(tenant_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,payment_intent_id),
  unique (tenant_id,provider,external_payment_reference)
);

create table public.billing_sale_item_document_coverage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  sale_item_id uuid not null,
  dte_type integer not null check (dte_type in (33,39)),
  amount_from bigint not null check (amount_from >= 0),
  amount_to bigint not null check (amount_to > amount_from),
  amount_range int8range generated always as (int8range(amount_from,amount_to,'[)')) stored,
  status text not null default 'PLANNED' check (status in ('PLANNED','ISSUED','ACCEPTED','VOID')),
  draft_id uuid references public.dte_invoice_drafts(id) on delete restrict,
  production_document_id uuid references public.dte_production_documents(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,sale_id) references public.billing_sales(tenant_id,id) on delete restrict,
  foreign key (tenant_id,sale_id,sale_item_id) references public.billing_sale_items(tenant_id,sale_id,id) on delete restrict,
  unique (tenant_id,id),
  exclude using gist (tenant_id with =, sale_item_id with =, amount_range with &&)
    where (status <> 'VOID')
);

-- Retention is classified, but deletion/anonymisation remains deliberately
-- manual until Chilean legal/accounting review defines tenant-specific periods.
create table public.data_retention_policies (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  data_category text not null check (data_category in (
    'dte_tax_artifacts','payments_sales_contract','booking_operations',
    'marketing_evidence_suppression','technical_logs'
  )),
  legal_basis text not null check (length(trim(legal_basis)) between 3 and 500),
  minimum_days integer check (minimum_days is null or minimum_days >= 0),
  configured_days integer check (configured_days is null or configured_days >= minimum_days),
  disposition text not null default 'REVIEW_REQUIRED'
    check (disposition in ('RETAIN','ANONYMIZE','DELETE','REVIEW_REQUIRED')),
  automation_enabled boolean not null default false check (automation_enabled=false),
  review_status text not null default 'PENDING_LEGAL_ACCOUNTING_REVIEW'
    check (review_status in ('PENDING_LEGAL_ACCOUNTING_REVIEW','APPROVED')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,data_category),
  check (data_category <> 'dte_tax_artifacts' or minimum_days >= 2190)
);

insert into public.data_retention_policies(
  tenant_id,data_category,legal_basis,minimum_days,configured_days,disposition,review_status
)
select t.id,v.data_category,v.legal_basis,v.minimum_days,v.configured_days,v.disposition,v.review_status
from public.tenants t cross join (values
  ('dte_tax_artifacts','Conservación tributaria mínima de seis años',2190,2190,'RETAIN','APPROVED'),
  ('payments_sales_contract','Integridad contractual, contable y tributaria; plazo pendiente de revisión',null,null,'REVIEW_REQUIRED','PENDING_LEGAL_ACCOUNTING_REVIEW'),
  ('booking_operations','Finalidad operativa separada; definir anonimización posterior',null,null,'ANONYMIZE','PENDING_LEGAL_ACCOUNTING_REVIEW'),
  ('marketing_evidence_suppression','Conservar evidencia y supresión mínima para respetar revocaciones',null,null,'RETAIN','PENDING_LEGAL_ACCOUNTING_REVIEW'),
  ('technical_logs','Retención limitada sin secretos ni datos sensibles; plazo pendiente',null,null,'DELETE','PENDING_LEGAL_ACCOUNTING_REVIEW')
) as v(data_category,legal_basis,minimum_days,configured_days,disposition,review_status)
on conflict (tenant_id,data_category) do nothing;

create table public.restricted_data_access_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  actor_user_id uuid,
  resource_type text not null check (resource_type in ('legal_acceptance','dte_artifact','tax_profile')),
  resource_id uuid,
  action text not null check (action in ('LIST','READ','DOWNLOAD')),
  safe_context jsonb not null default '{}'::jsonb,
  accessed_at timestamptz not null default now()
);

create or replace function public.restricted_access_append_only()
returns trigger language plpgsql set search_path=public as $$
begin raise exception 'RESTRICTED_ACCESS_AUDIT_APPEND_ONLY'; end;
$$;
create trigger restricted_data_access_audit_append_only
before update or delete on public.restricted_data_access_audit
for each row execute function public.restricted_access_append_only();

create or replace function public.billing_private_reference_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_table_name='billing_payment_schedule' then
    if new.sale_item_id is not null and not exists (
      select 1 from public.billing_sale_items i where i.tenant_id=new.tenant_id
        and i.sale_id=new.sale_id and i.id=new.sale_item_id
    ) then raise exception 'BILLING_SCHEDULE_ITEM_TENANT_MISMATCH'; end if;
  elsif tg_table_name='billing_sale_payments' then
    if not exists (select 1 from public.payment_intents p where p.id=new.payment_intent_id
      and p.tenant_id=new.tenant_id and p.appointment_id is not distinct from new.appointment_id)
    then raise exception 'BILLING_PAYMENT_TENANT_MISMATCH'; end if;
  elsif tg_table_name='billing_sale_item_document_coverage' then
    if not exists (select 1 from public.billing_sale_items i where i.tenant_id=new.tenant_id
      and i.sale_id=new.sale_id and i.id=new.sale_item_id and new.amount_to<=i.total_amount)
    then raise exception 'BILLING_COVERAGE_ITEM_TENANT_OR_AMOUNT_MISMATCH'; end if;
    if new.dte_type in (33,39) and exists (select 1 from public.billing_sale_items i
      where i.tenant_id=new.tenant_id and i.id=new.sale_item_id and i.tax_treatment_snapshot='exempt')
    then raise exception 'EXEMPT_DOCUMENT_TYPE_UNSUPPORTED'; end if;
    if new.draft_id is not null and not exists (select 1 from public.dte_invoice_drafts d
      where d.id=new.draft_id and d.tenant_id=new.tenant_id and d.sale_id=new.sale_id and d.dte_type=new.dte_type)
    then raise exception 'BILLING_COVERAGE_DRAFT_MISMATCH'; end if;
    if new.production_document_id is not null and not exists (select 1 from public.dte_production_documents d
      where d.id=new.production_document_id and d.tenant_id=new.tenant_id and d.dte_type=new.dte_type)
    then raise exception 'BILLING_COVERAGE_DOCUMENT_MISMATCH'; end if;
  end if;
  return new;
end;
$$;

create trigger billing_payment_schedule_reference_guard before insert or update on public.billing_payment_schedule
for each row execute function public.billing_private_reference_guard();
create trigger billing_sale_payments_reference_guard before insert or update on public.billing_sale_payments
for each row execute function public.billing_private_reference_guard();
create trigger billing_document_coverage_reference_guard before insert or update on public.billing_sale_item_document_coverage
for each row execute function public.billing_private_reference_guard();

create or replace function public.billing_document_coverage_immutable()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'DOCUMENT_COVERAGE_APPEND_ONLY'; end if;
  if old.tenant_id is distinct from new.tenant_id or old.sale_id is distinct from new.sale_id or
     old.sale_item_id is distinct from new.sale_item_id or old.dte_type is distinct from new.dte_type or
     old.amount_from is distinct from new.amount_from or old.amount_to is distinct from new.amount_to or
     old.draft_id is distinct from new.draft_id or old.production_document_id is distinct from new.production_document_id or
     not (old.status='PLANNED' and new.status in ('PLANNED','ISSUED','VOID') or
          old.status='ISSUED' and new.status in ('ISSUED','ACCEPTED','VOID') or
          old.status=new.status) then raise exception 'DOCUMENT_COVERAGE_IMMUTABLE'; end if;
  new.updated_at:=now(); return new;
end;
$$;
create trigger billing_document_coverage_immutable before update or delete on public.billing_sale_item_document_coverage
for each row execute function public.billing_document_coverage_immutable();

create or replace function public.billing_close_sale(p_tenant_id uuid,p_sale_id uuid,p_actor_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare s public.billing_sales%rowtype; uncovered boolean;
begin
  select * into s from public.billing_sales where tenant_id=p_tenant_id and id=p_sale_id for update;
  if not found then raise exception 'SALE_NOT_FOUND'; end if;
  if s.payment_state<>'PAID' or s.balance_due<>0 then raise exception 'SALE_BALANCE_DUE'; end if;
  select exists (
    select 1 from public.billing_sale_items i where i.tenant_id=p_tenant_id and i.sale_id=p_sale_id
      and coalesce((select sum(upper(c.amount_range)-lower(c.amount_range)) from public.billing_sale_item_document_coverage c
        where c.tenant_id=i.tenant_id and c.sale_item_id=i.id and c.status='ACCEPTED'),0)<>i.total_amount
  ) into uncovered;
  if uncovered then raise exception 'SALE_DOCUMENT_COVERAGE_INCOMPLETE'; end if;
  update public.billing_sales set document_status='COVERED',closed_at=now(),updated_at=now()
    where tenant_id=p_tenant_id and id=p_sale_id;
  return true;
end;
$$;

create or replace function public.dte_type39_legal_gate_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_gate jsonb;
begin
  if new.environment='production' and new.dte_type=39 and new.issuance_enabled
     and (tg_op='INSERT' or old.issuance_enabled is distinct from new.issuance_enabled) then
    v_gate:=public.dte_type39_enablement_gate_report(new.tenant_id);
    if coalesce((v_gate->>'ready')::boolean,false) is not true or
       not public.tenant_is_operational(new.tenant_id) or exists(
         select 1 from public.services s where s.tenant_id=new.tenant_id and s.is_active
           and (s.payment_configuration_complete is not true or
             s.tax_description_review_status<>'approved' or length(trim(coalesce(s.tax_description,'')))<2)
       ) then raise exception 'DTE_TYPE39_LEGAL_TECHNICAL_OR_SERVICE_GATE_INCOMPLETE'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.billing_initialize_appointment_sale(
  p_tenant_id uuid,p_appointment_id uuid,p_requested_document_type integer
) returns uuid language plpgsql security definer set search_path=public as $$
declare a public.appointments%rowtype; s public.services%rowtype; v_sale_id uuid;
  total_value bigint; initial_value bigint; net_value bigint; tax_value bigint;
  tax_status text;
begin
  select b.sale_id into v_sale_id from public.billing_sale_appointments b
    where b.tenant_id=p_tenant_id and b.appointment_id=p_appointment_id;
  if v_sale_id is not null then return v_sale_id; end if;
  select * into a from public.appointments where tenant_id=p_tenant_id and id=p_appointment_id for update;
  if not found or a.customer_id is null then raise exception 'APPOINTMENT_CUSTOMER_REQUIRED'; end if;
  select * into s from public.services where tenant_id=p_tenant_id and id=a.service_id for share;
  if not found or s.payment_configuration_complete is not true then raise exception 'SERVICE_PAYMENT_POLICY_INCOMPLETE'; end if;
  if s.tax_description_review_status<>'approved' or length(trim(coalesce(s.tax_description,'')))<2
  then raise exception 'TAX_DESCRIPTION_REVIEW_REQUIRED'; end if;
  total_value:=s.price::bigint;
  initial_value:=case s.payment_policy
    when 'no_advance' then 0 when 'full_payment' then total_value
    when 'deposit' then case s.deposit_type when 'fixed_amount' then s.deposit_value
      else (total_value*s.deposit_value+5000)/10000 end end;
  if s.tax_treatment='affected' then
    net_value:=(total_value*100+59)/119; tax_value:=total_value-net_value;
  else net_value:=total_value; tax_value:=0; end if;
  tax_status:=case when s.tax_treatment='exempt' then 'EXEMPT_DOCUMENT_TYPE_UNSUPPORTED'
    when s.tax_treatment is null then 'REVIEW_REQUIRED'
    when s.payment_policy='deposit' then 'REVIEW_REQUIRED' else 'PENDING' end;
  insert into public.billing_sales(tenant_id,customer_id,currency,status,net_amount,tax_amount,total_amount,
    paid_amount,initial_payment_due,balance_due,payment_state,tax_treatment_status,document_status,
    requested_document_type,payment_snapshot)
  values(p_tenant_id,a.customer_id,'CLP','PAYMENT_PENDING',net_value,tax_value,total_value,0,
    initial_value,total_value,'UNPAID',tax_status,'UNCOVERED',p_requested_document_type,
    jsonb_build_object('policySource','service_snapshot','containsPII',false)) returning id into v_sale_id;
  insert into public.billing_sale_items(tenant_id,sale_id,service_id,appointment_id,position,description,
    quantity,unit_net_amount,discount_amount,net_amount,tax_amount,total_amount,pricing_mode,
    catalog_unit_gross_amount,service_snapshot,public_description_snapshot,tax_description_snapshot,
    tax_description_review_status_snapshot,contains_sensitive_information_snapshot,payment_policy_snapshot,
    deposit_type_snapshot,deposit_value_snapshot,initial_payment_due,balance_due,tax_treatment_snapshot)
  values(p_tenant_id,v_sale_id,s.id,a.id,1,s.tax_description,1,net_value,0,net_value,tax_value,total_value,
    'catalog_gross',total_value,jsonb_build_object('serviceId',s.id,'name',s.name,'containsPII',false),
    s.public_description,s.tax_description,s.tax_description_review_status,
    s.contains_potentially_sensitive_information,s.payment_policy,s.deposit_type,s.deposit_value,
    initial_value,total_value,s.tax_treatment);
  insert into public.billing_sale_appointments(tenant_id,sale_id,appointment_id)
    values(p_tenant_id,v_sale_id,a.id);
  if initial_value>0 then insert into public.billing_payment_schedule(
    tenant_id,sale_id,sale_item_id,appointment_id,installment_kind,amount,due_at)
    select p_tenant_id,v_sale_id,i.id,a.id,'initial',initial_value,
      case when s.payment_policy in ('deposit','full_payment') then now()+make_interval(mins=>s.provisional_expiry_minutes) end
      from public.billing_sale_items i where i.tenant_id=p_tenant_id and i.sale_id=v_sale_id;
  end if;
  if total_value-initial_value>0 then insert into public.billing_payment_schedule(
    tenant_id,sale_id,sale_item_id,appointment_id,installment_kind,amount)
    select p_tenant_id,v_sale_id,i.id,a.id,'balance',total_value-initial_value
      from public.billing_sale_items i where i.tenant_id=p_tenant_id and i.sale_id=v_sale_id;
  end if;
  update public.appointments set payment_policy_snapshot=s.payment_policy,deposit_type_snapshot=s.deposit_type,
    deposit_value_snapshot=s.deposit_value,sale_total_amount=total_value,initial_payment_due=initial_value,
    balance_due=total_value,provisional_expires_at=case when initial_value>0 then now()+make_interval(mins=>s.provisional_expiry_minutes) end,
    tax_treatment_status=tax_status,payment_required=(initial_value>0),payment_required_amount=initial_value,
    payment_remaining_amount=total_value,updated_at=now() where id=a.id and tenant_id=p_tenant_id;
  return v_sale_id;
end;
$$;

create or replace function public.payment_audit_metadata_minimal(p_provider text,p_value jsonb)
returns jsonb language sql immutable set search_path=public as $$
  select jsonb_strip_nulls(case p_provider
    when 'khipu' then jsonb_build_object('payment_id',left(p_value->>'payment_id',64),
      'transaction_id',left(p_value->>'transaction_id',128),'status',left(p_value->>'status',32),
      'status_detail',left(p_value->>'status_detail',64),'conciliation_date',p_value->>'conciliation_date')
    when 'mercadopago' then jsonb_build_object('payment_id',left(p_value->>'payment_id',64),
      'status',left(p_value->>'status',32),'date_approved',p_value->>'date_approved')
    when 'webpay' then jsonb_build_object('buy_order',left(p_value->>'buy_order',64),
      'session_id',left(p_value->>'session_id',128),'status',left(p_value->>'status',32),
      'response_code',p_value->'response_code','transaction_date',p_value->>'transaction_date')
    else '{}'::jsonb end);
$$;

create or replace function public.activate_payment_intent(
  p_intent_id uuid,p_provider_payment_id text,p_payment_url text,p_remaining_amount numeric
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_intent public.payment_intents%rowtype;
begin
  select * into v_intent from public.payment_intents where id=p_intent_id for update;
  if not found or length(coalesce(p_provider_payment_id,'')) not between 1 and 256 or
    length(coalesce(p_payment_url,'')) not between 1 and 2048 then raise exception 'invalid_payment_activation'; end if;
  if v_intent.status='pending' and v_intent.provider_payment_id=p_provider_payment_id then return false; end if;
  if v_intent.status<>'created' then raise exception 'payment_intent_not_creatable'; end if;
  update public.payment_intents set provider_payment_id=p_provider_payment_id,status='pending',updated_at=now()
    where id=v_intent.id;
  insert into public.payments(tenant_id,appointment_id,external_reference,amount,status,provider,currency,payment_intent_id)
    values(v_intent.tenant_id,v_intent.appointment_id,p_provider_payment_id,v_intent.amount,'pending',
      v_intent.provider,v_intent.currency,v_intent.id);
  update public.appointments set payment_required=true,payment_status='pending',payment_provider=v_intent.provider,
    payment_reference=p_provider_payment_id,payment_url=p_payment_url,status='pending_payment',
    booking_status='pending_payment',updated_at=now() where id=v_intent.appointment_id
    and tenant_id=v_intent.tenant_id and coalesce(status,'') not in ('canceled','cancelled');
  if not found then raise exception 'appointment_not_payable'; end if;
  return true;
end;
$$;

create or replace function public.finalize_verified_payment(
  p_intent_id uuid,p_provider text,p_provider_payment_id text,p_audit_metadata jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare pi public.payment_intents%rowtype; sale public.billing_sales%rowtype;
  safe_audit jsonb; next_paid bigint; next_state text; draft_id uuid; item record;
begin
  select * into pi from public.payment_intents where id=p_intent_id for update;
  if not found or pi.provider<>p_provider or pi.provider_payment_id<>p_provider_payment_id
  then raise exception 'payment_intent_mismatch'; end if;
  if pi.status='succeeded' then return false; end if;
  if pi.status not in ('pending','processing') then raise exception 'payment_intent_not_payable'; end if;
  select s.* into sale from public.billing_sales s join public.billing_sale_appointments a
    on a.tenant_id=s.tenant_id and a.sale_id=s.id where a.tenant_id=pi.tenant_id
    and a.appointment_id=pi.appointment_id for update of s;
  if not found then raise exception 'PAYMENT_SALE_NOT_INITIALIZED'; end if;
  if pi.amount<>trunc(pi.amount) or pi.amount::bigint>sale.balance_due then raise exception 'PAYMENT_AMOUNT_INVALID'; end if;
  safe_audit:=public.payment_audit_metadata_minimal(p_provider,coalesce(p_audit_metadata,'{}'::jsonb));
  update public.payment_intents set status='succeeded',audit_metadata=safe_audit,processed_at=now(),updated_at=now() where id=pi.id;
  update public.payments set status='paid',provider=p_provider,currency=pi.currency,amount=pi.amount,
    external_reference=p_provider_payment_id,audit_metadata=safe_audit,processed_at=now(),updated_at=now()
    where tenant_id=pi.tenant_id and payment_intent_id=pi.id;
  insert into public.billing_sale_payments(tenant_id,sale_id,appointment_id,payment_intent_id,
    external_payment_reference,provider,amount,currency,status,validation_result,evidence_sha256)
  values(pi.tenant_id,sale.id,pi.appointment_id,pi.id,p_provider_payment_id,p_provider,pi.amount::bigint,
    pi.currency,'VERIFIED','provider_verified',encode(digest(convert_to(safe_audit::text,'UTF8'),'sha256'),'hex'));
  next_paid:=sale.paid_amount+pi.amount::bigint;
  next_state:=case when next_paid=sale.total_amount then 'PAID' when next_paid>0 then 'PARTIALLY_PAID' else 'UNPAID' end;
  update public.billing_sales set paid_amount=next_paid,balance_due=total_amount-next_paid,payment_state=next_state,
    status=case when next_state='PAID' then 'PAID' else 'PARTIALLY_PAID' end,updated_at=now() where id=sale.id;
  update public.billing_payment_schedule set paid_amount=least(amount,paid_amount+pi.amount::bigint),
    status=case when paid_amount+pi.amount::bigint>=amount then 'PAID' else 'PARTIALLY_PAID' end,updated_at=now()
    where id=(select id from public.billing_payment_schedule where tenant_id=pi.tenant_id and sale_id=sale.id
      and status in ('PENDING','PARTIALLY_PAID') order by case installment_kind when 'initial' then 0 else 1 end,created_at limit 1);
  update public.appointments set payment_paid_amount=next_paid,payment_remaining_amount=sale.total_amount-next_paid,
    balance_due=sale.total_amount-next_paid,payment_status=case when next_state='PAID' then 'paid' else 'partially_paid' end,
    status=case when next_paid>=sale.initial_payment_due then 'confirmed' else status end,
    booking_status=case when next_paid>=sale.initial_payment_due then 'confirmed' else booking_status end,
    payment_provider=p_provider,payment_reference=p_provider_payment_id,updated_at=now()
    where id=pi.appointment_id and tenant_id=pi.tenant_id and coalesce(status,'') not in ('canceled','cancelled');

  -- A reviewed draft is a local intention only: no DTE intent, outbox, CAF or folio.
  if next_state='PAID' and sale.tax_treatment_status in ('PENDING','READY') and
     public.tenant_is_operational(sale.tenant_id) and sale.requested_document_type in (33,39) and not exists (
       select 1 from public.dte_invoice_drafts d where d.tenant_id=sale.tenant_id and d.sale_id=sale.id
     ) then
    insert into public.dte_invoice_drafts(tenant_id,sale_id,customer_id,appointment_id,payment_intent_id,
      dte_type,source,status,issuer_preview,recipient_preview,net_amount,tax_amount,total_amount,
      payment_amount_snapshot,review_reason,idempotency_key)
    values(sale.tenant_id,sale.id,sale.customer_id,pi.appointment_id,pi.id,sale.requested_document_type,
      'payment','REVIEW_REQUIRED','{}',case when sale.requested_document_type=39
        then jsonb_build_object('documentType',39,'consumerIdentityIncluded',false)
        else jsonb_build_object('documentType',33,'recipientFrozen',false) end,
      sale.net_amount,sale.tax_amount,sale.total_amount,next_paid,'MANUAL_DTE_REVIEW_REQUIRED',
      encode(digest(convert_to('sale:'||sale.id::text||':type:'||sale.requested_document_type::text,'UTF8'),'sha256'),'hex'))
      returning id into draft_id;
    for item in select * from public.billing_sale_items where tenant_id=sale.tenant_id and sale_id=sale.id order by position loop
      if item.tax_description_review_status_snapshot<>'approved' then raise exception 'TAX_DESCRIPTION_REVIEW_REQUIRED'; end if;
      if item.tax_treatment_snapshot='exempt' then raise exception 'EXEMPT_DOCUMENT_TYPE_UNSUPPORTED'; end if;
      insert into public.dte_invoice_draft_lines(tenant_id,draft_id,service_id,appointment_id,position,description,
        quantity,unit_net_amount,discount_basis_points,discount_amount,net_amount,tax_amount,total_amount,
        pricing_mode,catalog_unit_gross_amount,catalog_snapshot)
      values(item.tenant_id,draft_id,item.service_id,item.appointment_id,item.position,item.tax_description_snapshot,
        item.quantity,item.unit_net_amount,item.discount_basis_points,item.discount_amount,item.net_amount,item.tax_amount,
        item.total_amount,item.pricing_mode,item.catalog_unit_gross_amount,jsonb_build_object('saleItemId',item.id,'containsPII',false));
      insert into public.billing_sale_item_document_coverage(tenant_id,sale_id,sale_item_id,dte_type,
        amount_from,amount_to,status,draft_id) values(item.tenant_id,sale.id,item.id,sale.requested_document_type,
        0,item.total_amount,'PLANNED',draft_id);
    end loop;
    update public.billing_sales set tax_treatment_status='READY',document_status='PARTIALLY_COVERED',updated_at=now()
      where id=sale.id;
  elsif next_state='PAID' and sale.tax_treatment_status='PENDING' then
    update public.billing_sales set tax_treatment_status='REVIEW_REQUIRED',updated_at=now() where id=sale.id;
  end if;
  return true;
end;
$$;

create or replace function public.billing_record_manual_verified_payment(
  p_tenant_id uuid,p_appointment_id uuid,p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare s public.billing_sales%rowtype; intent_id uuid:=gen_random_uuid(); reference_value text;
begin
  select sale.* into s from public.billing_sales sale join public.billing_sale_appointments a
    on a.tenant_id=sale.tenant_id and a.sale_id=sale.id where a.tenant_id=p_tenant_id
      and a.appointment_id=p_appointment_id for update of sale;
  if not found then raise exception 'PAYMENT_SALE_NOT_INITIALIZED'; end if;
  if s.balance_due<=0 then raise exception 'SALE_ALREADY_PAID'; end if;
  reference_value:='manual:'||intent_id::text;
  insert into public.payment_intents(id,tenant_id,appointment_id,provider,amount,currency,status,
    provider_payment_id,idempotency_key,audit_metadata,updated_at)
  values(intent_id,p_tenant_id,p_appointment_id,'manual',s.balance_due,'CLP','pending',reference_value,
    'manual-sale:'||s.id::text,'{}',now());
  insert into public.payments(tenant_id,appointment_id,external_reference,amount,status,provider,currency,payment_intent_id)
  values(p_tenant_id,p_appointment_id,reference_value,s.balance_due,'pending','manual','CLP',intent_id);
  perform public.finalize_verified_payment(intent_id,'manual',reference_value,'{}');
  update public.billing_sale_payments set verified_by=p_actor_id where tenant_id=p_tenant_id and payment_intent_id=intent_id;
  return intent_id;
end;
$$;

-- Compatibility entry point: retained callers cannot bypass the sale ledger or
-- enqueue productive DTE work. The returned UUID is now a payment intent ID.
create or replace function public.mark_manual_payment_and_enqueue_dte(
  p_tenant_id uuid,p_appointment_id uuid,p_actor_id uuid,p_provider text default 'manual'
) returns uuid language plpgsql security definer set search_path=public as $$
begin
  if p_provider<>'manual' then raise exception 'MANUAL_PAYMENT_PROVIDER_INVALID'; end if;
  return public.billing_record_manual_verified_payment(p_tenant_id,p_appointment_id,p_actor_id);
end;
$$;

alter table public.billing_payment_schedule enable row level security;
alter table public.billing_sale_payments enable row level security;
alter table public.billing_sale_item_document_coverage enable row level security;
alter table public.data_retention_policies enable row level security;
alter table public.restricted_data_access_audit enable row level security;

revoke all on public.billing_payment_schedule,public.billing_sale_payments,
  public.billing_sale_item_document_coverage,public.data_retention_policies,
  public.restricted_data_access_audit from anon,authenticated;
grant select on public.billing_payment_schedule,public.billing_sale_payments,
  public.billing_sale_item_document_coverage,public.data_retention_policies to authenticated;

create policy billing_schedule_tenant_read on public.billing_payment_schedule for select to authenticated
  using (public.is_tenant_member(tenant_id,auth.uid()) or public.is_platform_admin(auth.uid()));
create policy billing_sale_payments_tenant_read on public.billing_sale_payments for select to authenticated
  using (public.is_tenant_member(tenant_id,auth.uid()) or public.is_platform_admin(auth.uid()));
create policy billing_coverage_tenant_read on public.billing_sale_item_document_coverage for select to authenticated
  using (public.is_tenant_member(tenant_id,auth.uid()) or public.is_platform_admin(auth.uid()));
create policy retention_policy_tenant_read on public.data_retention_policies for select to authenticated
  using (public.is_tenant_member(tenant_id,auth.uid()) or public.is_platform_admin(auth.uid()));

revoke all on function public.billing_close_sale(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.billing_close_sale(uuid,uuid,uuid) to service_role;
revoke all on function public.billing_initialize_appointment_sale(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.billing_initialize_appointment_sale(uuid,uuid,integer) to service_role;
revoke all on function public.payment_audit_metadata_minimal(text,jsonb) from public,anon,authenticated;
grant execute on function public.payment_audit_metadata_minimal(text,jsonb) to service_role;
revoke all on function public.billing_record_manual_verified_payment(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.billing_record_manual_verified_payment(uuid,uuid,uuid) to service_role;

comment on table public.billing_payment_schedule is 'No PII: installment amounts and relational keys only.';
comment on table public.billing_sale_payments is 'No card/bank credentials or full provider payloads; verified payment references only.';
comment on table public.billing_sale_item_document_coverage is 'Non-overlapping monetary DTE coverage per immutable sale item.';
comment on column public.services.internal_description is 'Operational only. It must never be copied to DTE XML/PDF.';
comment on column public.services.tax_description is 'Minimal DTE description; emission requires explicit administrative approval.';
comment on table public.data_retention_policies is 'Classification and extension point only; automatic deletion is prohibited by constraint.';

commit;
