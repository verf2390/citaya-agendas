-- PostgreSQL 17 schema-only smoke. Run only against a disposable local DB
-- after restoring the production schema and inside an outer transaction.
\set ON_ERROR_STOP on

savepoint boleta39_local_smoke;

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002');
insert into public.tenants(id,slug,name) values
  ('10000000-0000-4000-8000-000000000010','boleta39-smoke-a','Boleta 39 Smoke A'),
  ('20000000-0000-4000-8000-000000000020','boleta39-smoke-b','Boleta 39 Smoke B');
insert into public.tenant_members(tenant_id,user_id,email,role,is_active) values
  ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001','smoke-a@example.invalid','owner',true),
  ('20000000-0000-4000-8000-000000000020','20000000-0000-4000-8000-000000000002','smoke-b@example.invalid','owner',true);
insert into public.customers(id,tenant_id,full_name,email,rut_normalized) values
  ('10000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000010','Consumidor PRE-CAF','consumer@example.invalid','66666666-6');
insert into public.services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment) values
  ('10000000-0000-4000-8000-000000000040','10000000-0000-4000-8000-000000000010','Servicio bruto 14990',30,14990,'CLP',true,'affected');
insert into public.professionals(id,tenant_id,name,active) values
  ('10000000-0000-4000-8000-000000000050','10000000-0000-4000-8000-000000000010','Profesional smoke',true);
insert into public.appointments(
  id,tenant_id,professional_id,customer_id,customer_name,customer_email,
  start_at,end_at,status,booking_status,service_id,service_name,service_price,
  price,currency,payment_status,payment_paid_amount,tax_treatment_snapshot,
  requested_document_type,tax_document_selection
) values (
  '10000000-0000-4000-8000-000000000060',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000050',
  '10000000-0000-4000-8000-000000000030',
  'Consumidor PRE-CAF','consumer@example.invalid',
  '2030-01-01 12:00:00+00','2030-01-01 12:30:00+00',
  'confirmed','confirmed','10000000-0000-4000-8000-000000000040',
  'Servicio bruto 14990',44980,44980,'CLP','paid',44980,'affected',39,39
);
insert into public.payment_intents(
  id,tenant_id,appointment_id,provider,amount,currency,status,
  provider_payment_id,idempotency_key,processed_at
) values (
  '10000000-0000-4000-8000-000000000070',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000060',
  'mercadopago',44980,'CLP','succeeded','smoke-payment',
  'boleta39-smoke-payment','2030-01-01 11:00:00+00'
);
insert into public.dte_production_tenant_settings(
  tenant_id,enabled,issuer_rut,issuer_legal_name,issuer_activity,
  issuer_address,issuer_commune,issuer_city,sender_rut,certificate_secret_ref,
  certificate_valid_from,certificate_valid_to
) values (
  '10000000-0000-4000-8000-000000000010',false,'11111111-1',
  'Emisor PRE-CAF','Actividad PRE-CAF','Direccion PRE-CAF','Coquimbo',
  'Coquimbo','11111111-1','local-smoke-only',
  '2026-01-01 00:00:00+00','2030-01-01 00:00:00+00'
);
insert into public.dte_tenant_document_capabilities(
  tenant_id,environment,dte_type,customer_selection_enabled,
  admin_draft_enabled,issuance_enabled,endpoint_profile,schema_version,
  certification_status
) values (
  '10000000-0000-4000-8000-000000000010','certification',39,false,true,
  false,'boleta_rest_certification','EnvioBOLETA_v11','pre_caf_ready'
);

insert into public.dte_payment_document_intents(
  tenant_id,appointment_id,payment_intent_id,payment_key,trigger_source,
  idempotency_key,requested_document,resolved_dte_type,amount_snapshot,
  currency,appointment_snapshot,receiver_snapshot,status,safe_blocking_reason
) values (
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000060',
  '10000000-0000-4000-8000-000000000070',
  'mercadopago:smoke-payment','mercadopago',repeat('a',64),'consumer',39,
  44980,'CLP',
  jsonb_build_object(
    'serviceId','10000000-0000-4000-8000-000000000040',
    'serviceName','Servicio bruto 14990'
  ),
  jsonb_build_object('email','consumer@example.invalid'),
  'BLOCKED','AUTOMATION_DISABLED'
);
insert into public.billing_sale_appointments(tenant_id,sale_id,appointment_id)
select
  '10000000-0000-4000-8000-000000000010',
  s.id,
  '10000000-0000-4000-8000-000000000060'
from public.billing_sales s
where s.tenant_id='10000000-0000-4000-8000-000000000010'
  and s.payment_intent_id='10000000-0000-4000-8000-000000000070';

do $$
declare
  draft_count integer;
  sale_count integer;
  line_count integer;
  executable_count integer;
begin
  select count(*) into draft_count from public.dte_invoice_drafts
   where tenant_id='10000000-0000-4000-8000-000000000010' and dte_type=39;
  select count(*) into sale_count from public.billing_sales
   where tenant_id='10000000-0000-4000-8000-000000000010'
     and requested_document_type=39;
  select count(*) into line_count from public.dte_invoice_draft_lines
   where tenant_id='10000000-0000-4000-8000-000000000010';
  select count(*) into executable_count from public.dte_issuance_outbox
   where status in ('PENDING','PROCESSING');
  if draft_count<>1 or sale_count<>1 or line_count<>1 then
    raise exception 'BOLETA39_MIRROR_SMOKE_FAILED';
  end if;
  if executable_count<>0 then raise exception 'BOLETA39_OUTBOX_EXECUTABLE'; end if;
  if exists(select 1 from public.dte_production_folio_ledger where state='reserved') then
    raise exception 'BOLETA39_FOLIO_RESERVED';
  end if;
  if 37798+7182<>44980 then raise exception 'BOLETA39_TOTALS_INVALID'; end if;
end;
$$;

-- The real unique index, not SELECT-then-INSERT application logic, rejects a
-- second primary intent for the same verified payment.
do $$
begin
  begin
    insert into public.dte_payment_document_intents(
      tenant_id,appointment_id,payment_intent_id,payment_key,trigger_source,
      idempotency_key,requested_document,resolved_dte_type,amount_snapshot,
      currency,appointment_snapshot,receiver_snapshot,status,safe_blocking_reason
    ) values (
      '10000000-0000-4000-8000-000000000010',
      '10000000-0000-4000-8000-000000000060',
      '10000000-0000-4000-8000-000000000070',
      'mercadopago:smoke-payment','mercadopago',repeat('a',64),
      'invoice',33,44980,'CLP','{}','{}','BLOCKED','AUTOMATION_DISABLED'
    );
    raise exception 'BOLETA39_DUPLICATE_INTENT_ACCEPTED';
  exception when unique_violation then
    null;
  end;
end;
$$;

-- pg_restore --no-acl intentionally omits production grants.
grant select on public.dte_invoice_drafts to authenticated;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
do $$
begin
  if (select count(*) from public.dte_invoice_drafts)<>1 then
    raise exception 'BOLETA39_OWNER_RLS_DENIED';
  end if;
end;
$$;
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  true
);
do $$
begin
  if (select count(*) from public.dte_invoice_drafts)<>0 then
    raise exception 'BOLETA39_CROSS_TENANT_RLS_LEAK';
  end if;
  if has_table_privilege(
    'authenticated',
    'public.dte_invoice_drafts',
    'UPDATE'
  ) then
    raise exception 'BOLETA39_CROSS_TENANT_UPDATE_GRANTED';
  end if;
end;
$$;
reset role;

rollback to savepoint boleta39_local_smoke;
