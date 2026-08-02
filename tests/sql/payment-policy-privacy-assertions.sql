-- Fictional identifiers only.
begin;
insert into tenants(id,slug,name) values
('10000000-0000-4000-8000-000000000001','tenant-a','Tenant A'),
('20000000-0000-4000-8000-000000000002','tenant-b','Tenant B');
insert into tenant_members values
('10000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','owner',true),
('20000000-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002','owner',true);
insert into platform_admins values('cccccccc-0000-4000-8000-000000000003','super_admin',true);
insert into customers(id,tenant_id,full_name,email) values
('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Persona ficticia A','a@example.invalid'),
('22000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Persona ficticia B','b@example.invalid');
insert into services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,
 public_description,tax_description,tax_description_review_status,payment_policy,deposit_type,deposit_value,payment_configuration_complete)
values
('12000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Servicio A',60,10000,'CLP',true,'affected','Texto público','Prestación profesional','approved','deposit','percentage',2500,true),
('22000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Servicio B',60,20000,'CLP',true,'affected','Texto público','Servicio general','approved','full_payment',null,null,true);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','pending_payment','pending_payment',33);
select public.billing_initialize_appointment_sale('10000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001',33);

do $$declare s record;begin
 select total_amount,initial_payment_due,balance_due,tax_treatment_status into s from billing_sales where tenant_id='10000000-0000-4000-8000-000000000001';
 if s.total_amount<>10000 or s.initial_payment_due<>2500 or s.balance_due<>10000 or s.tax_treatment_status<>'REVIEW_REQUIRED' then raise exception 'deposit snapshot failed';end if;
 if exists(select 1 from dte_invoice_drafts) or exists(select 1 from dte_payment_document_intents) then raise exception 'deposit created DTE operation';end if;
end$$;

-- no_advance confirms with the complete balance still due.
insert into services(id,tenant_id,name,duration_min,price,currency,is_active,tax_treatment,
 public_description,tax_description,tax_description_review_status,payment_policy,payment_configuration_complete)
values('23000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','Servicio sin anticipo',30,15000,'CLP',true,'affected','Texto público','Servicio profesional','approved','no_advance',true);
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('23000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000003','confirmed','confirmed',39);
select public.billing_initialize_appointment_sale('20000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000004',39);
do $$declare s record;begin select initial_payment_due,balance_due,payment_state into s from billing_sales where tenant_id='20000000-0000-4000-8000-000000000002' and total_amount=15000;
 if s.initial_payment_due<>0 or s.balance_due<>15000 or s.payment_state<>'UNPAID' then raise exception 'no advance state failed';end if;end$$;

-- full payment is idempotent, creates one review draft and one planned coverage,
-- but never creates the productive DTE intent/outbox or reserves a folio.
insert into appointments(id,tenant_id,customer_id,service_id,status,booking_status,requested_document_type)
values('24000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','pending_payment','pending_payment',33);
select public.billing_initialize_appointment_sale('20000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000004',33);
insert into payment_intents(id,tenant_id,appointment_id,provider,amount,currency,status,idempotency_key)
values('25000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000004','webpay',20000,'CLP','created','fictional-full-payment');
select public.activate_payment_intent('25000000-0000-4000-8000-000000000005','fictional-provider-reference','https://example.invalid/payment',0);
select public.finalize_verified_payment('25000000-0000-4000-8000-000000000005','webpay','fictional-provider-reference',
 '{"buy_order":"fictional","status":"AUTHORIZED","card_number":"must-not-persist"}'::jsonb);
do $$declare replay boolean;begin
 select public.finalize_verified_payment('25000000-0000-4000-8000-000000000005','webpay','fictional-provider-reference','{}') into replay;
 if replay then raise exception 'repeated webhook transitioned twice';end if;
 if (select count(*) from billing_sale_payments where payment_intent_id='25000000-0000-4000-8000-000000000005')<>1 then raise exception 'payment duplicated';end if;
 if (select count(*) from dte_invoice_drafts where appointment_id='24000000-0000-4000-8000-000000000004')<>1 then raise exception 'draft duplicated or missing';end if;
 if exists(select 1 from payment_intents where audit_metadata::text like '%card_number%') then raise exception 'provider payload persisted';end if;
 if exists(select 1 from dte_payment_document_intents) then raise exception 'productive DTE intent created';end if;
 begin
   insert into billing_sale_item_document_coverage(tenant_id,sale_id,sale_item_id,dte_type,amount_from,amount_to,status)
   select tenant_id,sale_id,id,39,0,total_amount,'PLANNED' from billing_sale_items where appointment_id='24000000-0000-4000-8000-000000000004';
   raise exception 'overlapping boleta/factura coverage accepted';
 exception when exclusion_violation then null;end;
end$$;

do $$declare forbidden text[]:=array['name','rut','email','phone','address','health','clinical','notes','payload']; hit integer;begin
 select count(*) into hit from information_schema.columns c,unnest(forbidden) f
  where c.table_schema='public' and c.table_name in ('billing_payment_schedule','billing_sale_payments','billing_sale_item_document_coverage')
    and lower(c.column_name) like '%'||f||'%';
 if hit<>0 then raise exception 'PII duplicated in minimal billing tables';end if;
end$$;

set local role authenticated;
set local app.test_uid='aaaaaaaa-0000-4000-8000-000000000001';
do $$declare visible integer;begin select count(*) into visible from billing_sales;if visible<>1 then raise exception 'RLS tenant isolation failed';end if;end$$;
reset role;

insert into dte_tenant_document_capabilities values
('10000000-0000-4000-8000-000000000001','certification',39,false,true,false,'pre_caf_ready',now());
do $$begin if exists(select 1 from dte_tenant_document_capabilities where dte_type=39 and issuance_enabled) then raise exception 'type39 enabled';end if;end$$;

insert into tenant_payment_settings values('10000000-0000-4000-8000-000000000001',true,now());
insert into dte_tenant_issuance_settings values('10000000-0000-4000-8000-000000000001',false,'manual',now());
select public.archive_tenant_for_offboarding('10000000-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000003','Cierre contractual ficticio para prueba local');
do $$begin
 if not exists(select 1 from billing_sales where tenant_id='10000000-0000-4000-8000-000000000001') then raise exception 'archive deleted history';end if;
 begin insert into appointments(id,tenant_id,status) values(gen_random_uuid(),'10000000-0000-4000-8000-000000000001','pending');raise exception 'archived accepted operation';exception when others then if sqlerrm='archived accepted operation' then raise;end if;end;
end$$;

insert into data_retention_policies(tenant_id,data_category,legal_basis,minimum_days,configured_days,disposition)
values('20000000-0000-4000-8000-000000000002','dte_tax_artifacts','Obligación tributaria',2190,2190,'RETAIN');

rollback;
