-- Fictional identifiers only. The bootstrap transaction rolls back migrations
-- and every fixture/assertion in this file.

insert into public.tenants(id,slug,name) values
('31000000-0000-4000-8000-000000000001','mode-unclassified','Tenant ficticio sin clasificar'),
('32000000-0000-4000-8000-000000000002','mode-demo','Tenant ficticio demo'),
('33000000-0000-4000-8000-000000000003','mode-live','Tenant ficticio live'),
('34000000-0000-4000-8000-000000000004','mode-internal','Tenant ficticio interno'),
('35000000-0000-4000-8000-000000000005','mode-archived','Tenant ficticio archivado'),
('36000000-0000-4000-8000-000000000006','mode-history','Tenant ficticio histórico');

insert into public.platform_admins(user_id,role,is_active)
values('3c000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.tenant_members(tenant_id,user_id,role,is_active)
values('31000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','owner',true);

-- Existing and newly inserted rows are unclassified until an explicit action.
do $$begin
  if exists(select 1 from public.tenants where operational_mode<>'unclassified')
  then raise exception 'migration inferred an operational mode';end if;
end$$;

select public.set_tenant_operational_mode(
  '32000000-0000-4000-8000-000000000002','demo',
  '3c000000-0000-4000-8000-000000000001','Clasificación demo ficticia para prueba local'
);
update public.tenants set operational_mode='live'
where id in ('33000000-0000-4000-8000-000000000003','36000000-0000-4000-8000-000000000006');
update public.tenants set operational_mode='internal'
where id='34000000-0000-4000-8000-000000000004';
update public.tenants set lifecycle_status='archived',archived_at=now(),
  archived_by='3c000000-0000-4000-8000-000000000001',
  archive_reason='Archivado ficticio para verificar conservación local'
where id='35000000-0000-4000-8000-000000000005';

-- SQL capabilities match the backend matrix and lifecycle wins over mode.
do $$declare caps jsonb;begin
  caps:=public.resolve_tenant_operational_capabilities('31000000-0000-4000-8000-000000000001');
  if (caps->>'informationalPage')::boolean is not true
     or (caps->>'createAppointment')::boolean is not false
     or (caps->>'classificationAdmin')::boolean is not true
  then raise exception 'unclassified capability mismatch';end if;

  caps:=public.resolve_tenant_operational_capabilities('32000000-0000-4000-8000-000000000002');
  if (caps->>'demoSimulation')::boolean is not true
     or (caps->>'createAppointment')::boolean is not false
     or (caps->>'createPayment')::boolean is not false
     or (caps->>'enqueueDte')::boolean is not false
  then raise exception 'demo capability mismatch';end if;

  caps:=public.resolve_tenant_operational_capabilities('33000000-0000-4000-8000-000000000003');
  if (caps->>'createAppointment')::boolean is not true
     or (caps->>'createPayment')::boolean is not true
     or (caps->>'enqueueDte')::boolean is not true
     or (caps->>'dteCertification')::boolean is not false
  then raise exception 'live capability mismatch';end if;

  caps:=public.resolve_tenant_operational_capabilities('34000000-0000-4000-8000-000000000004');
  if (caps->>'createAppointment')::boolean is not false
     or (caps->>'taxAdministration')::boolean is not true
     or (caps->>'dteCertification')::boolean is not true
     or (caps->>'enqueueDte')::boolean is not false
  then raise exception 'internal capability mismatch';end if;

  caps:=public.resolve_tenant_operational_capabilities('35000000-0000-4000-8000-000000000005');
  if (caps->>'informationalPage')::boolean is not false
     or (caps->>'ordinaryAdmin')::boolean is not false
     or (caps->>'exceptionalPlatformAccess')::boolean is not true
  then raise exception 'archived capability mismatch';end if;
end$$;

-- Tenant administrators cannot classify themselves; live classification is
-- separately fail-closed on the complete readiness checklist.
do $$begin
  begin
    perform public.set_tenant_operational_mode(
      '31000000-0000-4000-8000-000000000001','demo',
      '3a000000-0000-4000-8000-000000000001','Intento ficticio de tenant admin'
    );
    raise exception 'tenant admin classified operational mode';
  exception when others then
    if sqlerrm='tenant admin classified operational mode' or sqlerrm not like '%PLATFORM_ADMIN_REQUIRED%'
    then raise;end if;
  end;
  begin
    perform public.set_tenant_operational_mode(
      '31000000-0000-4000-8000-000000000001','live',
      '3c000000-0000-4000-8000-000000000001','Intento live con checklist incompleto'
    );
    raise exception 'incomplete live tenant was enabled';
  exception when others then
    if sqlerrm='incomplete live tenant was enabled' or sqlerrm not like '%LIVE_TENANT_CHECKLIST_INCOMPLETE%'
    then raise;end if;
  end;
end$$;

-- Platform classification evidence is append-only and hidden from tenant RLS.
do $$begin
  if (select count(*) from public.tenant_operational_mode_audit)<>1
  then raise exception 'platform classification audit missing';end if;
  begin
    update public.tenant_operational_mode_audit set reason='Cambio que debe fallar';
    raise exception 'classification audit was mutable';
  exception when others then
    if sqlerrm='classification audit was mutable' or sqlerrm not like '%TENANT_OPERATIONAL_AUDIT_APPEND_ONLY%'
    then raise;end if;
  end;
end$$;
set local app.test_uid='3a000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
  if exists(select 1 from public.tenant_operational_mode_audit)
  then raise exception 'tenant admin read platform classification audit';end if;
end$$;
reset role;
set local app.test_uid='3c000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
  if (select count(*) from public.tenant_operational_mode_audit)<>1
  then raise exception 'platform admin could not read classification audit';end if;
end$$;
reset role;

-- Demo is blocked before persistence tables, provider payment records and DTE.
do $$begin
  begin
    insert into public.appointments(id,tenant_id,status)
    values('32100000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000002','pending');
    raise exception 'demo appointment persisted';
  exception when others then
    if sqlerrm='demo appointment persisted' or sqlerrm not like '%TENANT_MODE_APPOINTMENT_BLOCKED%'
    then raise;end if;
  end;
  begin
    insert into public.payment_intents(id,tenant_id,appointment_id,amount,status)
    values('32200000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000002',
      '32100000-0000-4000-8000-000000000001',1000,'created');
    raise exception 'demo payment intent persisted';
  exception when others then
    if sqlerrm='demo payment intent persisted' or sqlerrm not like '%TENANT_MODE_PAYMENT_BLOCKED%'
    then raise;end if;
  end;
  begin
    insert into public.payments(tenant_id,amount,status,provider)
    values('32000000-0000-4000-8000-000000000002',1000,'pending','fictional');
    raise exception 'demo payment persisted';
  exception when others then
    if sqlerrm='demo payment persisted' or sqlerrm not like '%TENANT_MODE_PAYMENT_BLOCKED%'
    then raise;end if;
  end;
  begin
    insert into public.dte_payment_document_intents(tenant_id,appointment_id,status)
    values('32000000-0000-4000-8000-000000000002',
      '32100000-0000-4000-8000-000000000001','PENDING');
    raise exception 'demo DTE intent persisted';
  exception when others then
    if sqlerrm='demo DTE intent persisted' or sqlerrm not like '%TENANT_MODE_DTE_BLOCKED%'
    then raise;end if;
  end;
  begin
    insert into public.dte_issuance_outbox(tenant_id,intent_id)
    values('32000000-0000-4000-8000-000000000002','32900000-0000-4000-8000-000000000009');
    raise exception 'demo DTE outbox persisted';
  exception when others then
    if sqlerrm='demo DTE outbox persisted' or sqlerrm not like '%TENANT_MODE_DTE_BLOCKED%'
    then raise;end if;
  end;
  if exists(select 1 from public.appointments where tenant_id='32000000-0000-4000-8000-000000000002')
     or exists(select 1 from public.payment_intents where tenant_id='32000000-0000-4000-8000-000000000002')
     or exists(select 1 from public.payments where tenant_id='32000000-0000-4000-8000-000000000002')
     or exists(select 1 from public.dte_payment_document_intents where tenant_id='32000000-0000-4000-8000-000000000002')
     or exists(select 1 from public.dte_issuance_outbox where tenant_id='32000000-0000-4000-8000-000000000002')
  then raise exception 'demo created an operational row';end if;
end$$;

-- Live allows the mode layer through, while archived keeps prior history and
-- rejects the next operation.
insert into public.appointments(id,tenant_id,status)
values('36100000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000006','confirmed');
update public.tenants set lifecycle_status='archived',archived_at=now(),
  archived_by='3c000000-0000-4000-8000-000000000001',
  archive_reason='Archivado ficticio después de crear historial local'
where id='36000000-0000-4000-8000-000000000006';
do $$begin
  if not exists(select 1 from public.appointments where id='36100000-0000-4000-8000-000000000001')
  then raise exception 'archiving removed historical appointment';end if;
  begin
    insert into public.appointments(id,tenant_id,status)
    values('36100000-0000-4000-8000-000000000002','36000000-0000-4000-8000-000000000006','pending');
    raise exception 'archived tenant created a new appointment';
  exception when others then
    if sqlerrm='archived tenant created a new appointment' or sqlerrm not like '%TENANT_MODE_APPOINTMENT_BLOCKED%'
    then raise;end if;
  end;
end$$;

-- No operational mode enables type 39 by itself. Non-live is rejected by 005;
-- incomplete live remains rejected by the pre-existing legal/technical gate.
insert into public.dte_tenant_document_capabilities(
  tenant_id,environment,dte_type,customer_selection_enabled,admin_draft_enabled,
  issuance_enabled,certification_status,updated_at
) values
('31000000-0000-4000-8000-000000000001','production',39,false,false,false,'pre_caf_ready',now()),
('32000000-0000-4000-8000-000000000002','production',39,false,false,false,'pre_caf_ready',now()),
('33000000-0000-4000-8000-000000000003','production',39,false,false,false,'pre_caf_ready',now()),
('34000000-0000-4000-8000-000000000004','production',39,false,false,false,'pre_caf_ready',now());
do $$declare tenant uuid;begin
  foreach tenant in array array[
    '31000000-0000-4000-8000-000000000001'::uuid,
    '32000000-0000-4000-8000-000000000002'::uuid,
    '33000000-0000-4000-8000-000000000003'::uuid,
    '34000000-0000-4000-8000-000000000004'::uuid
  ] loop
    begin
      update public.dte_tenant_document_capabilities set issuance_enabled=true
      where tenant_id=tenant and environment='production' and dte_type=39;
      raise exception 'type 39 enabled through operational mode';
    exception when others then
      if sqlerrm='type 39 enabled through operational mode' then raise;end if;
    end;
  end loop;
  if exists(select 1 from public.dte_tenant_document_capabilities where dte_type=39 and issuance_enabled)
  then raise exception 'type 39 did not remain disabled';end if;
end$$;

rollback;
