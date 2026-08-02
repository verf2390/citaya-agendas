-- Fictional data only. The test runner verifies the complete transaction rolls back.
begin;

insert into tenants(id,slug,name) values
('10000000-0000-4000-8000-000000000001','accounting-a','Tenant ficticio A'),
('20000000-0000-4000-8000-000000000002','accounting-b','Tenant ficticio B');
insert into tenant_members(tenant_id,user_id,role,is_active) values
('10000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','owner',true),
('20000000-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002','owner',true);
insert into platform_admins(user_id,role,is_active)
values('cccccccc-0000-4000-8000-000000000003','super_admin',true);
insert into customers(id,tenant_id,full_name,email) values
('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Persona ficticia A','a@example.invalid'),
('22000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Persona ficticia B','b@example.invalid');
update tenants set address='Dirección ficticia sin datos reales',contact_email='legal@example.invalid';
insert into dte_production_tenant_settings(
 tenant_id,issuer_legal_name,issuer_rut,issuer_address,issuer_commune,issuer_city
) values
('10000000-0000-4000-8000-000000000001','Prestador ficticio A','11111111-1','Dirección ficticia A','Comuna A','Ciudad A'),
('20000000-0000-4000-8000-000000000002','Prestador ficticio B','22222222-2','Dirección ficticia B','Comuna B','Ciudad B');
insert into tenant_legal_profiles(
 tenant_id,trade_name,contact_address,support_email,privacy_contact_name,privacy_contact_email,
 tenant_is_service_provider,administrative_review_status
) values
('10000000-0000-4000-8000-000000000001','Prestador A','Dirección ficticia A','soporte-a@example.invalid',
 'Contacto privacidad A','privacidad-a@example.invalid',true,'complete'),
('20000000-0000-4000-8000-000000000002','Prestador B','Dirección ficticia B','soporte-b@example.invalid',
 'Contacto privacidad B','privacidad-b@example.invalid',true,'complete');
insert into legal_documents(
 id,owner_kind,tenant_id,document_type,version,title,content,content_sha256,status,effective_at,published_at
) values
('41000000-0000-4000-8000-000000000001','tenant','10000000-0000-4000-8000-000000000001','consumer_terms',1,'Términos ficticios',repeat('Contenido ficticio A. ',3),repeat('a',64),'published',now(),now()),
('41000000-0000-4000-8000-000000000002','tenant','10000000-0000-4000-8000-000000000001','privacy_notice',1,'Privacidad ficticia',repeat('Contenido ficticio B. ',3),repeat('b',64),'published',now(),now()),
('41000000-0000-4000-8000-000000000003','tenant','10000000-0000-4000-8000-000000000001','cancellation_refund_policy',1,'Cancelación ficticia',repeat('Contenido ficticio C. ',3),repeat('c',64),'published',now(),now()),
('41000000-0000-4000-8000-000000000004','tenant','10000000-0000-4000-8000-000000000001','dte_mandate',1,'Mandato ficticio',repeat('Contenido ficticio D. ',3),repeat('d',64),'published',now(),now()),
('42000000-0000-4000-8000-000000000001','tenant','20000000-0000-4000-8000-000000000002','consumer_terms',1,'Términos ficticios',repeat('Contenido ficticio E. ',3),repeat('e',64),'published',now(),now()),
('42000000-0000-4000-8000-000000000002','tenant','20000000-0000-4000-8000-000000000002','privacy_notice',1,'Privacidad ficticia',repeat('Contenido ficticio F. ',3),repeat('f',64),'published',now(),now()),
('42000000-0000-4000-8000-000000000003','tenant','20000000-0000-4000-8000-000000000002','cancellation_refund_policy',1,'Cancelación ficticia',repeat('Contenido ficticio G. ',3),repeat('1',64),'published',now(),now()),
('42000000-0000-4000-8000-000000000004','tenant','20000000-0000-4000-8000-000000000002','dte_mandate',1,'Mandato ficticio',repeat('Contenido ficticio H. ',3),repeat('2',64),'published',now(),now());
insert into legal_acceptances(
 id,tenant_id,document_id,document_version,document_hash,actor_type,actor_user_id,
 acceptance_context,accepted_declaration
) values
('43000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 '41000000-0000-4000-8000-000000000004',1,(select content_sha256 from legal_documents where id='41000000-0000-4000-8000-000000000004'),'tenant_admin',
 'aaaaaaaa-0000-4000-8000-000000000001','dte_mandate','Acepto el mandato tributario ficticio para prueba local'),
('43000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',
 '42000000-0000-4000-8000-000000000004',1,(select content_sha256 from legal_documents where id='42000000-0000-4000-8000-000000000004'),'tenant_admin',
 'bbbbbbbb-0000-4000-8000-000000000002','dte_mandate','Acepto el mandato tributario ficticio para prueba local');
insert into tenant_dte_mandates(
 tenant_id,legal_acceptance_id,signer_full_name,signer_rut,signer_capacity,
 has_representative_authority,may_generate,may_sign,may_submit,may_query,may_retain,
 may_custody_certificate,may_custody_caf
) values
('10000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',
 'Firmante ficticio A','11111111-1','Representante ficticio',true,true,true,true,true,true,true,true),
('20000000-0000-4000-8000-000000000002','43000000-0000-4000-8000-000000000002',
 'Firmante ficticio B','22222222-2','Representante ficticio',true,true,true,true,true,true,true,true);
insert into dte_tenant_issuance_settings(
 tenant_id,production_enabled,issuance_mode,updated_at,deposit_tax_document_policy_status,
 boleta_payment_document_model,boleta_model_verified_at,boleta_model_verified_by,boleta_model_evidence_reference
) values
('10000000-0000-4000-8000-000000000001',false,'manual',now(),'enabled','always_issue_boleta',now(),
 'aaaaaaaa-0000-4000-8000-000000000001','Verificación ficticia local A'),
('20000000-0000-4000-8000-000000000002',false,'manual',now(),'enabled','electronic_payment_voucher_as_boleta',now(),
 'bbbbbbbb-0000-4000-8000-000000000002','Verificación ficticia local B');
insert into tenant_payment_method_tax_policies(
 tenant_id,provider,classification,verified_at,verified_by,evidence_reference
) values('20000000-0000-4000-8000-000000000002','webpay','voucher_as_boleta',now(),
 'bbbbbbbb-0000-4000-8000-000000000002','Clasificación ficticia local de voucher');

-- Parameterized integer policy calculations. Thirty percent is fixture data,
-- never a global default.
do $$declare c record;actual bigint;begin
 for c in select * from (values
   (40000::bigint,'no_advance'::text,''::text,0::bigint,null::bigint,null::bigint,0::bigint),
   (40000::bigint,'deposit','percentage',3000,null,null,12000),
   (10001::bigint,'deposit','percentage',3333,null,null,3333),
   (10000::bigint,'deposit','fixed_amount',2500,null,null,2500),
   (10000::bigint,'deposit','percentage',1000,2000,3000,2000),
   (60000::bigint,'full_payment','',0,null,null,60000)
 ) v(total,policy,deposit_type,deposit_value,minimum,maximum,expected)
 loop
   actual:=public.billing_calculate_initial_due(c.total,c.policy,c.deposit_type,c.deposit_value,c.minimum,c.maximum);
   if actual<>c.expected then raise exception 'policy calculation mismatch: %, %',c.policy,actual;end if;
 end loop;
 begin
   perform public.billing_calculate_initial_due(10000,'deposit','percentage',10000,null,null);
   raise exception '100 percent deposit accepted';
 exception when others then if sqlerrm='100 percent deposit accepted' then raise;end if;end;
 begin
   perform public.billing_calculate_initial_due(0,'full_payment','',0,null,null);
   raise exception 'zero-price full payment accepted';
 exception when others then if sqlerrm='zero-price full payment accepted' then raise;end if;end;
end$$;

-- Required mixed sale: 40,000 at 30% plus 60,000 full payment.
insert into services(id,tenant_id,name,internal_description,duration_min,price,currency,is_active,tax_treatment,
 public_description,tax_description,tax_description_review_status,payment_policy,deposit_type,deposit_value,
 deposit_tax_document_policy_status,payment_configuration_complete)
values
('12000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Servicio A',
 'Nota interna que jamás llega al DTE',60,40000,'CLP',true,'affected','Texto público A','Prestación profesional A',
 'approved','deposit','percentage',3000,'enabled',true),
('12000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Servicio B',
 'Diagnóstico interno ficticio',60,60000,'CLP',true,'affected','Texto público B','Prestación profesional B',
 'approved','full_payment',null,null,'unconfigured',true);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type) values
('13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','pending_payment','pending_payment',39),
('13000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
 '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002','pending_payment','pending_payment',39);
select public.billing_initialize_sale_from_appointments(
 '10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',
 array['13000000-0000-4000-8000-000000000001'::uuid,'13000000-0000-4000-8000-000000000002'::uuid],39);
do $$declare sale record;begin
 select * into sale from billing_sales where tenant_id='10000000-0000-4000-8000-000000000001';
 if sale.total_amount<>100000 or sale.initial_payment_due<>72000 or sale.balance_due<>100000
    or sale.paid_amount<>0 then raise exception 'mixed sale totals invalid';end if;
 if (select amount from billing_payment_schedule where sale_id=sale.id and installment_kind='initial')<>72000
    or (select amount from billing_payment_schedule where sale_id=sale.id and installment_kind='balance')<>28000
 then raise exception 'mixed schedule totals invalid';end if;
 if not exists(select 1 from billing_payment_schedule_allocations a join billing_sale_items i on i.id=a.sale_item_id
   join billing_payment_schedule s on s.id=a.schedule_id where s.installment_kind='initial'
   and i.service_id='12000000-0000-4000-8000-000000000001' and a.allocated_amount=12000)
 or not exists(select 1 from billing_payment_schedule_allocations a join billing_sale_items i on i.id=a.sale_item_id
   join billing_payment_schedule s on s.id=a.schedule_id where s.installment_kind='initial'
   and i.service_id='12000000-0000-4000-8000-000000000002' and a.allocated_amount=60000)
 or not exists(select 1 from billing_payment_schedule_allocations a join billing_sale_items i on i.id=a.sale_item_id
   join billing_payment_schedule s on s.id=a.schedule_id where s.installment_kind='balance'
   and i.service_id='12000000-0000-4000-8000-000000000001' and a.amount_from=12000 and a.amount_to=40000)
 then raise exception 'line range allocation invalid';end if;
 if exists(select 1 from billing_sale_items where service_snapshot::text ~* 'Nota interna|Diagnóstico')
 then raise exception 'internal description leaked into sale snapshot';end if;
end$$;

-- Initial verified payment: one 72,000 multi-item review draft and exact ranges.
insert into payment_intents(id,tenant_id,appointment_id,billing_payment_schedule_id,provider,amount,currency,status,
 idempotency_key,tax_document_method_classification)
select '15000000-0000-4000-8000-000000000001',s.tenant_id,'13000000-0000-4000-8000-000000000001',s.id,
 'webpay',72000,'CLP','created','mixed-initial','requires_boleta'
from billing_payment_schedule s where s.tenant_id='10000000-0000-4000-8000-000000000001' and s.installment_kind='initial';
select public.activate_payment_intent('15000000-0000-4000-8000-000000000001',
 'fictional-initial-reference','https://example.invalid/initial',28000);
select public.finalize_verified_payment('15000000-0000-4000-8000-000000000001','webpay',
 'fictional-initial-reference','{"status":"AUTHORIZED","card_number":"must-not-persist","cvv":"must-not-persist"}'::jsonb);
do $$declare replay boolean;begin
 select public.finalize_verified_payment('15000000-0000-4000-8000-000000000001','webpay',
  'fictional-initial-reference','{}') into replay;
 if replay then raise exception 'initial webhook replay transitioned twice';end if;
 if (select count(*) from billing_sale_payments where payment_intent_id='15000000-0000-4000-8000-000000000001')<>1
 or (select count(*) from dte_invoice_drafts where payment_intent_id='15000000-0000-4000-8000-000000000001')<>1
 or (select count(*) from billing_sale_item_document_coverage where sale_payment_id=(select id from billing_sale_payments
   where payment_intent_id='15000000-0000-4000-8000-000000000001'))<>2
 then raise exception 'initial payment idempotency failed';end if;
 if not exists(select 1 from billing_sales where total_amount=100000 and paid_amount=72000
   and balance_due=28000 and payment_state='PARTIALLY_PAID') then raise exception 'initial balance state invalid';end if;
 if exists(select 1 from appointments where id in(
   '13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002')
   and booking_status<>'confirmed') then raise exception 'deposit did not confirm sale appointments';end if;
 if (select total_amount from dte_invoice_drafts where payment_intent_id='15000000-0000-4000-8000-000000000001')<>72000
 or (select sum(total_amount) from dte_invoice_draft_lines where draft_id=(select id from dte_invoice_drafts
   where payment_intent_id='15000000-0000-4000-8000-000000000001'))<>72000
 then raise exception 'initial partial DTE totals invalid';end if;
 if not exists(select 1 from dte_invoice_draft_lines where description='Anticipo Prestación profesional A' and total_amount=12000)
 or not exists(select 1 from dte_invoice_draft_lines where description='Prestación profesional B' and total_amount=60000)
 then raise exception 'initial tax descriptions invalid';end if;
 if exists(select 1 from payment_intents where audit_metadata::text ~* 'card_number|cvv|must-not-persist')
 then raise exception 'payment payload or card data persisted';end if;
 if exists(select 1 from dte_payment_document_intents) or exists(select 1 from dte_production_folio_ledger)
 then raise exception 'review draft created productive DTE or folio work';end if;
end$$;

-- Balance payment: second payment and second draft, only the remaining 28,000.
insert into payment_intents(id,tenant_id,appointment_id,billing_payment_schedule_id,provider,amount,currency,status,
 idempotency_key,tax_document_method_classification)
select '15000000-0000-4000-8000-000000000002',s.tenant_id,'13000000-0000-4000-8000-000000000001',s.id,
 'webpay',28000,'CLP','created','mixed-balance','requires_boleta'
from billing_payment_schedule s where s.tenant_id='10000000-0000-4000-8000-000000000001' and s.installment_kind='balance';
select public.activate_payment_intent('15000000-0000-4000-8000-000000000002',
 'fictional-balance-reference','https://example.invalid/balance',0);
select public.finalize_verified_payment('15000000-0000-4000-8000-000000000002','webpay',
 'fictional-balance-reference','{"status":"AUTHORIZED"}'::jsonb);
select public.finalize_verified_payment('15000000-0000-4000-8000-000000000002','webpay',
 'fictional-balance-reference','{}');
do $$declare sale record;begin
 select * into sale from billing_sales where tenant_id='10000000-0000-4000-8000-000000000001';
 if sale.paid_amount<>100000 or sale.balance_due<>0 or sale.payment_state<>'PAID'
 then raise exception 'final balance state invalid';end if;
 if (select count(*) from billing_sale_payments where sale_id=sale.id)<>2
 or (select count(*) from dte_invoice_drafts where sale_id=sale.id)<>2
 or (select count(*) from billing_sale_item_document_coverage where sale_id=sale.id)<>3
 then raise exception 'balance idempotency or per-payment draft cardinality failed';end if;
 if (select total_amount from dte_invoice_drafts where payment_intent_id='15000000-0000-4000-8000-000000000002')<>28000
 or (select sum(amount_to-amount_from) from billing_sale_item_document_coverage where sale_id=sale.id)<>100000
 then raise exception 'balance coverage total invalid';end if;
 if (select sum(net_amount) from dte_invoice_drafts where sale_id=sale.id)<>sale.net_amount
 or (select sum(tax_amount) from dte_invoice_drafts where sale_id=sale.id)<>sale.tax_amount
 or (select sum(total_amount) from dte_invoice_drafts where sale_id=sale.id)<>sale.total_amount
 then raise exception 'partial IVA reconciliation invalid';end if;
 begin
   insert into billing_sale_item_document_coverage(tenant_id,sale_id,sale_item_id,dte_type,amount_from,amount_to,
     status,coverage_source,draft_id)
   select tenant_id,sale_id,id,39,10000,13000,'PLANNED','DTE',
     (select id from dte_invoice_drafts where payment_intent_id='15000000-0000-4000-8000-000000000001')
   from billing_sale_items where service_id='12000000-0000-4000-8000-000000000001';
   raise exception 'overlapping boleta/factura coverage accepted';
 exception when exclusion_violation then null;end;
end$$;

-- Mark reviewed ranges accepted, then block automatic refund pending type 61.
update billing_sale_item_document_coverage set status='ISSUED' where tenant_id='10000000-0000-4000-8000-000000000001';
update billing_sale_item_document_coverage set status='ACCEPTED' where tenant_id='10000000-0000-4000-8000-000000000001';
do $$declare result jsonb;begin
 if not exists(select 1 from billing_sales where tenant_id='10000000-0000-4000-8000-000000000001'
   and documented_amount=100000 and pending_documentation_amount=0) then raise exception 'accepted coverage totals invalid';end if;
 result:=public.billing_request_refund_review('10000000-0000-4000-8000-000000000001',
   (select id from billing_sale_payments where payment_intent_id='15000000-0000-4000-8000-000000000001'),
   'aaaaaaaa-0000-4000-8000-000000000001');
 if coalesce((result->>'taxDocumentRequired')::boolean,false) is not true
    or coalesce((result->>'automaticRefundAllowed')::boolean,true) is not false
 then raise exception 'documented refund was not blocked';end if;
end$$;

-- No advance confirms immediately, creates only a BALANCE schedule and no DTE.
insert into services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,public_description,
 tax_description,tax_description_review_status,payment_policy,payment_configuration_complete)
values('23000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002',
 'Sin anticipo',30,15000,'CLP',true,'affected','Público','Servicio profesional','approved','no_advance',true);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('23000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002',
 '22000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000003','pending','pending',33);
select public.billing_initialize_appointment_sale('20000000-0000-4000-8000-000000000002',
 '23000000-0000-4000-8000-000000000004',33);
do $$begin
 if not exists(select 1 from appointments where id='23000000-0000-4000-8000-000000000004'
   and booking_status='confirmed' and payment_status is null) then raise exception 'no-advance was not confirmed unpaid';end if;
 if exists(select 1 from billing_payment_schedule s join billing_sale_appointments a on a.sale_id=s.sale_id
   where a.appointment_id='23000000-0000-4000-8000-000000000004' and s.installment_kind='initial')
 then raise exception 'no-advance created initial schedule';end if;
end$$;

-- Explicit voucher-as-boleta covers the payment externally without a duplicate draft.
insert into services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,public_description,
 tax_description,tax_description_review_status,payment_policy,payment_configuration_complete)
values('24000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002',
 'Voucher explícito',30,10000,'CLP',true,'affected','Público','Servicio general','approved','full_payment',true);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('24000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002',
 '22000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000003','pending_payment','pending_payment',39);
select public.billing_initialize_appointment_sale('20000000-0000-4000-8000-000000000002',
 '24000000-0000-4000-8000-000000000004',39);
insert into payment_intents(id,tenant_id,appointment_id,billing_payment_schedule_id,provider,amount,currency,status,
 idempotency_key,tax_document_method_classification)
select '25000000-0000-4000-8000-000000000005',s.tenant_id,'24000000-0000-4000-8000-000000000004',s.id,
 'webpay',10000,'CLP','created','voucher-payment','voucher_as_boleta'
from billing_payment_schedule s join billing_sale_appointments a on a.sale_id=s.sale_id
where a.appointment_id='24000000-0000-4000-8000-000000000004';
select public.activate_payment_intent('25000000-0000-4000-8000-000000000005',
 'fictional-voucher-reference','https://example.invalid/voucher',0);
select public.finalize_verified_payment('25000000-0000-4000-8000-000000000005','webpay',
 'fictional-voucher-reference','{"status":"AUTHORIZED"}'::jsonb);
select public.finalize_verified_payment('25000000-0000-4000-8000-000000000005','webpay',
 'fictional-voucher-reference','{}');
do $$begin
 if exists(select 1 from dte_invoice_drafts where payment_intent_id='25000000-0000-4000-8000-000000000005')
 or (select count(*) from billing_sale_item_document_coverage where coverage_source='ELECTRONIC_PAYMENT_VOUCHER'
   and sale_payment_id=(select id from billing_sale_payments where payment_intent_id='25000000-0000-4000-8000-000000000005'))<>1
 then raise exception 'voucher created duplicate boleta or missing external coverage';end if;
end$$;

-- A provider-confirmed amount different from the frozen schedule is retained
-- for reconciliation without applying it, confirming or documenting it.
insert into services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,public_description,
 tax_description,tax_description_review_status,payment_policy,payment_configuration_complete)
values('25000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000002',
 'Monto divergente',30,7000,'CLP',true,'affected','Público','Servicio general','approved','no_advance',true);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('25000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000002',
 '22000000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000010','pending','pending',33);
select public.billing_initialize_appointment_sale('20000000-0000-4000-8000-000000000002',
 '25000000-0000-4000-8000-000000000011',33);
insert into payment_intents(id,tenant_id,appointment_id,billing_payment_schedule_id,provider,amount,currency,status,
 idempotency_key)
select '25000000-0000-4000-8000-000000000012',s.tenant_id,'25000000-0000-4000-8000-000000000011',s.id,
 'webpay',7000,'CLP','created','mismatch-payment'
from billing_payment_schedule s join billing_sale_appointments a on a.sale_id=s.sale_id
where a.appointment_id='25000000-0000-4000-8000-000000000011';
select public.activate_payment_intent('25000000-0000-4000-8000-000000000012',
 'fictional-mismatch-reference','https://example.invalid/mismatch',0);
select public.billing_record_unapplied_provider_payment('25000000-0000-4000-8000-000000000012',
 'webpay','fictional-mismatch-reference',6999,'{"status":"AUTHORIZED","token":"must-not-persist"}');
do $$begin
 if not exists(select 1 from billing_sale_payments where payment_intent_id='25000000-0000-4000-8000-000000000012'
   and amount=6999 and reconciliation_status='REVIEW_REQUIRED')
 or exists(select 1 from dte_invoice_drafts where payment_intent_id='25000000-0000-4000-8000-000000000012')
 or not exists(select 1 from billing_sales s join billing_sale_appointments a on a.sale_id=s.id
   where a.appointment_id='25000000-0000-4000-8000-000000000011' and s.paid_amount=0 and s.balance_due=7000)
 then raise exception 'mismatched provider payment was applied automatically';end if;
 if exists(select 1 from payment_intents where id='25000000-0000-4000-8000-000000000012'
   and audit_metadata::text ~* 'token|must-not-persist') then raise exception 'mismatch payload persisted';end if;
end$$;

-- A credit invoice can cover an unpaid sale; later payment does not duplicate it.
do $$declare v_sale_id uuid;item_id uuid;draft_id uuid:='26000000-0000-4000-8000-000000000006';schedule_id uuid;begin
 select a.sale_id into v_sale_id from billing_sale_appointments a
 where a.appointment_id='23000000-0000-4000-8000-000000000004';
 select id into item_id from billing_sale_items where sale_id=v_sale_id;
 insert into dte_invoice_drafts(id,tenant_id,sale_id,customer_id,appointment_id,dte_type,source,status,
   issuer_preview,recipient_preview,net_amount,tax_amount,total_amount,payment_amount_snapshot,review_reason,idempotency_key)
 values(draft_id,'20000000-0000-4000-8000-000000000002',v_sale_id,'22000000-0000-4000-8000-000000000002',
   '23000000-0000-4000-8000-000000000004',33,'appointment','REVIEW_REQUIRED','{}','{}',12605,2395,15000,null,
   'MANUAL_CREDIT_INVOICE_REVIEW','fictional-credit-invoice');
 insert into billing_sale_item_document_coverage(tenant_id,sale_id,sale_item_id,dte_type,amount_from,amount_to,
   status,coverage_source,draft_id,document_relation_status)
 values('20000000-0000-4000-8000-000000000002',v_sale_id,item_id,33,0,15000,'ACCEPTED','DTE',draft_id,'VALIDATED');
 if (select paid_amount from billing_sales where id=v_sale_id)<>0 then raise exception 'credit invoice marked payment received';end if;
 select id into schedule_id from billing_payment_schedule where sale_id=v_sale_id and installment_kind='balance';
 insert into payment_intents(id,tenant_id,appointment_id,billing_payment_schedule_id,provider,amount,currency,status,
   provider_payment_id,idempotency_key,tax_document_method_classification)
 values('26000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000002',
   '23000000-0000-4000-8000-000000000004',schedule_id,'manual',15000,'CLP','pending',
   'fictional-credit-payment','credit-payment','unconfigured');
 insert into payments(tenant_id,appointment_id,external_reference,amount,status,provider,currency,payment_intent_id)
 values('20000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000004',
   'fictional-credit-payment',15000,'pending','manual','CLP','26000000-0000-4000-8000-000000000007');
 perform public.finalize_verified_payment('26000000-0000-4000-8000-000000000007','manual','fictional-credit-payment','{}');
 if (select count(*) from dte_invoice_drafts where sale_id=v_sale_id)<>1
 then raise exception 'credit invoice duplicated after collection';end if;
end$$;

-- Exempt services remain blocked until 34/41 support exists.
insert into services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,public_description,
 tax_description,tax_description_review_status,payment_policy,payment_configuration_complete)
values('27000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
 'Exento ficticio',30,5000,'CLP',true,'exempt','Público','Prestación exenta','approved','full_payment',true);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('27000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',
 '22000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000001','pending','pending',33);
do $$begin
 begin perform public.billing_initialize_appointment_sale('20000000-0000-4000-8000-000000000002',
   '27000000-0000-4000-8000-000000000002',33);raise exception 'exempt sale initialized as affected';
 exception when others then if sqlerrm='exempt sale initialized as affected' then raise;end if;
   if sqlerrm not like '%EXEMPT_DOCUMENT_TYPE_UNSUPPORTED%' then raise;end if;end;
end$$;

-- Fixed deposit and provisional expiry affect only the still-pending booking.
insert into services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,public_description,
 tax_description,tax_description_review_status,payment_policy,deposit_type,deposit_value,
 deposit_tax_document_policy_status,payment_configuration_complete,provisional_expiry_minutes)
values('28000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
 'Anticipo fijo',30,10000,'CLP',true,'affected','Público','Servicio general','approved','deposit',
 'fixed_amount',2500,'enabled',true,30);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('28000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',
 '22000000-0000-4000-8000-000000000002','28000000-0000-4000-8000-000000000001','pending_payment','pending_payment',33);
select public.billing_initialize_appointment_sale('20000000-0000-4000-8000-000000000002',
 '28000000-0000-4000-8000-000000000002',33);
update billing_payment_schedule set expires_at=now()-interval '1 minute'
where sale_id=(select sale_id from billing_sale_appointments where appointment_id='28000000-0000-4000-8000-000000000002')
 and installment_kind='initial';
insert into payment_intents(id,tenant_id,appointment_id,billing_payment_schedule_id,provider,amount,currency,status,idempotency_key)
select '28000000-0000-4000-8000-000000000003',s.tenant_id,'28000000-0000-4000-8000-000000000002',s.id,
 'webpay',2500,'CLP','created','expiring-fixed-deposit' from billing_payment_schedule s
where s.sale_id=(select sale_id from billing_sale_appointments where appointment_id='28000000-0000-4000-8000-000000000002')
 and s.installment_kind='initial';
select public.billing_expire_provisional_schedule('20000000-0000-4000-8000-000000000002',
 (select id from billing_payment_schedule where sale_id=(select sale_id from billing_sale_appointments
   where appointment_id='28000000-0000-4000-8000-000000000002') and installment_kind='initial'),now());
do $$begin
 if not exists(select 1 from appointments where id='28000000-0000-4000-8000-000000000002'
   and booking_status='expired')
 or not exists(select 1 from payment_intents where id='28000000-0000-4000-8000-000000000003' and status='expired')
 or exists(select 1 from dte_invoice_drafts where payment_intent_id='28000000-0000-4000-8000-000000000003')
 then raise exception 'provisional expiry behavior invalid';end if;
end$$;

-- Calendar retention and legal hold remain intact.
do $$begin
 if public.dte_calendar_retention_not_before('2024-02-29 12:00:00+00')<>
   '2030-02-28 12:00:00+00'::timestamptz then raise exception 'calendar retention leap boundary invalid';end if;
end$$;
insert into dte_production_documents(id,tenant_id,dte_type,issue_date,created_at)
values('31000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',39,'2016-02-29','2016-02-29 12:00+00');
update dte_retention_controls set legal_hold=true,legal_hold_reason='Retención ficticia para prueba local',
 legal_hold_set_at=now(),legal_hold_set_by='cccccccc-0000-4000-8000-000000000003'
where document_id='31000000-0000-4000-8000-000000000001';
do $$begin if public.dte_document_deletion_allowed('10000000-0000-4000-8000-000000000001',
 '31000000-0000-4000-8000-000000000001','2040-01-01') then raise exception 'legal hold allowed deletion';end if;end$$;

-- New accounting tables remain PII-minimal and tenant-isolated.
do $$declare forbidden text[]:=array['name','rut','email','phone','address','health','clinical','notes','payload','card','cvv','credential','token','secret'];hit integer;begin
 select count(*) into hit from information_schema.columns c,unnest(forbidden) f
 where c.table_schema='public' and c.table_name in('billing_payment_schedule','billing_payment_schedule_allocations',
   'billing_payment_schedule_events','billing_sale_payments','billing_sale_item_document_coverage')
   and lower(c.column_name) like '%'||f||'%';
 if hit<>0 then raise exception 'PII duplicated in accounting tables';end if;
end$$;
set local role authenticated;
set local app.test_uid='aaaaaaaa-0000-4000-8000-000000000001';
do $$declare visible integer;begin
 select count(*) into visible from billing_payment_schedule_allocations;
 if visible<>3 then raise exception 'allocation RLS isolation failed: %',visible;end if;
end$$;
reset role;

-- Archived tenant blocks new operations while preserving all history.
insert into tenant_payment_settings(tenant_id,active,updated_at)
values('10000000-0000-4000-8000-000000000001',true,now());
select public.archive_tenant_for_offboarding('10000000-0000-4000-8000-000000000001',
 'cccccccc-0000-4000-8000-000000000003','Cierre contractual ficticio para prueba local');
do $$begin
 if not exists(select 1 from billing_sales where tenant_id='10000000-0000-4000-8000-000000000001')
 then raise exception 'archiving deleted accounting history';end if;
 begin insert into appointments(id,tenant_id,status) values(gen_random_uuid(),
   '10000000-0000-4000-8000-000000000001','pending');raise exception 'archived tenant accepted operation';
 exception when others then if sqlerrm='archived tenant accepted operation' then raise;end if;end;
end$$;

do $$begin
 if exists(select 1 from dte_tenant_document_capabilities where dte_type=39 and issuance_enabled)
 or exists(select 1 from dte_payment_document_intents) or exists(select 1 from dte_production_folio_ledger)
 then raise exception 'productive type39 work was enabled';end if;
end$$;

rollback;
