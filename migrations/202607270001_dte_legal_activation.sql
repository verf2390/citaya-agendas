begin;

-- Additive cutover migration. It intentionally leaves historical customers
-- without a RUT readable while every new booking/document workflow requires it.

create or replace function public.normalize_chilean_rut(p_value text)
returns text
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  cleaned text;
  body text;
  supplied_dv text;
  expected_dv text;
  digit_sum integer := 0;
  multiplier integer := 2;
  position integer;
  remainder integer;
begin
  cleaned := upper(regexp_replace(trim(p_value), '[^0-9K]', '', 'g'));
  if cleaned !~ '^[0-9]{7,8}[0-9K]$' then
    raise exception 'RUT_INVALID';
  end if;
  body := substring(cleaned from 1 for length(cleaned) - 1);
  supplied_dv := right(cleaned, 1);
  position := length(body);
  while position > 0 loop
    digit_sum := digit_sum + substring(body from position for 1)::integer * multiplier;
    multiplier := case when multiplier = 7 then 2 else multiplier + 1 end;
    position := position - 1;
  end loop;
  remainder := 11 - (digit_sum % 11);
  expected_dv := case
    when remainder = 11 then '0'
    when remainder = 10 then 'K'
    else remainder::text
  end;
  if supplied_dv <> expected_dv then raise exception 'RUT_INVALID'; end if;
  return body::bigint::text || '-' || supplied_dv;
end;
$$;

revoke all on function public.normalize_chilean_rut(text) from public;
grant execute on function public.normalize_chilean_rut(text)
  to authenticated, service_role;

alter table public.customers
  add column if not exists rut_normalized text;

alter table public.customers
  drop constraint if exists customers_rut_normalized_valid;
alter table public.customers
  add constraint customers_rut_normalized_valid
  check (
    rut_normalized is null or
    rut_normalized = public.normalize_chilean_rut(rut_normalized)
  );

create unique index if not exists customers_tenant_rut_unique
  on public.customers(tenant_id, rut_normalized)
  where rut_normalized is not null;

create table if not exists public.customer_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  rut_normalized text not null,
  legal_name text not null check (length(trim(legal_name)) between 2 and 180),
  business_activity text not null
    check (length(trim(business_activity)) between 2 and 180),
  tax_address text not null check (length(trim(tax_address)) between 2 and 180),
  tax_commune text not null check (length(trim(tax_commune)) between 2 and 100),
  tax_city text not null check (length(trim(tax_city)) between 2 and 100),
  tax_email text not null
    check (length(trim(tax_email)) between 3 and 254 and tax_email like '%@%'),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, customer_id),
  unique (tenant_id, rut_normalized),
  check (rut_normalized = public.normalize_chilean_rut(rut_normalized))
);

alter table public.appointments
  add column if not exists customer_rut_snapshot text,
  add column if not exists requested_document_type integer not null default 39
    check (requested_document_type in (33,39));

alter table public.appointments
  drop constraint if exists appointments_customer_rut_snapshot_valid;
alter table public.appointments
  add constraint appointments_customer_rut_snapshot_valid
  check (
    customer_rut_snapshot is null or
    customer_rut_snapshot = public.normalize_chilean_rut(customer_rut_snapshot)
  );

alter table public.dte_payment_document_intents
  alter column appointment_id drop not null,
  add column if not exists customer_id uuid references public.customers(id) on delete restrict,
  add column if not exists origin text not null default 'automatic_payment'
    check (origin in (
      'automatic_payment','manual_appointment','manual_payment','manual_standalone',
      'credit_note','debit_note'
    )),
  add column if not exists operational_reason text,
  add column if not exists immutable_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists original_production_document_id uuid
    references public.dte_production_documents(id) on delete restrict,
  add column if not exists requested_by_role text
    check (requested_by_role is null or requested_by_role in (
      'tenant_admin','platform_admin','system'
    ));

alter table public.dte_payment_document_intents
  drop constraint if exists dte_payment_document_intents_status_check;
alter table public.dte_payment_document_intents
  add constraint dte_payment_document_intents_status_check
  check (status in (
    'PENDING', 'BLOCKED', 'PREPARING', 'READY', 'SUBMITTING', 'SUBMITTED',
    'ACCEPTED', 'ACCEPTED_WITH_OBJECTIONS', 'REJECTED', 'AMBIGUOUS',
    'DELIVERY_PENDING', 'DELIVERED', 'CANCELED'
  ));

alter table public.dte_payment_document_intents
  drop constraint if exists dte_intent_manual_reason_required;
alter table public.dte_payment_document_intents
  add constraint dte_intent_manual_reason_required
  check (
    origin <> 'manual_standalone' or
    length(trim(coalesce(operational_reason, ''))) between 10 and 500
  );

alter table public.dte_payment_document_intents
  drop constraint if exists dte_intent_note_reference_required;
alter table public.dte_payment_document_intents
  add constraint dte_intent_note_reference_required
  check (
    (resolved_dte_type not in (56,61) and
      original_production_document_id is null) or
    (resolved_dte_type in (56,61) and
      original_production_document_id is not null)
  );

create or replace function public.dte_complete_intent_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_row public.appointments%rowtype;
  payment_row public.payment_intents%rowtype;
  issuer jsonb;
  tax_profile jsonb;
  customer_identity jsonb;
  net_amount bigint;
  tax_amount bigint;
  type_authorized boolean;
  type_caf_ready boolean;
begin
  if new.appointment_id is not null then
    select * into appointment_row from public.appointments
     where id=new.appointment_id and tenant_id=new.tenant_id;
    if not found then raise exception 'DTE_APPOINTMENT_TENANT_MISMATCH'; end if;
    new.customer_id := coalesce(new.customer_id, appointment_row.customer_id);
    if (new.trigger_source <> 'manual_admin' or new.origin = 'automatic_payment')
       and new.requested_document = 'consumer' then
      new.resolved_dte_type := coalesce(appointment_row.requested_document_type, 39);
    end if;
  end if;
  if new.payment_intent_id is not null then
    select * into payment_row from public.payment_intents
     where id=new.payment_intent_id and tenant_id=new.tenant_id
       and appointment_id=new.appointment_id and status='succeeded';
    if not found then raise exception 'DTE_PAYMENT_TENANT_MISMATCH'; end if;
  end if;
  if new.customer_id is not null and not exists (
    select 1 from public.customers c
     where c.id=new.customer_id and c.tenant_id=new.tenant_id
  ) then raise exception 'DTE_CUSTOMER_TENANT_MISMATCH'; end if;
  select jsonb_build_object('rut',c.rut_normalized,'legalName',c.full_name,'email',c.email)
    into customer_identity from public.customers c
   where c.id=new.customer_id and c.tenant_id=new.tenant_id;
  new.receiver_snapshot := coalesce(customer_identity,'{}'::jsonb) || new.receiver_snapshot;

  select jsonb_build_object(
    'rut',p.issuer_rut,'legalName',p.issuer_legal_name,
    'activity',p.issuer_activity,'address',p.issuer_address,
    'commune',p.issuer_commune,'city',p.issuer_city
  ) into issuer from public.dte_production_tenant_settings p
   where p.tenant_id=new.tenant_id;
  select jsonb_build_object(
    'rut',t.rut_normalized,'legalName',t.legal_name,
    'activity',t.business_activity,'address',t.tax_address,
    'commune',t.tax_commune,'city',t.tax_city,
    'email',t.tax_email
  ) into tax_profile from public.customer_tax_profiles t
   where t.tenant_id=new.tenant_id and t.customer_id=new.customer_id;
  if new.resolved_dte_type = 33 then
    new.receiver_snapshot := new.receiver_snapshot || coalesce(tax_profile, '{}'::jsonb);
  end if;

  if coalesce(appointment_row.tax_treatment_snapshot,'affected')='exempt' then
    net_amount := 0; tax_amount := 0;
  else
    net_amount := round(new.amount_snapshot / 1.19);
    tax_amount := new.amount_snapshot - net_amount;
  end if;
  new.origin := case when new.trigger_source='manual_admin' then new.origin else 'automatic_payment' end;
  new.requested_by_role := coalesce(new.requested_by_role, case when new.created_by is null then 'system' else 'tenant_admin' end);
  if new.trigger_source <> 'manual_admin' or new.immutable_snapshot = '{}'::jsonb then
    new.immutable_snapshot := jsonb_build_object(
    'tenantId',new.tenant_id,'issuer',coalesce(issuer,'{}'::jsonb),
    'receiver',new.receiver_snapshot,'taxProfile',coalesce(tax_profile,'{}'::jsonb),
    'lines',jsonb_build_array(jsonb_build_object(
      'description',coalesce(appointment_row.service_name,'Emisión manual'),
      'quantity',1,'unitPrice',new.amount_snapshot
    )),
    'taxes',jsonb_build_object(
      'net',net_amount,'exempt',case when net_amount=0 then new.amount_snapshot else 0 end,
      'tax',tax_amount,'total',new.amount_snapshot
    ),
    'payment',case
      when new.payment_intent_id is not null then jsonb_build_object(
        'id',new.payment_intent_id,'amount',payment_row.amount,
        'currency',payment_row.currency,'provider',payment_row.provider,
        'status',payment_row.status
      )
      when new.trigger_source='manual_admin' and appointment_row.payment_status='paid' then jsonb_build_object(
        'id',null,'amount',coalesce(appointment_row.payment_paid_amount,new.amount_snapshot),
        'currency',coalesce(appointment_row.currency,'CLP'),'provider','manual','status','succeeded'
      )
      else null end,
    'appointment',case when new.appointment_id is null then null else jsonb_build_object(
      'id',new.appointment_id,'serviceId',appointment_row.service_id,
      'startAt',appointment_row.start_at
    ) end,
    'customerId',new.customer_id,'documentType',new.resolved_dte_type,
    'requestedBy',new.created_by,'requestedByRole',new.requested_by_role,
      'origin',new.origin,'capturedAt',now()
    );
  end if;

  select exists (
    select 1 from public.dte_sii_authorization_evidence a
     where a.tenant_id=new.tenant_id and a.status='current'
       and new.resolved_dte_type=any(a.authorized_types)
  ) into type_authorized;
  select exists (
    select 1 from public.dte_production_cafs c
     where c.tenant_id=new.tenant_id and c.dte_type=new.resolved_dte_type
       and c.active and c.trust_status='verified_official'
  ) into type_caf_ready;
  if new.resolved_dte_type=39 then
    new.status := 'BLOCKED';
    new.safe_blocking_reason := case
      when not type_authorized then 'BLOCKED_NOT_AUTHORIZED'
      when not type_caf_ready then 'BLOCKED_MISSING_CAF'
      else 'BLOCKED_DOCUMENT_ENGINE_NOT_READY'
    end;
  elsif new.resolved_dte_type is not null and not type_authorized then
    new.status := 'BLOCKED';
    new.safe_blocking_reason := 'DOCUMENT_TYPE_NOT_AUTHORIZED';
  end if;
  return new;
end;
$$;

create or replace function public.dte_enqueue_manual_intent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.dte_issuance_outbox(tenant_id,intent_id,status,last_safe_error)
  values (new.tenant_id,new.id,case when new.status='BLOCKED' then 'BLOCKED' else 'PENDING' end,new.safe_blocking_reason);
  insert into public.dte_document_events(tenant_id,intent_id,event_type,actor_id,safe_metadata)
  values (new.tenant_id,new.id,case when new.status='BLOCKED' then 'MANUAL_ISSUANCE_BLOCKED' else 'MANUAL_ISSUANCE_QUEUED' end,new.created_by,jsonb_build_object('dteType',new.resolved_dte_type,'origin',new.origin,'reason',new.safe_blocking_reason));
  return new;
end;
$$;

drop trigger if exists dte_manual_intent_enqueue on public.dte_payment_document_intents;
create trigger dte_manual_intent_enqueue
after insert on public.dte_payment_document_intents
for each row when (new.trigger_source='manual_admin' and new.origin <> 'automatic_payment')
execute function public.dte_enqueue_manual_intent();

drop trigger if exists dte_intent_complete_snapshot
  on public.dte_payment_document_intents;
create trigger dte_intent_complete_snapshot
before insert on public.dte_payment_document_intents
for each row execute function public.dte_complete_intent_snapshot();

create unique index if not exists dte_one_primary_per_verified_payment
  on public.dte_payment_document_intents(tenant_id, payment_intent_id)
  where payment_intent_id is not null
    and origin in ('automatic_payment','manual_payment');

create index if not exists dte_intents_tenant_customer_idx
  on public.dte_payment_document_intents(tenant_id, customer_id, created_at);
create index if not exists dte_intents_tenant_appointment_idx_v2
  on public.dte_payment_document_intents(tenant_id, appointment_id, created_at);
create index if not exists customer_tax_profiles_tenant_customer_idx
  on public.customer_tax_profiles(tenant_id, customer_id);

create or replace function public.dte_intent_snapshot_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.tenant_id is distinct from new.tenant_id
     or old.appointment_id is distinct from new.appointment_id
     or old.payment_intent_id is distinct from new.payment_intent_id
     or old.customer_id is distinct from new.customer_id
     or old.requested_document is distinct from new.requested_document
     or old.resolved_dte_type is distinct from new.resolved_dte_type
     or old.amount_snapshot is distinct from new.amount_snapshot
     or old.currency is distinct from new.currency
     or old.appointment_snapshot is distinct from new.appointment_snapshot
     or old.receiver_snapshot is distinct from new.receiver_snapshot
     or old.immutable_snapshot is distinct from new.immutable_snapshot
     or old.origin is distinct from new.origin
     or old.operational_reason is distinct from new.operational_reason
     or old.original_production_document_id is distinct from
        new.original_production_document_id
     or old.created_by is distinct from new.created_by then
    raise exception 'DTE_INTENT_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists dte_intent_snapshot_no_update
  on public.dte_payment_document_intents;
create trigger dte_intent_snapshot_no_update
before update on public.dte_payment_document_intents
for each row execute function public.dte_intent_snapshot_immutable();

create table if not exists public.dte_sii_authorization_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  issuer_rut text not null,
  authorization_date date not null,
  authorized_types integer[] not null,
  evidence_source text not null check (length(trim(evidence_source)) between 3 and 300),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  registered_by uuid not null,
  registered_at timestamptz not null default now(),
  observation text not null default '' check (length(observation) <= 1000),
  status text not null default 'current' check (status in ('current','revoked')),
  revoked_by uuid,
  revoked_at timestamptz,
  revocation_reason text,
  check (issuer_rut = public.normalize_chilean_rut(issuer_rut)),
  check (
    cardinality(authorized_types) > 0 and
    authorized_types <@ array[33,39,56,61]::integer[]
  ),
  check (
    (status = 'current' and revoked_by is null and revoked_at is null) or
    (status = 'revoked' and revoked_by is not null and revoked_at is not null
      and length(trim(coalesce(revocation_reason, ''))) >= 10)
  ),
  unique (tenant_id, evidence_fingerprint)
);

create unique index if not exists dte_one_current_authorization_evidence
  on public.dte_sii_authorization_evidence(tenant_id)
  where status = 'current';

create table if not exists public.dte_legal_activation (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  dte_type integer not null check (dte_type in (33,39,56,61)),
  status text not null default 'inactive'
    check (status in ('inactive','active','paused')),
  activated_by uuid,
  activated_at timestamptz,
  paused_by uuid,
  paused_at timestamptz,
  pause_reason text,
  gate_snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, dte_type),
  check (
    status <> 'active' or
    (activated_by is not null and activated_at is not null)
  )
);

create table if not exists public.dte_legal_activation_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  dte_type integer not null check (dte_type in (33,39,56,61)),
  event_type text not null check (event_type in (
    'AUTHORIZATION_RECORDED','AUTHORIZATION_REVOKED',
    'LEGAL_ISSUANCE_ACTIVATED','LEGAL_ISSUANCE_PAUSED'
  )),
  actor_id uuid not null,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.dte_legal_activation_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'DTE_LEGAL_ACTIVATION_EVENTS_APPEND_ONLY';
end;
$$;

drop trigger if exists dte_legal_activation_events_no_mutation
  on public.dte_legal_activation_events;
create trigger dte_legal_activation_events_no_mutation
before update or delete on public.dte_legal_activation_events
for each row execute function public.dte_legal_activation_events_append_only();

alter table public.dte_tenant_readiness_evidence
  add column if not exists issuer_legal_name_match boolean not null default false,
  add column if not exists official_xsd_valid boolean not null default false,
  add column if not exists xmldsig_valid boolean not null default false,
  add column if not exists production_endpoints_valid boolean not null default false,
  add column if not exists migrations_applied boolean not null default false,
  add column if not exists offline_preflight_complete boolean not null default false;

create or replace function public.dte_register_sii_authorization(
  p_tenant_id uuid,
  p_issuer_rut text,
  p_authorization_date date,
  p_authorized_types integer[],
  p_evidence_source text,
  p_evidence_fingerprint text,
  p_observation text default '',
  p_actor_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  evidence_id uuid;
  normalized_rut text;
  profile_rut text;
begin
  if p_actor_id is null or not public.is_platform_admin(p_actor_id) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  normalized_rut := public.normalize_chilean_rut(p_issuer_rut);
  select public.normalize_chilean_rut(issuer_rut) into profile_rut
    from public.dte_production_tenant_settings
   where tenant_id = p_tenant_id;
  if profile_rut is null or profile_rut <> normalized_rut then
    raise exception 'ISSUER_RUT_MISMATCH';
  end if;
  if p_authorization_date > current_date
     or cardinality(p_authorized_types) = 0
     or not (p_authorized_types <@ array[33,39,56,61]::integer[])
     or p_evidence_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'AUTHORIZATION_EVIDENCE_INVALID';
  end if;
  update public.dte_sii_authorization_evidence
     set status = 'revoked',
         revoked_by = p_actor_id,
         revoked_at = now(),
         revocation_reason = 'Reemplazada por evidencia posterior vigente'
   where tenant_id = p_tenant_id and status = 'current';
  insert into public.dte_sii_authorization_evidence(
    tenant_id, issuer_rut, authorization_date, authorized_types,
    evidence_source, evidence_fingerprint, registered_by, observation
  ) values (
    p_tenant_id, normalized_rut, p_authorization_date,
    (select array_agg(distinct value order by value)
       from unnest(p_authorized_types) value),
    trim(p_evidence_source), p_evidence_fingerprint, p_actor_id,
    trim(coalesce(p_observation, ''))
  ) returning id into evidence_id;
  update public.dte_production_tenant_settings
     set issuer_profile_state = 'declared', updated_at = now()
   where tenant_id = p_tenant_id and issuer_profile_state = 'pre_declaration';
  update public.dte_tenant_issuance_settings
     set sii_authorization_status = case when 33 = any(p_authorized_types) then 'approved' else sii_authorization_status end,
         updated_at = now()
   where tenant_id = p_tenant_id;
  insert into public.dte_legal_activation_events(
    tenant_id, dte_type, event_type, actor_id, safe_metadata
  )
  select p_tenant_id, value, 'AUTHORIZATION_RECORDED', p_actor_id,
         jsonb_build_object('evidenceFingerprint', p_evidence_fingerprint)
    from unnest(p_authorized_types) value;
  return evidence_id;
end;
$$;

create or replace function public.dte_activation_gate_report(
  p_tenant_id uuid,
  p_dte_type integer,
  p_global_feature_enabled boolean
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with facts as (
    select
      p.tenant_id,
      p.issuer_rut,
      p.issuer_legal_name,
      b.legal_name as billing_legal_name,
      p.certificate_valid_from,
      p.certificate_valid_to,
      e.*,
      coalesce(i.certificate_ready, false) as certificate_ready,
      coalesce(i.storage_ready, false) as storage_ready,
      coalesce(i.worker_ready, false) as worker_ready,
      exists (
        select 1 from public.dte_sii_authorization_evidence a
         where a.tenant_id = p_tenant_id and a.status = 'current'
           and p_dte_type = any(a.authorized_types)
           and a.issuer_rut = public.normalize_chilean_rut(p.issuer_rut)
      ) as type_authorized,
      exists (
        select 1 from public.dte_production_cafs c
         where c.tenant_id = p_tenant_id and c.dte_type = p_dte_type
           and c.active and c.trust_status = 'verified_official'
      ) as authentic_caf,
      exists (
        select 1 from public.dte_production_folio_ledger l
         where l.tenant_id = p_tenant_id and l.dte_type = p_dte_type
           and l.state = 'available'
      ) as folios_available,
      exists (
        select 1 from storage.buckets s
         where s.id = 'dte-production-private' and s.public = false
      ) as private_storage
    from public.dte_production_tenant_settings p
    left join public.tenant_billing_settings b on b.tenant_id = p.tenant_id
    left join public.dte_tenant_issuance_settings i on i.tenant_id = p.tenant_id
    left join public.dte_tenant_readiness_evidence e on e.tenant_id = p.tenant_id
    where p.tenant_id = p_tenant_id
  ), gates as (
    select jsonb_build_object(
      'issuerDataExact', issuer_profile_complete,
      'issuerLegalNameMatch',
        issuer_legal_name_match and trim(issuer_legal_name) = trim(billing_legal_name),
      'typeAuthorized', type_authorized,
      'certificateCurrent',
        certificate_ready and certificate_valid and
        certificate_valid_from <= now() and certificate_valid_to > now(),
      'certificateKeyMatch', private_key_matches_certificate,
      'certificateRutMatch', certificate_rut_match,
      'officialTrustAnchor',
        trust_anchor_valid and trust_anchor_sha256 is not null,
      'authenticTypeCaf', authentic_caf,
      'foliosAvailable', folios_available,
      'tenantAwareLedger', ledger_ready and tenant_isolation_valid,
      'privateStorage', storage_ready and private_storage,
      'productionEndpoints', production_endpoints_valid,
      'officialXsd', official_xsd_valid,
      'xmlDsig', xmldsig_valid,
      'workerConfigured', worker_ready and worker_tenant_aware,
      'migrationsApplied', migrations_applied,
      'offlinePreflightComplete', offline_preflight_complete,
      'documentEngineReady', p_dte_type in (33,56,61),
      'globalFeatureEnabled', p_global_feature_enabled
    ) as value from facts
  )
  select coalesce(
    value || jsonb_build_object(
      'ready', not exists (
        select 1 from jsonb_each(value) entry where entry.value <> 'true'::jsonb
      )
    ),
    jsonb_build_object('ready', false, 'tenantConfigured', false)
  )
  from gates;
$$;

create or replace function public.dte_activate_legal_issuance(
  p_tenant_id uuid,
  p_dte_type integer,
  p_global_feature_enabled boolean,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gates jsonb;
begin
  if p_actor_id is null or not public.is_platform_admin(p_actor_id) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if p_dte_type not in (33,39,56,61) then raise exception 'DTE_TYPE_INVALID'; end if;
  gates := public.dte_activation_gate_report(
    p_tenant_id, p_dte_type, p_global_feature_enabled
  );
  if coalesce((gates->>'ready')::boolean, false) = false then
    raise exception 'DTE_ACTIVATION_GATES_INCOMPLETE';
  end if;
  insert into public.dte_legal_activation(
    tenant_id,dte_type,status,activated_by,activated_at,gate_snapshot,updated_at
  ) values (
    p_tenant_id,p_dte_type,'active',p_actor_id,now(),gates,now()
  )
  on conflict (tenant_id,dte_type) do update
     set status='active',activated_by=p_actor_id,activated_at=now(),
         paused_by=null,paused_at=null,pause_reason=null,
         gate_snapshot=excluded.gate_snapshot,updated_at=now();
  update public.dte_production_tenant_settings
     set enabled=true, issuer_profile_state='ready_for_issuance', updated_at=now()
   where tenant_id=p_tenant_id;
  update public.dte_tenant_issuance_settings
     set production_enabled=true, updated_at=now()
   where tenant_id=p_tenant_id;
  insert into public.dte_legal_activation_events(
    tenant_id,dte_type,event_type,actor_id,safe_metadata
  ) values (
    p_tenant_id,p_dte_type,'LEGAL_ISSUANCE_ACTIVATED',p_actor_id,gates
  );
  return gates;
end;
$$;

create or replace function public.dte_pause_legal_issuance(
  p_tenant_id uuid,
  p_dte_type integer,
  p_reason text,
  p_actor_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_actor_id is null or not public.is_platform_admin(p_actor_id) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if length(trim(coalesce(p_reason,''))) < 10 then
    raise exception 'DTE_PAUSE_REASON_REQUIRED';
  end if;
  update public.dte_legal_activation
     set status='paused',paused_by=p_actor_id,paused_at=now(),
         pause_reason=left(trim(p_reason),500),updated_at=now()
   where tenant_id=p_tenant_id and dte_type=p_dte_type and status='active';
  if not found then raise exception 'DTE_ACTIVE_CONFIGURATION_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.dte_legal_activation
     where tenant_id=p_tenant_id and status='active'
  ) then
    update public.dte_production_tenant_settings
       set enabled=false,updated_at=now() where tenant_id=p_tenant_id;
    update public.dte_tenant_issuance_settings
       set production_enabled=false,issuance_mode='manual',updated_at=now()
     where tenant_id=p_tenant_id;
  end if;
  insert into public.dte_legal_activation_events(
    tenant_id,dte_type,event_type,actor_id,safe_metadata
  ) values (
    p_tenant_id,p_dte_type,'LEGAL_ISSUANCE_PAUSED',p_actor_id,
    jsonb_build_object('reason',left(trim(p_reason),500))
  );
end;
$$;



create or replace function public.dte_revoke_sii_authorization(
  p_tenant_id uuid,
  p_reason text,
  p_actor_id uuid default null
) returns integer[]
language plpgsql
security definer
set search_path = public
as $$
declare revoked_types integer[];
begin
  if p_actor_id is null or not public.is_platform_admin(p_actor_id) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'AUTHORIZATION_REVOCATION_REASON_REQUIRED';
  end if;
  update public.dte_sii_authorization_evidence
     set status='revoked', revoked_by=p_actor_id, revoked_at=now(),
         revocation_reason=left(trim(p_reason),500)
   where tenant_id=p_tenant_id and status='current'
   returning authorized_types into revoked_types;
  if revoked_types is null then raise exception 'CURRENT_AUTHORIZATION_NOT_FOUND'; end if;
  update public.dte_legal_activation
     set status='paused',paused_by=p_actor_id,paused_at=now(),
         pause_reason=left(trim(p_reason),500),updated_at=now()
   where tenant_id=p_tenant_id and status='active';
  update public.dte_production_tenant_settings
     set enabled=false,issuer_profile_state='suspended',updated_at=now()
   where tenant_id=p_tenant_id;
  update public.dte_tenant_issuance_settings
     set production_enabled=false,issuance_mode='manual',
         sii_authorization_status='suspended',updated_at=now()
   where tenant_id=p_tenant_id;
  insert into public.dte_legal_activation_events(
    tenant_id,dte_type,event_type,actor_id,safe_metadata
  )
  select p_tenant_id,value,'AUTHORIZATION_REVOKED',p_actor_id,
         jsonb_build_object('reason',left(trim(p_reason),500))
    from unnest(revoked_types) value;
  return revoked_types;
end;
$$;

create or replace function public.dte_reconcile_intent_status(
  p_tenant_id uuid,
  p_production_document_id uuid,
  p_status text,
  p_sii_status text,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare intent_id uuid;
begin
  if p_status not in ('SUBMITTED', 'ACCEPTED', 'ACCEPTED_WITH_OBJECTIONS', 'REJECTED') then
    raise exception 'DTE_RECONCILIATION_STATUS_INVALID';
  end if;
  update public.dte_payment_document_intents
     set status=p_status,
         safe_blocking_reason=case when p_status='REJECTED' then 'SII_EXPLICIT_REJECTION' else null end,
         updated_at=now()
   where tenant_id=p_tenant_id and production_document_id=p_production_document_id
     and status in ('SUBMITTING', 'SUBMITTED', 'AMBIGUOUS')
   returning id into intent_id;
  if intent_id is null then
    select id into intent_id from public.dte_payment_document_intents
     where tenant_id=p_tenant_id and production_document_id=p_production_document_id
       and status=p_status;
    if intent_id is null then raise exception 'DTE_INTENT_NOT_FOUND'; end if;
    return intent_id;
  end if;
  insert into public.dte_document_events(
    tenant_id,intent_id,production_document_id,event_type,actor_id,safe_metadata
  ) values (
    p_tenant_id,intent_id,p_production_document_id,'MANUAL_STATUS_RECONCILED',p_actor_id,
    jsonb_build_object('intentStatus',p_status,'siiStatus',left(p_sii_status,32))
  );
  return intent_id;
end;
$$;

alter table public.customer_tax_profiles enable row level security;
alter table public.dte_sii_authorization_evidence enable row level security;
alter table public.dte_legal_activation enable row level security;
alter table public.dte_legal_activation_events enable row level security;

drop policy if exists customer_tax_profiles_tenant_admin
  on public.customer_tax_profiles;
create policy customer_tax_profiles_tenant_admin
  on public.customer_tax_profiles for all to authenticated
  using (
    public.is_tenant_member(tenant_id) or public.is_platform_admin()
  )
  with check (
    public.is_tenant_member(tenant_id) or public.is_platform_admin()
  );

drop policy if exists dte_authorization_platform_admin_read
  on public.dte_sii_authorization_evidence;
create policy dte_authorization_platform_admin_read
  on public.dte_sii_authorization_evidence for select to authenticated
  using (
    public.is_tenant_member(tenant_id) or public.is_platform_admin()
  );

drop policy if exists dte_legal_activation_admin_read
  on public.dte_legal_activation;
create policy dte_legal_activation_admin_read
  on public.dte_legal_activation for select to authenticated
  using (
    public.is_tenant_member(tenant_id) or public.is_platform_admin()
  );

drop policy if exists dte_legal_activation_events_admin_read
  on public.dte_legal_activation_events;
create policy dte_legal_activation_events_admin_read
  on public.dte_legal_activation_events for select to authenticated
  using (
    public.is_tenant_member(tenant_id) or public.is_platform_admin()
  );

revoke all on public.customer_tax_profiles from public, anon;
revoke all on public.dte_sii_authorization_evidence from public, anon, authenticated;
revoke all on public.dte_legal_activation from public, anon, authenticated;
revoke all on public.dte_legal_activation_events from public, anon, authenticated;
grant select,insert,update on public.customer_tax_profiles to authenticated;
grant select on public.dte_sii_authorization_evidence to authenticated;
grant select on public.dte_legal_activation to authenticated;
grant select on public.dte_legal_activation_events to authenticated;

revoke all on function public.dte_complete_intent_snapshot() from public,anon,authenticated;
revoke all on function public.dte_enqueue_manual_intent() from public,anon,authenticated;
revoke all on function public.dte_register_sii_authorization(
  uuid,text,date,integer[],text,text,text,uuid
) from public,anon,authenticated;
revoke all on function public.dte_activation_gate_report(
  uuid,integer,boolean
) from public,anon,authenticated;
revoke all on function public.dte_activate_legal_issuance(
  uuid,integer,boolean,uuid
) from public,anon,authenticated;
revoke all on function public.dte_pause_legal_issuance(
  uuid,integer,text,uuid
) from public,anon,authenticated;
revoke all on function public.dte_revoke_sii_authorization(
  uuid,text,uuid
) from public,anon,authenticated;
revoke all on function public.dte_reconcile_intent_status(
  uuid,uuid,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.dte_register_sii_authorization(
  uuid,text,date,integer[],text,text,text,uuid
) to service_role;
grant execute on function public.dte_activation_gate_report(
  uuid,integer,boolean
) to service_role;
grant execute on function public.dte_activate_legal_issuance(
  uuid,integer,boolean,uuid
) to service_role;
grant execute on function public.dte_pause_legal_issuance(
  uuid,integer,text,uuid
) to service_role;
grant execute on function public.dte_revoke_sii_authorization(
  uuid,text,uuid
) to service_role;
grant execute on function public.dte_reconcile_intent_status(
  uuid,uuid,text,text,uuid
) to service_role;

comment on table public.customer_tax_profiles is
  'Tenant-isolated optional customer tax identity. Historical customers may have no row.';
comment on table public.dte_sii_authorization_evidence is
  'Platform-admin reconciled authorization evidence. Fingerprints only; never trust material.';
comment on table public.dte_legal_activation is
  'Per-tenant/per-type reversible legal activation. Defaults inactive and never deletes evidence.';
comment on column public.dte_payment_document_intents.immutable_snapshot is
  'Immutable issuer, receiver, lines, taxes, totals, payment, appointment, tenant and actor facts.';

commit;
