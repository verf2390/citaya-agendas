-- Sales are immutable commercial snapshots. Existing appointment payments are
-- represented as a one-item sale; the model also supports future multi-service
-- payment orders without changing the DTE document contract.
create table if not exists public.billing_sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  payment_intent_id uuid references public.payment_intents(id) on delete restrict,
  currency text not null default 'CLP' check (currency = 'CLP'),
  status text not null check (status in (
    'DRAFT','PAYMENT_PENDING','INVOICED','PAID','PARTIALLY_PAID','REFUNDED','CANCELED'
  )),
  net_amount bigint not null check (net_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  total_amount bigint not null check (total_amount = net_amount + tax_amount),
  paid_amount bigint not null default 0 check (paid_amount >= 0),
  payment_snapshot jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, payment_intent_id)
);

create table if not exists public.billing_sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  service_id uuid references public.services(id) on delete restrict,
  position integer not null check (position between 1 and 50),
  description text not null check (length(trim(description)) between 1 and 180),
  quantity integer not null check (quantity between 1 and 100000),
  unit_net_amount bigint not null check (unit_net_amount > 0),
  discount_basis_points integer not null default 0
    check (discount_basis_points between 0 and 10000),
  discount_amount bigint not null check (discount_amount >= 0),
  net_amount bigint not null check (net_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  total_amount bigint not null check (total_amount = net_amount + tax_amount),
  pricing_mode text not null default 'manual_net'
    check (pricing_mode in ('manual_net','catalog_gross')),
  catalog_unit_gross_amount bigint
    check (catalog_unit_gross_amount is null or catalog_unit_gross_amount > 0),
  service_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, sale_id)
    references public.billing_sales(tenant_id, id) on delete restrict,
  unique (tenant_id, sale_id, position),
  check (
    (pricing_mode='manual_net' and catalog_unit_gross_amount is null) or
    (pricing_mode='catalog_gross' and catalog_unit_gross_amount is not null
      and discount_basis_points=0)
  )
);

create table if not exists public.billing_sale_appointments (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid not null,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, sale_id)
    references public.billing_sales(tenant_id, id) on delete restrict,
  primary key (tenant_id, sale_id, appointment_id)
);

create table if not exists public.dte_invoice_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sale_id uuid,
  customer_id uuid not null references public.customers(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete restrict,
  payment_intent_id uuid references public.payment_intents(id) on delete restrict,
  source_intent_id uuid unique
    references public.dte_payment_document_intents(id) on delete restrict,
  dte_type integer not null default 33 check (dte_type = 33),
  source text not null check (source in (
    'manual','appointment','payment','automatic_payment'
  )),
  status text not null default 'DRAFT' check (status in (
    'DRAFT','REVIEW_REQUIRED','VALIDATED','QUEUED','PREPARING','SUBMITTING',
    'SUBMITTED','ACCEPTED','REJECTED','CANCELED'
  )),
  version integer not null default 1 check (version > 0),
  issuer_preview jsonb not null default '{}'::jsonb,
  recipient_preview jsonb not null default '{}'::jsonb,
  issuer_snapshot jsonb,
  recipient_snapshot jsonb,
  net_amount bigint not null check (net_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  total_amount bigint not null check (total_amount = net_amount + tax_amount),
  payment_amount_snapshot bigint,
  review_reason text,
  operational_reason text,
  idempotency_key text,
  intent_id uuid unique references public.dte_payment_document_intents(id) on delete restrict,
  locked_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, sale_id)
    references public.billing_sales(tenant_id, id) on delete restrict,
  check (
    (status in ('DRAFT','REVIEW_REQUIRED','VALIDATED') and locked_at is null) or
    (status not in ('DRAFT','REVIEW_REQUIRED','VALIDATED') and locked_at is not null)
  )
);

create table if not exists public.dte_invoice_draft_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  draft_id uuid not null,
  service_id uuid references public.services(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete restrict,
  position integer not null check (position between 1 and 50),
  description text not null check (length(trim(description)) between 1 and 180),
  quantity integer not null check (quantity between 1 and 100000),
  unit_net_amount bigint not null check (unit_net_amount > 0),
  discount_basis_points integer not null default 0
    check (discount_basis_points between 0 and 10000),
  discount_amount bigint not null check (discount_amount >= 0),
  net_amount bigint not null check (net_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  total_amount bigint not null check (total_amount = net_amount + tax_amount),
  pricing_mode text not null default 'manual_net'
    check (pricing_mode in ('manual_net','catalog_gross')),
  catalog_unit_gross_amount bigint
    check (catalog_unit_gross_amount is null or catalog_unit_gross_amount > 0),
  catalog_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, draft_id)
    references public.dte_invoice_drafts(tenant_id, id) on delete cascade,
  unique (tenant_id, draft_id, position),
  check (
    (pricing_mode='manual_net' and catalog_unit_gross_amount is null) or
    (pricing_mode='catalog_gross' and catalog_unit_gross_amount is not null
      and discount_basis_points=0)
  )
);

create index if not exists billing_sales_tenant_status_idx
  on public.billing_sales(tenant_id, status, created_at desc);
create index if not exists dte_invoice_drafts_tenant_status_idx
  on public.dte_invoice_drafts(tenant_id, status, updated_at desc);
create unique index if not exists dte_invoice_drafts_one_per_payment
  on public.dte_invoice_drafts(tenant_id, payment_intent_id)
  where payment_intent_id is not null;

drop index if exists public.dte_one_primary_per_verified_payment;
create unique index dte_one_active_intent_per_verified_payment
  on public.dte_payment_document_intents(tenant_id,payment_intent_id)
  where payment_intent_id is not null
    and origin in ('automatic_payment','manual_payment')
    and status in (
      'PENDING','PREPARING','READY','SUBMITTING','SUBMITTED','ACCEPTED',
      'ACCEPTED_WITH_OBJECTIONS','AMBIGUOUS','DELIVERY_PENDING','DELIVERED'
    );
create unique index dte_one_productive_document_per_verified_payment
  on public.dte_payment_document_intents(tenant_id,payment_intent_id)
  where payment_intent_id is not null and production_document_id is not null;
create unique index dte_one_active_intent_per_sale
  on public.dte_payment_document_intents(
    tenant_id,(immutable_snapshot->>'saleId')
  )
  where nullif(immutable_snapshot->>'saleId','') is not null
    and status in (
      'PENDING','PREPARING','READY','SUBMITTING','SUBMITTED','ACCEPTED',
      'ACCEPTED_WITH_OBJECTIONS','AMBIGUOUS','DELIVERY_PENDING','DELIVERED'
    );

create or replace function public.dte_billing_assert_tenant_ownership()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op='DELETE' then return old; end if;
  if tg_table_name in ('billing_sales','dte_invoice_drafts') then
    if not exists (
      select 1 from public.customers c
      where c.id=new.customer_id and c.tenant_id=new.tenant_id
    ) then raise exception 'DTE_CUSTOMER_TENANT_MISMATCH'; end if;
  end if;
  if tg_table_name='billing_sales' and new.payment_intent_id is not null and
     not exists (
       select 1 from public.payment_intents p
       where p.id=new.payment_intent_id and p.tenant_id=new.tenant_id
     ) then raise exception 'DTE_PAYMENT_TENANT_MISMATCH'; end if;
  if tg_table_name='dte_invoice_drafts' then
    if new.payment_intent_id is not null and not exists (
      select 1 from public.payment_intents p
      where p.id=new.payment_intent_id and p.tenant_id=new.tenant_id
    ) then raise exception 'DTE_PAYMENT_TENANT_MISMATCH'; end if;
    if new.appointment_id is not null and not exists (
      select 1 from public.appointments a
      where a.id=new.appointment_id and a.tenant_id=new.tenant_id
    ) then raise exception 'DTE_APPOINTMENT_TENANT_MISMATCH'; end if;
  end if;
  if tg_table_name in ('billing_sale_items','dte_invoice_draft_lines') then
    if new.service_id is not null and not exists (
      select 1 from public.services s
      where s.id=new.service_id and s.tenant_id=new.tenant_id
    ) then raise exception 'DTE_SERVICE_TENANT_MISMATCH'; end if;
  end if;
  if tg_table_name in ('billing_sale_appointments','dte_invoice_draft_lines') then
    if new.appointment_id is not null and not exists (
      select 1 from public.appointments a
      where a.id=new.appointment_id and a.tenant_id=new.tenant_id
    ) then raise exception 'DTE_APPOINTMENT_TENANT_MISMATCH'; end if;
  end if;
  return new;
end;
$$;

create trigger a_billing_sales_tenant_ownership
before insert or update on public.billing_sales
for each row execute function public.dte_billing_assert_tenant_ownership();
create trigger a_billing_sale_items_tenant_ownership
before insert or update on public.billing_sale_items
for each row execute function public.dte_billing_assert_tenant_ownership();
create trigger a_billing_sale_appointments_tenant_ownership
before insert or update on public.billing_sale_appointments
for each row execute function public.dte_billing_assert_tenant_ownership();
create trigger a_dte_invoice_drafts_tenant_ownership
before insert or update on public.dte_invoice_drafts
for each row execute function public.dte_billing_assert_tenant_ownership();
create trigger a_dte_invoice_draft_lines_tenant_ownership
before insert or update on public.dte_invoice_draft_lines
for each row execute function public.dte_billing_assert_tenant_ownership();

create or replace function public.billing_sale_snapshot_lock()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status in ('INVOICED','PAID','REFUNDED','CANCELED') and (
    old.tenant_id is distinct from new.tenant_id or
    old.customer_id is distinct from new.customer_id or
    old.payment_intent_id is distinct from new.payment_intent_id or
    old.currency is distinct from new.currency or
    old.net_amount is distinct from new.net_amount or
    old.tax_amount is distinct from new.tax_amount or
    old.total_amount is distinct from new.total_amount or
    old.paid_amount is distinct from new.paid_amount or
    old.payment_snapshot is distinct from new.payment_snapshot
  ) then
    raise exception 'BILLING_SALE_SNAPSHOT_IMMUTABLE';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists billing_sale_snapshot_lock on public.billing_sales;
create trigger billing_sale_snapshot_lock
before update on public.billing_sales
for each row execute function public.billing_sale_snapshot_lock();

create or replace function public.billing_sale_item_edit_guard()
returns trigger language plpgsql set search_path = public as $$
declare sale_status text;
begin
  select status into sale_status from public.billing_sales
   where tenant_id=coalesce(new.tenant_id,old.tenant_id)
     and id=coalesce(new.sale_id,old.sale_id)
   for update;
  if sale_status not in ('DRAFT','PAYMENT_PENDING') then
    raise exception 'BILLING_SALE_ITEMS_IMMUTABLE';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists billing_sale_items_edit_guard
  on public.billing_sale_items;
create trigger billing_sale_items_edit_guard
before insert or update or delete on public.billing_sale_items
for each row execute function public.billing_sale_item_edit_guard();

create or replace function public.dte_invoice_draft_line_edit_guard()
returns trigger language plpgsql set search_path = public as $$
declare draft_status text;
begin
  select status into draft_status
    from public.dte_invoice_drafts
   where id=coalesce(new.draft_id,old.draft_id)
     and tenant_id=coalesce(new.tenant_id,old.tenant_id)
   for update;
  if draft_status not in ('DRAFT','REVIEW_REQUIRED','VALIDATED') then
    raise exception 'DTE_INVOICE_DRAFT_LOCKED';
  end if;
  if tg_op <> 'DELETE' then
    new.updated_at := now();
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists dte_invoice_draft_lines_edit_guard
  on public.dte_invoice_draft_lines;
create trigger dte_invoice_draft_lines_edit_guard
before insert or update or delete on public.dte_invoice_draft_lines
for each row execute function public.dte_invoice_draft_line_edit_guard();

create or replace function public.dte_invoice_draft_lock_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status not in ('DRAFT','REVIEW_REQUIRED','VALIDATED') and (
    old.customer_id is distinct from new.customer_id or
    old.net_amount is distinct from new.net_amount or
    old.tax_amount is distinct from new.tax_amount or
    old.total_amount is distinct from new.total_amount or
    old.issuer_snapshot is distinct from new.issuer_snapshot or
    old.recipient_snapshot is distinct from new.recipient_snapshot
  ) then
    raise exception 'DTE_INVOICE_DRAFT_LOCKED';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dte_invoice_draft_lock_guard
  on public.dte_invoice_drafts;
create trigger dte_invoice_draft_lock_guard
before update on public.dte_invoice_drafts
for each row execute function public.dte_invoice_draft_lock_guard();

-- This is the last BEFORE INSERT snapshot step (trigger names are ordered).
-- Once an intent is PENDING, every fiscal field is read from the immutable
-- intent snapshot by the worker; mutable tenant/customer identities are no
-- longer consulted.
create or replace function public.dte_intent_freeze_final_tax_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  issuer_value jsonb;
  recipient_value jsonb;
  net_value bigint;
  tax_value bigint;
begin
  if new.status <> 'PENDING' or new.resolved_dte_type <> 33 then return new; end if;

  select jsonb_build_object(
    'rut',p.issuer_rut,'legalName',p.issuer_legal_name,
    'businessActivity',p.issuer_activity,
    'businessActivityCode',p.issuer_activity_code,
    'address',p.issuer_address,'commune',p.issuer_commune,'city',p.issuer_city,
    'resolutionDate',p.resolution_date,
    'resolutionNumber',p.resolution_number,'siiOffice',p.sii_office
  ) into issuer_value
  from public.dte_production_tenant_settings p
  where p.tenant_id=new.tenant_id;

  select jsonb_build_object(
    'rut',t.rut_normalized,'legalName',t.legal_name,
    'businessActivity',t.business_activity,'address',t.tax_address,
    'commune',t.tax_commune,'city',t.tax_city,'email',t.tax_email
  ) into recipient_value
  from public.customer_tax_profiles t
  where t.tenant_id=new.tenant_id and t.customer_id=new.customer_id;

  if issuer_value is null or recipient_value is null or
     coalesce(issuer_value->>'rut','')='' or
     coalesce(issuer_value->>'legalName','')='' or
     coalesce(issuer_value->>'businessActivity','')='' or
     coalesce(issuer_value->>'businessActivityCode','')='' or
     coalesce(issuer_value->>'address','')='' or
     coalesce(issuer_value->>'commune','')='' or
     coalesce(issuer_value->>'city','')='' or
     coalesce(issuer_value->>'resolutionDate','')='' or
     coalesce(issuer_value->>'resolutionNumber','')='' or
     coalesce(recipient_value->>'rut','')='' or
     coalesce(recipient_value->>'legalName','')='' or
     coalesce(recipient_value->>'businessActivity','')='' or
     coalesce(recipient_value->>'address','')='' or
     coalesce(recipient_value->>'commune','')='' or
     coalesce(recipient_value->>'city','')='' or
     coalesce(recipient_value->>'email','')='' then
    raise exception 'DTE_TAX_DATA_INCOMPLETE';
  end if;
  net_value := coalesce(
    (new.immutable_snapshot#>>'{money,netAmount}')::bigint,
    (new.immutable_snapshot#>>'{taxes,net}')::bigint,
    round(new.amount_snapshot/1.19)::bigint
  );
  tax_value := new.amount_snapshot-net_value;
  if not (new.immutable_snapshot ? 'money') then
    new.immutable_snapshot := jsonb_set(
      new.immutable_snapshot,'{money}',jsonb_build_object(
        'netAmount',net_value,'exemptAmount',0,
        'taxAmount',tax_value,'grossAmount',new.amount_snapshot
      ),true
    );
  end if;
  if jsonb_typeof(new.immutable_snapshot->'lines')='array' and
     jsonb_array_length(new.immutable_snapshot->'lines')=1 and
     not ((new.immutable_snapshot#>'{lines,0}') ? 'unitNetAmount') then
    new.immutable_snapshot := jsonb_set(
      new.immutable_snapshot,'{lines}',jsonb_build_array(jsonb_build_object(
        'description',coalesce(
          new.immutable_snapshot#>>'{lines,0,description}',
          new.appointment_snapshot->>'serviceName','Servicio'
        ),
        'quantity',1,'unitNetAmount',net_value,'discountBasisPoints',0,
        'netAmount',net_value,'taxAmount',tax_value,
        'totalAmount',new.amount_snapshot
      )),true
    );
  end if;
  if jsonb_typeof(new.immutable_snapshot->'lines') <> 'array' or
     jsonb_array_length(new.immutable_snapshot->'lines') < 1 or
     coalesce((new.immutable_snapshot#>>'{money,grossAmount}')::bigint,-1)
       <> new.amount_snapshot then
    raise exception 'DTE_TAX_SNAPSHOT_INVALID';
  end if;

  new.receiver_snapshot := recipient_value;
  new.immutable_snapshot :=
    jsonb_set(
      jsonb_set(
        jsonb_set(new.immutable_snapshot,'{issuer}',issuer_value,true),
        '{receiver}',recipient_value,true
      ),
      '{capturedAt}',to_jsonb(now()),true
    );
  return new;
end;
$$;

drop trigger if exists dte_intent_freeze_final_tax_snapshot
  on public.dte_payment_document_intents;
create trigger dte_intent_freeze_final_tax_snapshot
before insert on public.dte_payment_document_intents
for each row execute function public.dte_intent_freeze_final_tax_snapshot();

-- A verified payment already enters through finalize_verified_payment and
-- dte_enqueue_payment_snapshot. Mirror its immutable intent exactly once into
-- the editable/review model. Disabled automation remains review-only and no
-- worker can claim its BLOCKED outbox row.
create or replace function public.dte_mirror_intent_to_invoice_draft()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sale_id_value uuid;
  draft_id_value uuid;
  line_description text;
  line_net bigint;
  line_tax bigint;
  issuer_value jsonb;
begin
  if new.resolved_dte_type <> 33 or new.customer_id is null then return new; end if;
  if new.immutable_snapshot ? 'invoiceDraftId' then
    update public.dte_invoice_drafts
       set source_intent_id=new.id, intent_id=new.id,
           status=case when new.status='PENDING' then 'QUEUED' else 'REVIEW_REQUIRED' end,
           review_reason=new.safe_blocking_reason,
           issuer_snapshot=new.immutable_snapshot->'issuer',
           recipient_snapshot=new.immutable_snapshot->'receiver',
           locked_at=case when new.status='PENDING' then now() else null end,
           updated_at=now()
     where id=(new.immutable_snapshot->>'invoiceDraftId')::uuid
       and tenant_id=new.tenant_id;
    return new;
  end if;

  line_description := coalesce(
    new.immutable_snapshot#>>'{lines,0,description}',
    new.appointment_snapshot->>'serviceName',
    'Servicio'
  );
  line_net := coalesce(
    (new.immutable_snapshot#>>'{money,netAmount}')::bigint,
    (new.immutable_snapshot#>>'{taxes,net}')::bigint,
    round(new.amount_snapshot / 1.19)
  );
  line_tax := new.amount_snapshot-line_net;
  issuer_value := coalesce(new.immutable_snapshot->'issuer','{}'::jsonb);

  insert into public.billing_sales(
    tenant_id,customer_id,payment_intent_id,status,net_amount,tax_amount,
    total_amount,paid_amount,payment_snapshot,created_by
  ) values (
    new.tenant_id,new.customer_id,new.payment_intent_id,'DRAFT',line_net,line_tax,
    new.amount_snapshot,new.amount_snapshot,new.immutable_snapshot->'payment',
    new.created_by
  ) on conflict (tenant_id,payment_intent_id) do update
    set updated_at=public.billing_sales.updated_at
  returning id into sale_id_value;

  insert into public.billing_sale_items(
    tenant_id,sale_id,service_id,position,description,quantity,unit_net_amount,
    discount_amount,net_amount,tax_amount,total_amount,service_snapshot
  ) values (
    new.tenant_id,sale_id_value,
    nullif(new.appointment_snapshot->>'serviceId','')::uuid,1,line_description,1,
    line_net,0,line_net,line_tax,new.amount_snapshot,
    jsonb_build_object('capturedFrom','verified_payment')
  ) on conflict (tenant_id,sale_id,position) do nothing;
  update public.billing_sales
     set status='PAID',updated_at=now()
   where tenant_id=new.tenant_id and id=sale_id_value and status='DRAFT';

  insert into public.dte_invoice_drafts(
    tenant_id,sale_id,customer_id,appointment_id,payment_intent_id,
    source_intent_id,source,status,issuer_preview,recipient_preview,
    issuer_snapshot,recipient_snapshot,net_amount,tax_amount,total_amount,
    payment_amount_snapshot,review_reason,idempotency_key,intent_id,locked_at,
    created_by
  ) values (
    new.tenant_id,sale_id_value,new.customer_id,new.appointment_id,
    new.payment_intent_id,new.id,'automatic_payment','DRAFT',
    issuer_value,new.receiver_snapshot,null,null,
    line_net,line_tax,new.amount_snapshot,new.amount_snapshot,
    new.safe_blocking_reason,new.idempotency_key,new.id,null,new.created_by
  ) on conflict (tenant_id,payment_intent_id) where payment_intent_id is not null
    do nothing returning id into draft_id_value;

  if draft_id_value is not null then
    insert into public.dte_invoice_draft_lines(
      tenant_id,draft_id,service_id,appointment_id,position,description,
      quantity,unit_net_amount,discount_amount,net_amount,tax_amount,total_amount,
      catalog_snapshot
    ) values (
      new.tenant_id,draft_id_value,
      nullif(new.appointment_snapshot->>'serviceId','')::uuid,new.appointment_id,
      1,line_description,1,line_net,0,line_net,line_tax,new.amount_snapshot,
      jsonb_build_object('capturedFrom','verified_payment')
    );
    update public.dte_invoice_drafts
       set status=case when new.status='PENDING' then 'QUEUED' else 'REVIEW_REQUIRED' end,
           issuer_snapshot=case when new.status='PENDING' then issuer_value else null end,
           recipient_snapshot=case when new.status='PENDING' then new.receiver_snapshot else null end,
           locked_at=case when new.status='PENDING' then now() else null end,
           updated_at=now()
     where id=draft_id_value and tenant_id=new.tenant_id;
  end if;
  return new;
end;
$$;

drop trigger if exists dte_intent_mirror_invoice_draft
  on public.dte_payment_document_intents;
create trigger dte_intent_mirror_invoice_draft
after insert on public.dte_payment_document_intents
for each row execute function public.dte_mirror_intent_to_invoice_draft();

create or replace function public.finalize_dte_invoice_draft(
  p_tenant_id uuid,
  p_draft_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_actor_role text
) returns table(intent_id uuid,intent_status text,duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  draft_row public.dte_invoice_drafts%rowtype;
  old_intent public.dte_payment_document_intents%rowtype;
  payment_row public.payment_intents%rowtype;
  sale_id_value uuid;
  new_intent_id uuid;
  key_hash text;
  line_count integer;
  line_net bigint;
  line_tax bigint;
  line_total bigint;
  issuer_value jsonb;
  recipient_value jsonb;
  lines_value jsonb;
begin
  if p_actor_role not in ('tenant_admin','platform_admin') then
    raise exception 'DTE_ACTOR_ROLE_INVALID';
  end if;
  select * into draft_row
  from public.dte_invoice_drafts
  where tenant_id=p_tenant_id and id=p_draft_id
  for update;
  if not found then raise exception 'DTE_INVOICE_DRAFT_NOT_FOUND'; end if;
  if draft_row.status='QUEUED' and draft_row.intent_id is not null then
    return query select draft_row.intent_id,'PENDING'::text,true;
    return;
  end if;
  if draft_row.status not in ('DRAFT','REVIEW_REQUIRED','VALIDATED') or
     draft_row.version<>p_expected_version then
    raise exception 'DTE_INVOICE_DRAFT_VERSION_CONFLICT';
  end if;

  select count(*),coalesce(sum(net_amount),0),coalesce(sum(tax_amount),0),
         coalesce(sum(total_amount),0),
         jsonb_agg(jsonb_build_object(
           'serviceId',service_id,'appointmentId',appointment_id,
           'position',position,'description',description,'quantity',quantity,
           'unitNetAmount',unit_net_amount,
           'discountBasisPoints',discount_basis_points,
           'discountAmount',discount_amount,'netAmount',net_amount,
           'taxAmount',tax_amount,'totalAmount',total_amount,
           'pricingMode',pricing_mode,
           'catalogUnitGrossAmount',catalog_unit_gross_amount
         ) order by position)
    into line_count,line_net,line_tax,line_total,lines_value
  from public.dte_invoice_draft_lines
  where tenant_id=p_tenant_id and draft_id=p_draft_id;
  if line_count<1 or line_net<>draft_row.net_amount or
     line_tax<>draft_row.tax_amount or line_total<>draft_row.total_amount or
     draft_row.tax_amount<>round(draft_row.net_amount*0.19)::bigint then
    raise exception 'DTE_INVOICE_TOTALS_INVALID';
  end if;

  if draft_row.payment_intent_id is not null then
    select * into payment_row from public.payment_intents
    where tenant_id=p_tenant_id and id=draft_row.payment_intent_id
      and status='succeeded'
    for update;
    if not found or payment_row.currency<>'CLP' or
       round(payment_row.amount)::bigint<>draft_row.total_amount then
      raise exception 'DTE_PAYMENT_AMOUNT_MISMATCH';
    end if;
  elsif draft_row.payment_amount_snapshot is not null and
        draft_row.payment_amount_snapshot<>draft_row.total_amount then
    raise exception 'DTE_PAYMENT_AMOUNT_MISMATCH';
  end if;

  select jsonb_build_object(
    'rut',p.issuer_rut,'legalName',p.issuer_legal_name,
    'businessActivity',p.issuer_activity,
    'businessActivityCode',p.issuer_activity_code,
    'address',p.issuer_address,'commune',p.issuer_commune,'city',p.issuer_city,
    'resolutionDate',p.resolution_date,
    'resolutionNumber',p.resolution_number,'siiOffice',p.sii_office
  ) into issuer_value from public.dte_production_tenant_settings p
  where p.tenant_id=p_tenant_id;
  select jsonb_build_object(
    'rut',t.rut_normalized,'legalName',t.legal_name,
    'businessActivity',t.business_activity,'address',t.tax_address,
    'commune',t.tax_commune,'city',t.tax_city,'email',t.tax_email
  ) into recipient_value from public.customer_tax_profiles t
  where t.tenant_id=p_tenant_id and t.customer_id=draft_row.customer_id;
  if issuer_value is null or recipient_value is null then
    raise exception 'DTE_TAX_DATA_INCOMPLETE';
  end if;

  if draft_row.source_intent_id is not null then
    select * into old_intent from public.dte_payment_document_intents
    where tenant_id=p_tenant_id and id=draft_row.source_intent_id
    for update;
    if found and old_intent.status<>'CANCELED' then
      if old_intent.status<>'BLOCKED' or
         old_intent.safe_blocking_reason<>'AUTOMATION_DISABLED' then
        raise exception 'DTE_PREVIOUS_INTENT_NOT_REVIEWABLE';
      end if;
      update public.dte_issuance_outbox
         set status='CANCELED',last_safe_error='PROMOTED_AFTER_MANUAL_REVIEW',
             lease_expires_at=null,updated_at=now()
       where tenant_id=p_tenant_id and intent_id=old_intent.id
         and status='BLOCKED';
      update public.dte_payment_document_intents
         set status='CANCELED',
             safe_blocking_reason='PROMOTED_AFTER_MANUAL_REVIEW',
             updated_at=now()
       where tenant_id=p_tenant_id and id=old_intent.id and status='BLOCKED';
    end if;
  end if;

  sale_id_value:=draft_row.sale_id;
  if sale_id_value is null then
    insert into public.billing_sales(
      tenant_id,customer_id,payment_intent_id,status,currency,
      net_amount,tax_amount,total_amount,paid_amount,payment_snapshot,created_by
    ) values (
      p_tenant_id,draft_row.customer_id,draft_row.payment_intent_id,'DRAFT','CLP',
      draft_row.net_amount,draft_row.tax_amount,draft_row.total_amount,
      coalesce(draft_row.payment_amount_snapshot,0),
      case when draft_row.payment_intent_id is null then null else
        jsonb_build_object(
          'id',payment_row.id,'amount',payment_row.amount,
          'currency',payment_row.currency,'provider',payment_row.provider,
          'status',payment_row.status
        ) end,p_actor_id
    ) returning id into sale_id_value;
    insert into public.billing_sale_items(
      tenant_id,sale_id,service_id,position,description,quantity,
      unit_net_amount,discount_basis_points,discount_amount,net_amount,
      tax_amount,total_amount,pricing_mode,catalog_unit_gross_amount,
      service_snapshot
    )
    select tenant_id,sale_id_value,service_id,position,description,quantity,
      unit_net_amount,discount_basis_points,discount_amount,net_amount,
      tax_amount,total_amount,pricing_mode,catalog_unit_gross_amount,
      catalog_snapshot
    from public.dte_invoice_draft_lines
    where tenant_id=p_tenant_id and draft_id=p_draft_id order by position;
    update public.billing_sales
       set status=case
         when draft_row.payment_amount_snapshot=draft_row.total_amount
           then 'PAID' else 'INVOICED' end,
           updated_at=now()
     where tenant_id=p_tenant_id and id=sale_id_value and status='DRAFT';
    update public.dte_invoice_drafts set sale_id=sale_id_value
     where tenant_id=p_tenant_id and id=p_draft_id;
  end if;

  key_hash:=encode(digest(concat_ws(
    '|',p_tenant_id::text,'invoice-draft',p_draft_id::text,
    p_expected_version::text
  ),'sha256'),'hex');
  insert into public.dte_payment_document_intents(
    tenant_id,appointment_id,payment_intent_id,customer_id,payment_key,
    trigger_source,idempotency_key,requested_document,resolved_dte_type,
    amount_snapshot,currency,appointment_snapshot,receiver_snapshot,
    immutable_snapshot,origin,operational_reason,status,safe_blocking_reason,
    created_by,requested_by_role
  ) values (
    p_tenant_id,draft_row.appointment_id,draft_row.payment_intent_id,
    draft_row.customer_id,'invoice-draft:'||p_draft_id::text,'manual_admin',
    key_hash,'invoice',33,draft_row.total_amount,'CLP',
    case when draft_row.appointment_id is null then '{}'::jsonb
      else jsonb_build_object('id',draft_row.appointment_id) end,
    recipient_value,
    jsonb_build_object(
      'invoiceDraftId',p_draft_id,'tenantId',p_tenant_id,
      'saleId',sale_id_value,'issuer',issuer_value,'receiver',recipient_value,
      'lines',lines_value,'money',jsonb_build_object(
        'netAmount',draft_row.net_amount,'exemptAmount',0,
        'taxAmount',draft_row.tax_amount,'grossAmount',draft_row.total_amount
      ),
      'payment',case when draft_row.payment_intent_id is null then null else
        jsonb_build_object(
          'id',payment_row.id,'amount',payment_row.amount,
          'currency',payment_row.currency,'provider',payment_row.provider,
          'status',payment_row.status
        ) end,
      'appointment',case when draft_row.appointment_id is null then null else
        jsonb_build_object('id',draft_row.appointment_id) end,
      'customerId',draft_row.customer_id,'documentType',33,
      'origin',draft_row.source,'capturedAt',now()
    ),
    case when draft_row.payment_intent_id is not null then 'manual_payment'
      when draft_row.appointment_id is not null then 'manual_appointment'
      else 'manual_standalone' end,
    draft_row.operational_reason,'PENDING',null,p_actor_id,p_actor_role
  ) returning id into new_intent_id;

  insert into public.dte_document_events(
    tenant_id,intent_id,event_type,actor_id,safe_metadata
  ) values (
    p_tenant_id,new_intent_id,'INVOICE_DRAFT_FINALIZED',p_actor_id,
    jsonb_build_object(
      'draftId',p_draft_id,'saleId',sale_id_value,
      'replacedIntentId',draft_row.source_intent_id
    )
  );
  return query select new_intent_id,'PENDING'::text,false;
end;
$$;

revoke all on function public.finalize_dte_invoice_draft(
  uuid,uuid,integer,uuid,text
) from public,anon,authenticated;
grant execute on function public.finalize_dte_invoice_draft(
  uuid,uuid,integer,uuid,text
) to service_role;

-- The issuer snapshot is persisted on the production document before folio
-- reservation. Protected fiscal content cannot change once preparation starts.
alter table public.dte_production_documents
  add column if not exists issuer_snapshot jsonb,
  add column if not exists tax_snapshot_at timestamptz;

create or replace function public.dte_production_fiscal_content_lock()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.issuer_snapshot is not null or old.status <> 'draft') and (
    old.recipient is distinct from new.recipient or
    old.issuer_snapshot is distinct from new.issuer_snapshot or
    old.lines is distinct from new.lines or
    old.document_references is distinct from new.document_references or
    old.net_amount is distinct from new.net_amount or
    old.exempt_amount is distinct from new.exempt_amount or
    old.tax_amount is distinct from new.tax_amount or
    old.total_amount is distinct from new.total_amount or
    old.issue_date is distinct from new.issue_date
  ) then
    raise exception 'DTE_PRODUCTION_FISCAL_CONTENT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists dte_production_fiscal_content_lock
  on public.dte_production_documents;
create trigger dte_production_fiscal_content_lock
before update on public.dte_production_documents
for each row execute function public.dte_production_fiscal_content_lock();

alter table public.billing_sales enable row level security;
alter table public.billing_sale_items enable row level security;
alter table public.billing_sale_appointments enable row level security;
alter table public.dte_invoice_drafts enable row level security;
alter table public.dte_invoice_draft_lines enable row level security;

revoke all on public.billing_sales,public.billing_sale_items,
  public.billing_sale_appointments,public.dte_invoice_drafts,
  public.dte_invoice_draft_lines from anon,authenticated;
grant select on public.billing_sales,public.billing_sale_items,
  public.billing_sale_appointments,public.dte_invoice_drafts,
  public.dte_invoice_draft_lines to authenticated;

create policy billing_sales_tenant_read on public.billing_sales
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy billing_sale_items_tenant_read on public.billing_sale_items
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy billing_sale_appointments_tenant_read
  on public.billing_sale_appointments for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy dte_invoice_drafts_tenant_read on public.dte_invoice_drafts
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy dte_invoice_draft_lines_tenant_read
  on public.dte_invoice_draft_lines for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

comment on table public.dte_invoice_drafts is
  'Editable multi-item factura 33 drafts. Folios are never reserved at this stage.';
comment on table public.billing_sale_items is
  'Immutable service and price snapshots; catalog changes never rewrite paid sales.';
comment on column public.dte_invoice_drafts.issuer_snapshot is
  'Final issuer identity captured immediately before enqueue; immutable after lock.';
