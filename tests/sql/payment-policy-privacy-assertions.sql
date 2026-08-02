-- Fictional identifiers only. The outer test database and these fixtures are rolled back.
begin;

insert into tenants(id,slug,name) values
('10000000-0000-4000-8000-000000000001','tenant-a','Tenant A'),
('20000000-0000-4000-8000-000000000002','tenant-b','Tenant B');
insert into tenant_members(tenant_id,user_id,role,is_active) values
('10000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','owner',true),
('20000000-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002','owner',true);
insert into platform_admins(user_id,role,is_active)
values('cccccccc-0000-4000-8000-000000000003','super_admin',true);
insert into customers(id,tenant_id,full_name,email) values
('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Persona ficticia A','a@example.invalid'),
('22000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Persona ficticia B','b@example.invalid');
insert into dte_tenant_issuance_settings(
  tenant_id,production_enabled,issuance_mode,updated_at,
  deposit_tax_document_policy_status,boleta_payment_document_model
) values
('10000000-0000-4000-8000-000000000001',false,'manual',now(),'unconfigured','unconfigured'),
('20000000-0000-4000-8000-000000000002',false,'manual',now(),'unconfigured','unconfigured');

-- Calendar retention is six calendar years, including a leap-day boundary.
do $$declare retained_until timestamptz;begin
  retained_until:=public.dte_calendar_retention_not_before('2024-02-29 12:00:00+00');
  if retained_until<>'2030-02-28 12:00:00+00'::timestamptz then
    raise exception 'calendar retention did not preserve PostgreSQL six-year semantics: %',retained_until;
  end if;
end$$;

insert into dte_production_documents(id,tenant_id,dte_type,issue_date,created_at)
values('31000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',39,'2016-02-29','2016-02-29 12:00:00+00');
insert into dte_production_artifacts(tenant_id,document_id,kind,storage_key,sha256,byte_length,content_type) values
('10000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','dte_xml','private/fictional.xml',repeat('a',64),1,'application/xml'),
('10000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','envio_xml','private/fictional-envelope.xml',repeat('d',64),1,'application/xml'),
('10000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','pdf','private/fictional.pdf',repeat('b',64),1,'application/pdf'),
('10000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','sii_response','private/fictional-response.xml',repeat('c',64),1,'application/xml');
insert into dte_production_submission_attempts(tenant_id,document_id)
values('10000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001');
insert into dte_production_audit(tenant_id,document_id,action)
values('10000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','FICTIONAL_TEST');
update dte_retention_controls set
  legal_hold=true,legal_hold_reason='Retención judicial ficticia para prueba local',
  legal_hold_set_at=now(),legal_hold_set_by='cccccccc-0000-4000-8000-000000000003',
  deletion_approved_at=now(),deletion_approved_by='cccccccc-0000-4000-8000-000000000003',
  deletion_approval_reason='Aprobación ficticia que debe quedar anulada por legal hold'
where tenant_id='10000000-0000-4000-8000-000000000001'
  and document_id='31000000-0000-4000-8000-000000000001';
do $$begin
  if public.dte_document_deletion_allowed(
    '10000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','2040-01-01'
  ) then raise exception 'legal hold allowed DTE deletion';end if;
  begin
    delete from dte_production_documents
    where tenant_id='10000000-0000-4000-8000-000000000001'
      and id='31000000-0000-4000-8000-000000000001';
    raise exception 'legal hold delete unexpectedly succeeded';
  exception when others then
    if sqlerrm='legal hold delete unexpectedly succeeded' then raise;end if;
  end;
end$$;

-- Deposit is configured commercially but remains tax-policy unconfigured.
insert into services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,
 public_description,tax_description,tax_description_review_status,payment_policy,deposit_type,deposit_value,
 deposit_tax_document_policy_status,payment_configuration_complete)
values
('12000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Servicio con anticipo',60,10000,'CLP',true,'affected',
 'Texto público','Prestación profesional','approved','deposit','percentage',2500,'unconfigured',true);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','pending_payment','pending_payment',33);
select public.billing_initialize_appointment_sale(
 '10000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001',33);
do $$declare s record;begin
 select total_amount,initial_payment_due,balance_due,tax_treatment_status into s
 from billing_sales where tenant_id='10000000-0000-4000-8000-000000000001';
 if s.total_amount<>10000 or s.initial_payment_due<>2500 or s.balance_due<>10000
    or s.tax_treatment_status<>'REVIEW_REQUIRED' then raise exception 'deposit snapshot failed';end if;
 begin
   insert into payment_intents(id,tenant_id,appointment_id,provider,amount,currency,status,idempotency_key)
   values('15000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001',
     '13000000-0000-4000-8000-000000000001','webpay',2500,'CLP','created','blocked-deposit');
   raise exception 'unconfigured deposit created executable intent';
 exception when others then
   if sqlerrm='unconfigured deposit created executable intent' then raise;end if;
   if sqlerrm not like '%DEPOSIT_TAX_DOCUMENT_POLICY_NOT_ENABLED%' then raise;end if;
 end;
 if exists(select 1 from payment_intents where id='15000000-0000-4000-8000-000000000005')
 then raise exception 'blocked deposit intent persisted';end if;
end$$;

-- An unexpected historical webhook is retained once for manual reconciliation.
alter table payment_intents disable trigger deposit_payment_intent_gate;
insert into payment_intents(id,tenant_id,appointment_id,provider,amount,currency,status,idempotency_key)
values('15000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001',
 '13000000-0000-4000-8000-000000000001','webpay',2500,'CLP','created','historical-deposit');
alter table payment_intents enable trigger deposit_payment_intent_gate;
select public.activate_payment_intent('15000000-0000-4000-8000-000000000006',
 'fictional-historical-reference','https://example.invalid/payment',7500);
select public.finalize_verified_payment('15000000-0000-4000-8000-000000000006','webpay',
 'fictional-historical-reference','{"buy_order":"fictional","status":"AUTHORIZED","token":"must-not-persist"}'::jsonb);
do $$declare replay boolean;begin
 select public.finalize_verified_payment('15000000-0000-4000-8000-000000000006','webpay',
   'fictional-historical-reference','{}') into replay;
 if replay then raise exception 'unexpected webhook confirmed reservation twice';end if;
 if (select count(*) from billing_sale_payments
     where payment_intent_id='15000000-0000-4000-8000-000000000006'
       and reconciliation_status='REVIEW_REQUIRED')<>1 then
   raise exception 'historical deposit not retained once for reconciliation';end if;
 if exists(select 1 from dte_invoice_drafts) or exists(select 1 from dte_payment_document_intents)
    or exists(select 1 from dte_production_folio_ledger) then
   raise exception 'unexpected deposit created DTE or folio operation';end if;
 if exists(select 1 from payment_intents where audit_metadata::text like '%must-not-persist%')
 then raise exception 'unexpected webhook payload persisted';end if;
end$$;

-- The unconfigured contributor model blocks type 39 readiness.
insert into dte_tenant_document_capabilities(
 tenant_id,environment,dte_type,customer_selection_enabled,admin_draft_enabled,
 issuance_enabled,certification_status,endpoint_profile,schema_version,updated_at
) values(
 '10000000-0000-4000-8000-000000000001','production',39,false,true,false,
 'pre_caf_ready','production','v1',now());
do $$declare decision jsonb;gate jsonb;begin
 decision:=public.dte_payment_document_policy_decision(
   '10000000-0000-4000-8000-000000000001',39,'webpay',false);
 gate:=public.dte_type39_enablement_gate_report('10000000-0000-4000-8000-000000000001');
 if coalesce((decision->>'blocked')::boolean,false) is not true
    or decision->>'action'<>'BOLETA_MODEL_UNCONFIGURED' then
   raise exception 'unconfigured boleta model did not block policy';end if;
 if coalesce((gate->>'boletaModelReady')::boolean,true) then
   raise exception 'unconfigured boleta model passed type39 gate';end if;
 if exists(select 1 from dte_tenant_document_capabilities where dte_type=39 and issuance_enabled)
 then raise exception 'type39 enabled';end if;
end$$;

-- Full invoice remains independent from the voucher model and is idempotent.
insert into services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,
 public_description,tax_description,tax_description_review_status,payment_policy,payment_configuration_complete)
values('22000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',
 'Servicio pago completo',60,20000,'CLP',true,'affected','Texto público','Servicio general','approved','full_payment',true);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('24000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002',
 '22000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','pending_payment','pending_payment',33);
select public.billing_initialize_appointment_sale(
 '20000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000004',33);
insert into payment_intents(id,tenant_id,appointment_id,provider,amount,currency,status,idempotency_key)
values('25000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000002',
 '24000000-0000-4000-8000-000000000004','webpay',20000,'CLP','created','fictional-full-payment');
select public.activate_payment_intent('25000000-0000-4000-8000-000000000005',
 'fictional-provider-reference','https://example.invalid/payment',0);
select public.finalize_verified_payment('25000000-0000-4000-8000-000000000005','webpay',
 'fictional-provider-reference','{"status":"AUTHORIZED","card_number":"must-not-persist"}'::jsonb);
do $$declare decision jsonb;replay boolean;begin
 decision:=public.dte_payment_document_policy_decision(
   '20000000-0000-4000-8000-000000000002',33,'webpay',true);
 if decision->>'action'<>'ISSUE_FACTURA_33' or (decision->>'blocked')::boolean then
   raise exception 'voucher model suppressed factura 33';end if;
 select public.finalize_verified_payment('25000000-0000-4000-8000-000000000005','webpay',
   'fictional-provider-reference','{}') into replay;
 if replay or (select count(*) from dte_invoice_drafts
   where appointment_id='24000000-0000-4000-8000-000000000004' and dte_type=33)<>1
 then raise exception 'invoice draft idempotency failed';end if;
end$$;

-- Always-issue creates at most one reviewed local intention, never productive work.
update dte_tenant_issuance_settings set
 boleta_payment_document_model='always_issue_boleta',boleta_model_verified_at=now(),
 boleta_model_verified_by='bbbbbbbb-0000-4000-8000-000000000002',
 boleta_model_evidence_reference='Referencia administrativa ficticia'
where tenant_id='20000000-0000-4000-8000-000000000002';
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('24000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000002',
 '22000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','pending_payment','pending_payment',39);
select public.billing_initialize_appointment_sale(
 '20000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000006',39);
insert into payment_intents(id,tenant_id,appointment_id,provider,amount,currency,status,idempotency_key)
values('25000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000002',
 '24000000-0000-4000-8000-000000000006','webpay',20000,'CLP','created','always-boleta');
select public.activate_payment_intent('25000000-0000-4000-8000-000000000007',
 'fictional-always-reference','https://example.invalid/payment',0);
select public.finalize_verified_payment('25000000-0000-4000-8000-000000000007','webpay',
 'fictional-always-reference','{"status":"AUTHORIZED"}'::jsonb);
select public.finalize_verified_payment('25000000-0000-4000-8000-000000000007','webpay',
 'fictional-always-reference','{}');
do $$begin
 if (select count(*) from dte_invoice_drafts
   where appointment_id='24000000-0000-4000-8000-000000000006' and dte_type=39)<>1
 then raise exception 'always-issue did not create exactly one local intention';end if;
 if exists(select 1 from dte_payment_document_intents) or exists(select 1 from dte_production_folio_ledger)
 then raise exception 'always-issue created productive DTE or folio work';end if;
end$$;

-- Voucher-as-boleta is explicit: qualifying vouchers avoid a duplicate boleta;
-- unclassified methods remain review-required, while factura stays independent.
update dte_tenant_issuance_settings set
 boleta_payment_document_model='electronic_payment_voucher_as_boleta',boleta_model_verified_at=now(),
 boleta_model_verified_by='bbbbbbbb-0000-4000-8000-000000000002',
 boleta_model_evidence_reference='Referencia voucher ficticia'
where tenant_id='20000000-0000-4000-8000-000000000002';
do $$declare qualifying jsonb;unclassified jsonb;invoice jsonb;begin
 qualifying:=public.dte_payment_document_policy_decision(
   '20000000-0000-4000-8000-000000000002',39,'webpay',true);
 unclassified:=public.dte_payment_document_policy_decision(
   '20000000-0000-4000-8000-000000000002',39,'transfer',false);
 invoice:=public.dte_payment_document_policy_decision(
   '20000000-0000-4000-8000-000000000002',33,'webpay',true);
 if qualifying->>'action'<>'COVERED_BY_ELECTRONIC_PAYMENT_VOUCHER'
    or (qualifying->>'createBoleta39')::boolean then raise exception 'voucher duplicated boleta';end if;
 if unclassified->>'action'<>'VOUCHER_CLASSIFICATION_REVIEW_REQUIRED'
    or not (unclassified->>'blocked')::boolean then raise exception 'voucher qualification was inferred';end if;
 if invoice->>'action'<>'ISSUE_FACTURA_33' or (invoice->>'blocked')::boolean
 then raise exception 'voucher suppressed factura 33';end if;
end$$;

-- Partial ranges remain independent from payment and cannot overlap.
insert into services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,
 public_description,tax_description,tax_description_review_status,payment_policy,payment_configuration_complete)
values('23000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002',
 'Servicio sin anticipo',30,15000,'CLP',true,'affected','Texto público','Servicio profesional','approved','no_advance',true);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('23000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002',
 '22000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000003','confirmed','confirmed',39);
select public.billing_initialize_appointment_sale(
 '20000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000004',39);
insert into billing_sale_item_document_coverage(tenant_id,sale_id,sale_item_id,dte_type,amount_from,amount_to,status)
select tenant_id,sale_id,id,39,0,5000,'PLANNED' from billing_sale_items
where appointment_id='23000000-0000-4000-8000-000000000004';
do $$begin
 begin
   insert into billing_sale_item_document_coverage(tenant_id,sale_id,sale_item_id,dte_type,amount_from,amount_to,status)
   select tenant_id,sale_id,id,33,4000,7000,'PLANNED' from billing_sale_items
   where appointment_id='23000000-0000-4000-8000-000000000004';
   raise exception 'overlapping boleta/factura range accepted';
 exception when exclusion_violation then null;end;
 update billing_sale_item_document_coverage set status='ISSUED'
 where sale_item_id=(select id from billing_sale_items
   where appointment_id='23000000-0000-4000-8000-000000000004') and amount_from=0;
 update billing_sale_item_document_coverage set status='ACCEPTED'
 where sale_item_id=(select id from billing_sale_items
   where appointment_id='23000000-0000-4000-8000-000000000004') and amount_from=0;
 if not exists(select 1 from billing_sales where total_amount=15000 and documented_amount=5000
   and pending_documentation_amount=10000 and payment_state='UNPAID' and balance_due=15000)
 then raise exception 'paid/documented/pending balances were conflated';end if;
end$$;

-- Minimal tables and model verification contain references, not duplicated PII or credentials.
do $$declare forbidden text[]:=array[
 'name','rut','email','phone','address','health','clinical','notes','payload','credential','token','secret'
];hit integer;begin
 select count(*) into hit from information_schema.columns c,unnest(forbidden) f
 where c.table_schema='public' and c.table_name in (
   'billing_payment_schedule','billing_sale_payments','billing_sale_item_document_coverage',
   'dte_retention_controls','dte_tenant_issuance_settings'
 ) and lower(c.column_name) like '%'||f||'%';
 if hit<>0 then raise exception 'PII or credentials duplicated in minimal policy tables';end if;
 if exists(select 1 from payment_intents where audit_metadata::text ~* 'card_number|token|email|rut')
 then raise exception 'PII or secret persisted in payment audit';end if;
end$$;

set local role authenticated;
set local app.test_uid='aaaaaaaa-0000-4000-8000-000000000001';
do $$declare visible integer;begin
 select count(*) into visible from billing_sales;
 if visible<>1 then raise exception 'RLS tenant isolation failed: %',visible;end if;
end$$;
reset role;

insert into tenant_payment_settings(tenant_id,active,updated_at)
values('10000000-0000-4000-8000-000000000001',true,now());
select public.archive_tenant_for_offboarding(
 '10000000-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000003',
 'Cierre contractual ficticio para prueba local');
do $$begin
 if not exists(select 1 from billing_sales where tenant_id='10000000-0000-4000-8000-000000000001')
 then raise exception 'archive deleted retained history';end if;
 begin
   insert into appointments(id,tenant_id,status)
   values(gen_random_uuid(),'10000000-0000-4000-8000-000000000001','pending');
   raise exception 'archived tenant accepted new operation';
 exception when others then
   if sqlerrm='archived tenant accepted new operation' then raise;end if;
 end;
end$$;

insert into data_retention_policies(
 tenant_id,data_category,legal_basis,minimum_calendar_years,configured_calendar_years,disposition
) values(
 '20000000-0000-4000-8000-000000000002','dte_tax_artifacts',
 'Mínimo legal sujeto a validación tributaria',6,6,'RETAIN'
);

rollback;
