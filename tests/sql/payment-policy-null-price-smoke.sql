\set ON_ERROR_STOP on
\ir payment-policy-privacy-bootstrap.sql

-- Historical/demo fixture present before the migrations. It intentionally has
-- no price and receives no inferred policy or configuration backfill.
insert into public.tenants(id,slug,name) values
  ('61000000-0000-4000-8000-000000000001','null-price-history','Tenant ficticio histórico');
insert into public.services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment)
values(
  '61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000001',
  'Servicio ficticio sin configurar',30,null,'CLP',true,'affected'
);

\ir ../../migrations/202608020001_tenant_legal_privacy_gate.sql
\ir ../../migrations/202608020002_service_payment_policy_sales_coverage.sql
\ir ../../migrations/202608020003_tenant_lifecycle_offboarding.sql
\ir ../../migrations/202608020004_payment_policy_accounting.sql
\ir ../../migrations/202608020005_tenant_operational_mode.sql

do $$begin
  if not exists(
    select 1 from public.services
    where id='61000000-0000-4000-8000-000000000002'
      and price is null
      and payment_configuration_complete is false
  ) then raise exception 'NULL_PRICE_INCOMPLETE_SERVICE_NOT_PRESERVED';end if;
end$$;

-- Make only the fictitious tenant operational so this assertion reaches the
-- payment-policy gate instead of being stopped earlier by tenant mode.
update public.tenants set operational_mode='live'
where id='61000000-0000-4000-8000-000000000001';
insert into public.customers(id,tenant_id,full_name,email) values(
  '61000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000001',
  'Persona ficticia','null-price@example.invalid'
);
insert into public.appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values(
  '61000000-0000-4000-8000-000000000004',
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000002','pending','pending',33
);

do $$begin
  begin
    perform public.billing_initialize_sale_from_appointments(
      '61000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000003',
      array['61000000-0000-4000-8000-000000000004'::uuid],33
    );
    raise exception 'INCOMPLETE_NULL_PRICE_SERVICE_CREATED_SALE';
  exception when others then
    if sqlerrm='INCOMPLETE_NULL_PRICE_SERVICE_CREATED_SALE'
       or sqlerrm not like '%SERVICE_PAYMENT_OR_TAX_CONFIGURATION_INCOMPLETE%'
    then raise;end if;
  end;
  if exists(select 1 from public.billing_sales where tenant_id='61000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.billing_payment_schedule where tenant_id='61000000-0000-4000-8000-000000000001')
  then raise exception 'INCOMPLETE_NULL_PRICE_SERVICE_PERSISTED_ACCOUNTING';end if;

  begin
    insert into public.payment_intents(
      id,tenant_id,appointment_id,provider,amount,currency,status,idempotency_key
    ) values(
      '61000000-0000-4000-8000-000000000005',
      '61000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000004','fictional',1000,'CLP','created','null-price-blocked'
    );
    raise exception 'INCOMPLETE_NULL_PRICE_SERVICE_CREATED_PAYMENT_INTENT';
  exception when others then
    if sqlerrm='INCOMPLETE_NULL_PRICE_SERVICE_CREATED_PAYMENT_INTENT'
       or sqlerrm not like '%PAYMENT_SCHEDULE_REQUIRED%'
    then raise;end if;
  end;
end$$;

-- Completion with a missing price must fail at the database constraint even
-- when the row is inactive and therefore outside the publication trigger.
update public.services set is_active=false
where id='61000000-0000-4000-8000-000000000002';
do $$begin
  begin
    update public.services
    set payment_configuration_complete=true,
        tax_description='Servicio profesional',
        tax_description_review_status='approved'
    where id='61000000-0000-4000-8000-000000000002';
    raise exception 'COMPLETE_NULL_PRICE_SERVICE_ACCEPTED';
  exception when check_violation then null;end;
end$$;

-- A complete CLP service remains valid, while invalid deposit shapes remain
-- rejected by the same PostgreSQL constraint.
insert into public.services(
  id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,
  tax_description,tax_description_review_status,payment_policy,payment_configuration_complete
) values(
  '61000000-0000-4000-8000-000000000006',
  '61000000-0000-4000-8000-000000000001',
  'Servicio ficticio configurado',30,15000,'CLP',false,'affected',
  'Servicio profesional','approved','no_advance',true
);

do $$begin
  begin
    insert into public.services(
      id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,
      tax_description,tax_description_review_status,payment_policy,deposit_type,deposit_value,
      payment_configuration_complete
    ) values(
      '61000000-0000-4000-8000-000000000007',
      '61000000-0000-4000-8000-000000000001',
      'Anticipo ficticio inválido',30,10000,'CLP',false,'affected',
      'Servicio profesional','approved','deposit','percentage',10000,true
    );
    raise exception 'INVALID_DEPOSIT_CONFIGURATION_ACCEPTED';
  exception when check_violation then null;end;
end$$;

do $$begin
  if exists(select 1 from public.payment_intents where tenant_id='61000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.billing_sales where tenant_id='61000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.billing_sale_item_document_coverage where tenant_id='61000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.dte_payment_document_intents where tenant_id='61000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.dte_issuance_outbox where tenant_id='61000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.dte_production_folio_ledger where tenant_id='61000000-0000-4000-8000-000000000001')
  then raise exception 'NULL_PRICE_SMOKE_CREATED_OPERATIONAL_DATA';end if;
end$$;

rollback;
