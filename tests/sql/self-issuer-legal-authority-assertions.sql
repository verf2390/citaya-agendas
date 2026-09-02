-- Fictional identifiers only. The surrounding bootstrap transaction rolls
-- back this migration and every fixture/assertion.

insert into public.tenants(id,slug,name,address,contact_email) values
('61000000-0000-4000-8000-000000000001','self-internal','Emisor interno ficticio','Dirección ficticia 101','legal@example.invalid'),
('62000000-0000-4000-8000-000000000002','self-demo','Tenant demo ficticio','Dirección ficticia 102','demo@example.invalid'),
('63000000-0000-4000-8000-000000000003','self-live','Tenant live ficticio','Dirección ficticia 103','live@example.invalid'),
('64000000-0000-4000-8000-000000000004','self-unclassified','Tenant sin clasificar ficticio','Dirección ficticia 104','none@example.invalid'),
('65000000-0000-4000-8000-000000000005','self-archived','Tenant archivado ficticio','Dirección ficticia 105','archived@example.invalid'),
('66000000-0000-4000-8000-000000000006','external-mandate','Tenant externo ficticio','Dirección ficticia 106','external@example.invalid');

update public.tenants set operational_mode='internal' where slug='self-internal';
update public.tenants set operational_mode='demo' where slug='self-demo';
update public.tenants set operational_mode='live' where slug in ('self-live','external-mandate');
update public.tenants set lifecycle_status='archived',archived_at=now(),
  archived_by='6a000000-0000-4000-8000-000000000001',
  archive_reason='Archivado ficticio para prueba local de autoridad'
where slug='self-archived';

insert into public.platform_admins(user_id,role,is_active) values
('6a000000-0000-4000-8000-000000000001','super_admin',true),
('6a000000-0000-4000-8000-000000000002','super_admin',false);
insert into public.tenant_members(tenant_id,user_id,role,is_active)
values('66000000-0000-4000-8000-000000000006','6b000000-0000-4000-8000-000000000001','owner',true);

insert into public.tenant_legal_profiles(
  tenant_id,trade_name,contact_address,support_email,privacy_contact_name,
  privacy_contact_email,tenant_is_service_provider,handles_sensitive_data,
  sensitive_data_purpose,administrative_review_status
)
select id,name,address,contact_email,'Contacto de privacidad ficticio',contact_email,
  true,false,null,'draft'
from public.tenants
where slug in ('self-internal','self-demo','self-live','self-unclassified','self-archived','external-mandate');

insert into public.dte_production_tenant_settings(
  tenant_id,issuer_legal_name,issuer_rut,issuer_activity,issuer_activity_code,
  issuer_address,issuer_commune,issuer_city
)
select id,name,'78.195.645-7','Servicios ficticios','620900',address,'Comuna ficticia','Ciudad ficticia'
from public.tenants
where slug in ('self-internal','self-demo','self-live','self-unclassified','self-archived','external-mandate');

insert into public.dte_tenant_issuance_settings(tenant_id,production_enabled,issuance_mode,updated_at)
values('61000000-0000-4000-8000-000000000001',false,'manual',now());
insert into public.dte_tenant_document_capabilities(
  tenant_id,environment,dte_type,customer_selection_enabled,admin_draft_enabled,
  issuance_enabled,certification_status,endpoint_profile,schema_version,updated_at
) values(
  '61000000-0000-4000-8000-000000000001','certification',39,false,true,false,
  'pre_caf_ready','boleta_rest_certification','EnvioBOLETA_v11',now()
);

-- Existing technical false must remain pending; it cannot satisfy the legal
-- sensitive-data review or the full legal gate.
do $$declare gate jsonb;begin
  if (select sensitive_data_review_status from public.tenant_legal_profiles
      where tenant_id='61000000-0000-4000-8000-000000000001')<>'pending' then
    raise exception 'new sensitive review did not default pending';
  end if;
  gate:=public.tenant_legal_gate_report('61000000-0000-4000-8000-000000000001');
  if (gate->>'sensitiveDataReviewStatus')<>'pending'
     or (gate->>'sensitiveDataReviewed')::boolean
     or (gate->>'sensitiveConsentConfigured')::boolean
     or (gate->>'ready')::boolean then
    raise exception 'pending sensitive review was interpreted as reviewed false';
  end if;
end$$;

-- The existing normalizer validates DV while accepting formatted and compact
-- representations without changing the persisted master value.
do $$begin
  if public.normalize_chilean_rut('78.195.645-7')<>'78195645-7'
     or public.normalize_chilean_rut(' 78195645 7 ')<>'78195645-7'
     or not public.is_valid_chilean_rut('78.195.645-7') then
    raise exception 'formatted RUT normalization mismatch';
  end if;
  begin
    perform public.normalize_chilean_rut('78.195.645-8');
    raise exception 'invalid RUT accepted';
  exception when others then
    if sqlerrm='invalid RUT accepted' or sqlerrm not like '%RUT_INVALID%' then raise;end if;
  end;
end$$;

-- Draft hashes are deterministic through extensions.digest. Pending markers
-- and published-document immutability remain fail-closed.
insert into public.legal_documents(
  id,owner_kind,tenant_id,document_type,version,title,content,content_sha256,status
) values(
  '67000000-0000-4000-8000-000000000001','tenant',
  '61000000-0000-4000-8000-000000000001','consumer_terms',1,
  'Documento ficticio pendiente',
  'Contenido ficticio suficientemente extenso. [PENDIENTE: revisión legal antes de publicar].',
  repeat('0',64),'draft'
);
do $$declare expected text;begin
  expected:=encode(extensions.digest(convert_to(
    'Contenido ficticio suficientemente extenso. [PENDIENTE: revisión legal antes de publicar].','UTF8'),'sha256'),'hex');
  if (select content_sha256 from public.legal_documents
      where id='67000000-0000-4000-8000-000000000001')<>expected then
    raise exception 'legal document SHA-256 mismatch';
  end if;
  begin
    update public.legal_documents set status='published'
    where id='67000000-0000-4000-8000-000000000001';
    raise exception 'pending legal document published';
  exception when others then
    if sqlerrm='pending legal document published' or sqlerrm not like '%LEGAL_DOCUMENT_HAS_PENDING_FIELDS%'
    then raise;end if;
  end;
end$$;

-- Matching internal identity can be granted exactly once. A retry with the
-- same administrative reference returns the same authority.
do $$declare first_id uuid;replay_id uuid;report jsonb;readiness jsonb;begin
  first_id:=public.register_tenant_self_issuer_authority(
    '61000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000001',
    '78.195.645-7','Preparación ficticia para certificación local','REF-SELF-ISSUER-LOCAL-001');
  replay_id:=public.register_tenant_self_issuer_authority(
    '61000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000001',
    '78195645-7','Preparación ficticia para certificación local','REF-SELF-ISSUER-LOCAL-001');
  if first_id<>replay_id or (select count(*) from public.tenant_self_issuer_authority_events
      where tenant_id='61000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'self issuer idempotency failed';
  end if;
  report:=public.tenant_self_issuer_authority_report('61000000-0000-4000-8000-000000000001');
  if not (report->>'valid')::boolean or (report->>'status')<>'active'
     or not (report->>'rutMatches')::boolean then
    raise exception 'matching internal self issuer was not valid';
  end if;
  readiness:=public.dte_type39_enablement_gate_report('61000000-0000-4000-8000-000000000001');
  if not (readiness->>'certificationReady')::boolean
     or (readiness->>'productionIssuanceReady')::boolean
     or (readiness->>'ready')::boolean then
    raise exception 'certification and production readiness were not separated';
  end if;
end$$;

-- Different identity, inactive administrators, and every non-internal mode
-- are rejected even when all other fixture fields are populated.
do $$declare tenant_id uuid;begin
  begin
    perform public.register_tenant_self_issuer_authority(
      '61000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000001',
      '76.123.456-0','Intento ficticio con identidad distinta','REF-MISMATCH-001');
    raise exception 'different RUT received self issuer authority';
  exception when others then
    if sqlerrm='different RUT received self issuer authority'
       or sqlerrm not like '%SELF_ISSUER_TAX_IDENTITY_MISMATCH%' then raise;end if;
  end;
  begin
    perform public.register_tenant_self_issuer_authority(
      '61000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000002',
      '78.195.645-7','Intento ficticio por administrador inactivo','REF-INACTIVE-001');
    raise exception 'inactive platform admin granted self issuer';
  exception when others then
    if sqlerrm='inactive platform admin granted self issuer'
       or sqlerrm not like '%PLATFORM_ADMIN_REQUIRED%' then raise;end if;
  end;
  foreach tenant_id in array array[
    '62000000-0000-4000-8000-000000000002'::uuid,
    '63000000-0000-4000-8000-000000000003'::uuid,
    '64000000-0000-4000-8000-000000000004'::uuid,
    '65000000-0000-4000-8000-000000000005'::uuid
  ] loop
    begin
      perform public.register_tenant_self_issuer_authority(
        tenant_id,'6a000000-0000-4000-8000-000000000001','78.195.645-7',
        'Intento ficticio para modo no autorizado','REF-MODE-'||tenant_id::text);
      raise exception 'non-internal tenant received self issuer authority';
    exception when others then
      if sqlerrm='non-internal tenant received self issuer authority'
         or sqlerrm not like '%SELF_ISSUER_TENANT_NOT_INTERNAL_ACTIVE%' then raise;end if;
    end;
  end loop;
end$$;

-- A later master identity change invalidates the evidence without mutating its
-- snapshot; restoring the exact identity makes the unchanged evidence valid.
do $$declare report jsonb;begin
  update public.dte_production_tenant_settings set issuer_rut='76.123.456-0'
  where tenant_id='61000000-0000-4000-8000-000000000001';
  report:=public.tenant_self_issuer_authority_report('61000000-0000-4000-8000-000000000001');
  if (report->>'valid')::boolean or (report->>'status')<>'invalidated'
     or (report->>'rutMatches')::boolean then
    raise exception 'changed master RUT did not invalidate self issuer';
  end if;
  update public.dte_production_tenant_settings set issuer_rut='78.195.645-7'
  where tenant_id='61000000-0000-4000-8000-000000000001';
  if not (public.tenant_self_issuer_authority_report(
      '61000000-0000-4000-8000-000000000001')->>'valid')::boolean then
    raise exception 'restored master identity did not restore evidence match';
  end if;
  update public.dte_production_tenant_settings set issuer_rut='76.123.456-0'
  where tenant_id='61000000-0000-4000-8000-000000000001';
end$$;

-- Revocation is append-only, idempotent, preserves the grant, and immediately
-- invalidates authority and certification readiness.
do $$declare first_revoke uuid;replay_revoke uuid;report jsonb;readiness jsonb;begin
  first_revoke:=public.revoke_tenant_self_issuer_authority(
    '61000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000001',
    'Revocación ficticia para comprobar historia','REF-REVOKE-LOCAL-001');
  replay_revoke:=public.revoke_tenant_self_issuer_authority(
    '61000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000001',
    'Revocación ficticia para comprobar historia','REF-REVOKE-LOCAL-001');
  update public.dte_production_tenant_settings set issuer_rut='78.195.645-7'
  where tenant_id='61000000-0000-4000-8000-000000000001';
  if first_revoke<>replay_revoke or (select count(*) from public.tenant_self_issuer_authority_events
      where tenant_id='61000000-0000-4000-8000-000000000001')<>2 then
    raise exception 'self issuer revocation was not idempotent';
  end if;
  report:=public.tenant_self_issuer_authority_report('61000000-0000-4000-8000-000000000001');
  readiness:=public.dte_type39_enablement_gate_report('61000000-0000-4000-8000-000000000001');
  if (report->>'valid')::boolean or (report->>'status')<>'revoked'
     or (readiness->>'certificationReady')::boolean then
    raise exception 'revocation did not invalidate gates';
  end if;
  begin
    update public.tenant_self_issuer_authority_events set reason='Cambio prohibido'
    where id=first_revoke;
    raise exception 'self issuer history was mutable';
  exception when others then
    if sqlerrm='self issuer history was mutable'
       or sqlerrm not like '%SELF_ISSUER_AUTHORITY_APPEND_ONLY%' then raise;end if;
  end;
end$$;

-- An external tenant cannot use self-issued authority and remains blocked until
-- it has a real tenant mandate. The same mandate is rejected for internal.
insert into public.legal_documents(
  id,owner_kind,tenant_id,document_type,version,title,content,content_sha256,status
) values(
  '67000000-0000-4000-8000-000000000002','platform',null,'dte_mandate',1,
  'Mandato externo ficticio','Documento contractual ficticio completo para probar mandato de un tenant externo.',
  repeat('0',64),'published'
);
do $$declare authority jsonb;begin
  authority:=public.tenant_dte_authority_report('66000000-0000-4000-8000-000000000006');
  if (authority->>'ready')::boolean then raise exception 'external tenant bypassed mandate';end if;
  perform public.accept_tenant_dte_mandate(
    '66000000-0000-4000-8000-000000000006','67000000-0000-4000-8000-000000000002',
    '6b000000-0000-4000-8000-000000000001','Representante Ficticio','78.195.645-7',
    'Representante ficticio',true,'Declaración ficticia con facultades suficientes para prueba local',null,'test-agent');
  authority:=public.tenant_dte_authority_report('66000000-0000-4000-8000-000000000006');
  if not (authority->>'ready')::boolean or (authority->>'kind')<>'tenant_mandate'
  then raise exception 'external mandate did not satisfy authority';end if;
  begin
    perform public.accept_tenant_dte_mandate(
      '61000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002',
      '6b000000-0000-4000-8000-000000000001','Representante Ficticio','78.195.645-7',
      'Representante ficticio',true,'Intento ficticio de mandato interno que debe fallar',null,'test-agent');
    raise exception 'internal tenant accepted external mandate';
  exception when others then
    if sqlerrm='internal tenant accepted external mandate'
       or sqlerrm not like '%DTE_MANDATE_EXTERNAL_TENANT_REQUIRED%' then raise;end if;
  end;
end$$;

-- Tenant administrators cannot directly read platform self-issuer evidence;
-- an active platform admin can. The service functions remain backend-only.
set local app.test_uid='6b000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
  if exists(select 1 from public.tenant_self_issuer_authority_events)
  then raise exception 'tenant admin read self issuer evidence';end if;
end$$;
reset role;
set local app.test_uid='6a000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
  if (select count(*) from public.tenant_self_issuer_authority_events)<>2
  then raise exception 'platform admin could not read self issuer evidence';end if;
end$$;
reset role;

-- No operational or tax artifact is created by authority and gate checks.
do $$begin
  if exists(select 1 from public.dte_production_documents)
     or exists(select 1 from public.dte_production_cafs)
     or exists(select 1 from public.dte_production_folio_ledger)
     or exists(select 1 from public.dte_issuance_outbox)
     or exists(select 1 from public.dte_payment_document_intents)
     or exists(select 1 from public.dte_tenant_document_capabilities where issuance_enabled)
  then raise exception 'self issuer test created DTE, folio, outbox or enabled issuance';end if;
end$$;

rollback;
