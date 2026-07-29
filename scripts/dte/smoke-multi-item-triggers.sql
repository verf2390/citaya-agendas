\set ON_ERROR_STOP on

do $$
begin
  if current_database() <> 'citaya_dte_multi_item_trigger_smoke_20260729' then
    raise exception 'LOCAL_SMOKE_DATABASE_REQUIRED';
  end if;
end;
$$;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

\ir ../../migrations/202607290004_dte_invoice_drafts_multi_item.sql

do $$
declare
  new_table_count integer;
begin
  select count(*) into new_table_count
  from pg_class
  where oid in (
    to_regclass('public.billing_sales'),
    to_regclass('public.billing_sale_items'),
    to_regclass('public.billing_sale_appointments'),
    to_regclass('public.dte_invoice_drafts'),
    to_regclass('public.dte_invoice_draft_lines')
  );
  if new_table_count <> 5 then
    raise exception 'LOCAL_SMOKE_NEW_TABLES_MISSING';
  end if;
end;
$$;

insert into public.tenants(id,slug,name)
values (
  '00000000-0000-4000-8000-000000000101',
  'dte-multi-item-local-smoke',
  'DTE multi-item local smoke'
);

insert into public.customers(id,tenant_id,full_name,email)
values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000101',
  'Cliente smoke',
  'local-smoke@example.test'
);

insert into public.services(id,tenant_id,name,price,tax_treatment)
values
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000101',
    'Servicio bruto A',
    14990,
    'affected'
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000101',
    'Servicio bruto B',
    29990,
    'affected'
  );

insert into public.appointments(
  id,tenant_id,customer_id,service_id,customer_name,start_at,end_at,status,
  service_name,service_price,payment_status,booking_status
) values (
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  'Cliente smoke',
  '2099-01-01 10:00:00+00',
  '2099-01-01 11:00:00+00',
  'confirmed',
  'Servicio bruto A',
  14990,
  'paid',
  'confirmed'
);

insert into public.payment_intents(
  id,tenant_id,appointment_id,provider,amount,currency,status,idempotency_key
) values (
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000401',
  'manual',
  44980,
  'CLP',
  'succeeded',
  'dte-multi-item-local-smoke-payment'
);

insert into public.billing_sales(
  id,tenant_id,customer_id,payment_intent_id,status,net_amount,tax_amount,
  total_amount,paid_amount,payment_snapshot
) values (
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000501',
  'DRAFT',
  37798,
  7182,
  44980,
  44980,
  '{"source":"local-smoke"}'
);

insert into public.billing_sale_items(
  id,tenant_id,sale_id,service_id,position,description,quantity,
  unit_net_amount,discount_amount,net_amount,tax_amount,total_amount,
  pricing_mode,catalog_unit_gross_amount,service_snapshot
) values
  (
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000601',
    '00000000-0000-4000-8000-000000000301',
    1,
    'Servicio bruto A',
    1,
    12597,
    0,
    12597,
    2393,
    14990,
    'catalog_gross',
    14990,
    '{"source":"local-smoke"}'
  ),
  (
    '00000000-0000-4000-8000-000000000802',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000601',
    '00000000-0000-4000-8000-000000000302',
    2,
    'Servicio bruto B',
    1,
    25201,
    0,
    25201,
    4789,
    29990,
    'catalog_gross',
    29990,
    '{"source":"local-smoke"}'
  );

insert into public.billing_sale_appointments(tenant_id,sale_id,appointment_id)
values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000401'
);

insert into public.dte_invoice_drafts(
  id,tenant_id,sale_id,customer_id,appointment_id,payment_intent_id,source,
  status,net_amount,tax_amount,total_amount,payment_amount_snapshot
) values (
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000501',
  'payment',
  'DRAFT',
  37798,
  7182,
  44980,
  44980
);

insert into public.dte_invoice_draft_lines(
  id,tenant_id,draft_id,service_id,appointment_id,position,description,
  quantity,unit_net_amount,discount_amount,net_amount,tax_amount,total_amount,
  pricing_mode,catalog_unit_gross_amount,catalog_snapshot
) values
  (
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000401',
    1,
    'Servicio bruto A',
    1,
    12597,
    0,
    12597,
    2393,
    14990,
    'catalog_gross',
    14990,
    '{"source":"local-smoke"}'
  ),
  (
    '00000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000401',
    2,
    'Servicio bruto B',
    1,
    25201,
    0,
    25201,
    4789,
    29990,
    'catalog_gross',
    29990,
    '{"source":"local-smoke"}'
  );

-- Exercise INSERT and UPDATE on all five table-specific ownership branches.
update public.billing_sales
set payment_snapshot=payment_snapshot
where id='00000000-0000-4000-8000-000000000601';
update public.billing_sale_items
set description=description
where id='00000000-0000-4000-8000-000000000801';
update public.billing_sale_appointments
set created_at=created_at
where sale_id='00000000-0000-4000-8000-000000000601';
update public.dte_invoice_drafts
set review_reason='local trigger smoke'
where id='00000000-0000-4000-8000-000000000701';
update public.dte_invoice_draft_lines
set description=description
where id='00000000-0000-4000-8000-000000000901';

-- Exercise DELETE branches in the two edit guards that inspect TG_OP.
insert into public.billing_sale_items(
  tenant_id,sale_id,position,description,quantity,unit_net_amount,
  discount_amount,net_amount,tax_amount,total_amount
) values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000601',
  3,
  'Línea transitoria',
  1,
  1,
  0,
  1,
  0,
  1
);
delete from public.billing_sale_items
where tenant_id='00000000-0000-4000-8000-000000000101'
  and sale_id='00000000-0000-4000-8000-000000000601'
  and position=3;

insert into public.dte_invoice_draft_lines(
  tenant_id,draft_id,position,description,quantity,unit_net_amount,
  discount_amount,net_amount,tax_amount,total_amount
) values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000701',
  3,
  'Línea transitoria',
  1,
  1,
  0,
  1,
  0,
  1
);
delete from public.dte_invoice_draft_lines
where tenant_id='00000000-0000-4000-8000-000000000101'
  and draft_id='00000000-0000-4000-8000-000000000701'
  and position=3;

do $$
declare
  net_value bigint;
  tax_value bigint;
  total_value bigint;
begin
  select sum(net_amount),sum(tax_amount),sum(total_amount)
  into net_value,tax_value,total_value
  from public.billing_sale_items
  where tenant_id='00000000-0000-4000-8000-000000000101'
    and sale_id='00000000-0000-4000-8000-000000000601';
  if net_value<>37798 or tax_value<>7182 or total_value<>44980 or
     net_value+tax_value<>total_value or
     tax_value<>round(net_value*0.19)::bigint then
    raise exception 'LOCAL_SMOKE_GROSS_RECONCILIATION_FAILED';
  end if;
end;
$$;

insert into public.dte_payment_document_intents(
  tenant_id,appointment_id,payment_intent_id,payment_key,trigger_source,
  idempotency_key,requested_document,resolved_dte_type,amount_snapshot,
  currency,appointment_snapshot,status,immutable_snapshot,origin
) values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000501',
  'local-smoke-active-primary',
  'manual_admin',
  repeat('a',64),
  'invoice',
  null,
  44980,
  'CLP',
  '{}',
  'READY',
  '{"saleId":"00000000-0000-4000-8000-000000000601"}',
  'manual_payment'
);

do $$
declare
  violated_constraint text;
begin
  begin
    insert into public.dte_payment_document_intents(
      tenant_id,appointment_id,payment_intent_id,payment_key,trigger_source,
      idempotency_key,requested_document,resolved_dte_type,amount_snapshot,
      currency,appointment_snapshot,status,immutable_snapshot,origin
    ) values (
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000401',
      '00000000-0000-4000-8000-000000000501',
      'local-smoke-duplicate-payment',
      'manual_admin',
      repeat('b',64),
      'invoice',
      null,
      44980,
      'CLP',
      '{}',
      'READY',
      '{"saleId":"00000000-0000-4000-8000-000000000999"}',
      'manual_payment'
    );
    raise exception 'LOCAL_SMOKE_PAYMENT_UNIQUENESS_NOT_ENFORCED';
  exception
    when unique_violation then
      get stacked diagnostics violated_constraint=constraint_name;
      if violated_constraint<>'dte_one_active_intent_per_verified_payment' then
        raise exception 'LOCAL_SMOKE_WRONG_PAYMENT_CONSTRAINT: %',
          violated_constraint;
      end if;
  end;

  begin
    insert into public.dte_payment_document_intents(
      tenant_id,appointment_id,payment_intent_id,payment_key,trigger_source,
      idempotency_key,requested_document,resolved_dte_type,amount_snapshot,
      currency,appointment_snapshot,status,immutable_snapshot,origin
    ) values (
      '00000000-0000-4000-8000-000000000101',
      null,
      null,
      'local-smoke-duplicate-sale',
      'manual_admin',
      repeat('c',64),
      'invoice',
      null,
      44980,
      'CLP',
      '{}',
      'READY',
      '{"saleId":"00000000-0000-4000-8000-000000000601"}',
      'manual_payment'
    );
    raise exception 'LOCAL_SMOKE_SALE_UNIQUENESS_NOT_ENFORCED';
  exception
    when unique_violation then
      get stacked diagnostics violated_constraint=constraint_name;
      if violated_constraint<>'dte_one_active_intent_per_sale' then
        raise exception 'LOCAL_SMOKE_WRONG_SALE_CONSTRAINT: %',
          violated_constraint;
      end if;
  end;
end;
$$;

rollback;

do $$
begin
  if to_regclass('public.billing_sales') is not null or
     to_regclass('public.billing_sale_items') is not null or
     to_regclass('public.billing_sale_appointments') is not null or
     to_regclass('public.dte_invoice_drafts') is not null or
     to_regclass('public.dte_invoice_draft_lines') is not null then
    raise exception 'LOCAL_SMOKE_ROLLBACK_FAILED';
  end if;
end;
$$;
