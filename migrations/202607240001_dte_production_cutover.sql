begin;

create table if not exists public.dte_production_tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  enabled boolean not null default false,
  issuer_rut text not null,
  issuer_legal_name text not null,
  issuer_activity text not null,
  issuer_activity_code text,
  issuer_address text not null,
  issuer_commune text not null,
  issuer_city text not null,
  resolution_date date not null,
  resolution_number text not null,
  sii_office text not null,
  sender_rut text not null,
  certificate_secret_ref text not null,
  certificate_valid_from timestamptz not null,
  certificate_valid_to timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.dte_production_cafs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  dte_type integer not null check (dte_type in (33, 56, 61)),
  issuer_rut text not null,
  range_from integer not null check (range_from > 0),
  range_to integer not null check (range_to >= range_from),
  authorization_date date not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  logical_identity text not null check (logical_identity ~ '^[a-f0-9]{64}$'),
  secure_ref text not null,
  trust_status text not null check (trust_status = 'verified_official'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, sha256),
  unique (tenant_id, logical_identity),
  unique (tenant_id, dte_type, range_from, range_to)
);

create extension if not exists btree_gist;
alter table public.dte_production_cafs
  drop constraint if exists dte_production_cafs_no_overlap;
alter table public.dte_production_cafs
  add constraint dte_production_cafs_no_overlap
  exclude using gist (
    tenant_id with =,
    dte_type with =,
    int4range(range_from, range_to, '[]') with &&
  ) where (active);

create table if not exists public.dte_production_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  dte_type integer not null check (dte_type in (33, 56, 61)),
  business_operation_id text not null,
  status text not null default 'draft'
    check (status in ('draft','prepared','ready','submitting','submitted','rejected','ambiguous')),
  folio integer,
  caf_id uuid references public.dte_production_cafs(id) on delete restrict,
  recipient jsonb not null,
  lines jsonb not null,
  document_references jsonb not null default '[]'::jsonb,
  net_amount bigint not null check (net_amount >= 0),
  exempt_amount bigint not null check (exempt_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  total_amount bigint not null check (total_amount = net_amount + exempt_amount + tax_amount),
  issue_date date not null,
  track_id_ciphertext text,
  track_id_fingerprint text,
  sii_status text,
  final_response_sha256 text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, business_operation_id),
  unique (tenant_id, dte_type, folio)
);

create table if not exists public.dte_production_folio_ledger (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  dte_type integer not null check (dte_type in (33, 56, 61)),
  folio integer not null check (folio > 0),
  caf_id uuid not null references public.dte_production_cafs(id) on delete restrict,
  state text not null check (state in ('available','reserved','issued','void','contingency')),
  document_id uuid references public.dte_production_documents(id) on delete restrict,
  business_operation_id text,
  reserved_at timestamptz,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, dte_type, folio),
  check (state <> 'issued' or (document_id is not null and issued_at is not null))
);

create unique index if not exists dte_production_folio_business_operation_unique
  on public.dte_production_folio_ledger(tenant_id, business_operation_id)
  where business_operation_id is not null;

create table if not exists public.dte_production_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  document_id uuid not null references public.dte_production_documents(id) on delete restrict,
  kind text not null check (kind in ('dte_xml','envio_xml','pdf','sii_response')),
  storage_key text not null check (
    storage_key !~* '^https?://' and
    storage_key !~* 'public'
  ),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint not null check (byte_length > 0),
  content_type text not null,
  immutable boolean not null default true check (immutable),
  created_at timestamptz not null default now(),
  unique (tenant_id, document_id, kind),
  unique (tenant_id, storage_key)
);

create table if not exists public.dte_production_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  document_id uuid not null references public.dte_production_documents(id) on delete restrict,
  attempt_number integer not null default 1 check (attempt_number = 1),
  status text not null check (status in ('persisted','uploading','submitted','rejected','ambiguous')),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_sha256 text,
  response_safe jsonb,
  track_id_ciphertext text,
  track_id_fingerprint text,
  before_fetch_at timestamptz,
  after_fetch_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, document_id),
  unique (tenant_id, track_id_fingerprint)
);

create table if not exists public.dte_production_recipient_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  document_id uuid not null references public.dte_production_documents(id) on delete restrict,
  recipient_email text not null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending','delivering','delivered','failed')),
  xml_artifact_id uuid not null references public.dte_production_artifacts(id) on delete restrict,
  pdf_artifact_id uuid not null references public.dte_production_artifacts(id) on delete restrict,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (tenant_id, idempotency_key),
  unique (tenant_id, document_id)
);

create table if not exists public.dte_production_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  document_id uuid references public.dte_production_documents(id) on delete restrict,
  action text not null,
  actor_id uuid,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.dte_production_artifact_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'dte_production_artifacts are immutable';
end;
$$;

drop trigger if exists dte_production_artifacts_no_mutation on public.dte_production_artifacts;
create trigger dte_production_artifacts_no_mutation
before update or delete on public.dte_production_artifacts
for each row execute function public.dte_production_artifact_immutable();

create or replace function public.dte_production_audit_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'dte_production_audit is append-only';
end;
$$;

drop trigger if exists dte_production_audit_no_update on public.dte_production_audit;
create trigger dte_production_audit_no_update
before update or delete on public.dte_production_audit
for each row execute function public.dte_production_audit_append_only();

create or replace function public.import_dte_production_caf_metadata(
  p_id uuid, p_tenant_id uuid, p_dte_type integer, p_issuer_rut text,
  p_range_from integer, p_range_to integer, p_authorization_date date,
  p_sha256 text, p_logical_identity text, p_secure_ref text
) returns uuid language plpgsql security definer set search_path = public as $$
declare inserted_id uuid;
begin
  if p_dte_type not in (33,56,61) or p_range_from < 1 or p_range_to < p_range_from then raise exception 'DTE_CAF_INPUT_INVALID'; end if;
  insert into public.dte_production_cafs(id,tenant_id,dte_type,issuer_rut,range_from,range_to,authorization_date,sha256,logical_identity,secure_ref,trust_status)
  values (p_id,p_tenant_id,p_dte_type,p_issuer_rut,p_range_from,p_range_to,p_authorization_date,p_sha256,p_logical_identity,p_secure_ref,'verified_official') returning id into inserted_id;
  insert into public.dte_production_folio_ledger(tenant_id,dte_type,folio,caf_id,state)
  select p_tenant_id,p_dte_type,folio,inserted_id,'available' from generate_series(p_range_from,p_range_to) folio;
  insert into public.dte_production_audit(tenant_id,action,metadata_safe) values (p_tenant_id,'caf_imported',jsonb_build_object('dteType',p_dte_type,'rangeFrom',p_range_from,'rangeTo',p_range_to));
  return inserted_id;
end;
$$;

create or replace function public.reserve_dte_production_folio(
  p_tenant_id uuid,
  p_dte_type integer,
  p_document_id uuid,
  p_business_operation_id text
) returns table(folio integer, caf_id uuid, reused boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.dte_production_folio_ledger%rowtype;
  selected public.dte_production_folio_ledger%rowtype;
begin
  if p_dte_type not in (33,56,61) or nullif(trim(p_business_operation_id), '') is null then
    raise exception 'DTE_FOLIO_INPUT_INVALID';
  end if;
  select * into existing
    from public.dte_production_folio_ledger
   where tenant_id = p_tenant_id
     and business_operation_id = p_business_operation_id
   for update;
  if found then
    if existing.document_id <> p_document_id or existing.dte_type <> p_dte_type
       or existing.state not in ('reserved','issued') then
      raise exception 'DTE_FOLIO_IDEMPOTENCY_CONFLICT';
    end if;
    return query select existing.folio, existing.caf_id, true;
    return;
  end if;
  select * into selected
    from public.dte_production_folio_ledger
   where tenant_id = p_tenant_id
     and dte_type = p_dte_type
     and state = 'available'
   order by folio
   for update skip locked
   limit 1;
  if not found then raise exception 'DTE_FOLIO_EXHAUSTED'; end if;
  update public.dte_production_folio_ledger
     set state = 'reserved',
         document_id = p_document_id,
         business_operation_id = p_business_operation_id,
         reserved_at = now(),
         updated_at = now()
   where tenant_id = selected.tenant_id
     and dte_type = selected.dte_type
     and folio = selected.folio
     and state = 'available';
  if not found then raise exception 'DTE_FOLIO_COLLISION'; end if;
  insert into public.dte_production_audit(tenant_id, document_id, action, metadata_safe)
  values (p_tenant_id, p_document_id, 'folio_reserved',
    jsonb_build_object('dteType', p_dte_type, 'folio', selected.folio));
  return query select selected.folio, selected.caf_id, false;
end;
$$;

create or replace function public.begin_dte_production_submission(
  p_tenant_id uuid,
  p_document_id uuid
) returns setof public.dte_production_documents
language plpgsql security definer set search_path = public as $$
declare
  changed_document public.dte_production_documents%rowtype;
  changed integer;
begin
  if not exists (
    select 1 from public.dte_production_submission_attempts
     where tenant_id = p_tenant_id and document_id = p_document_id
       and attempt_number = 1 and status = 'persisted'
  ) then raise exception 'DTE_SUBMISSION_ATTEMPT_NOT_PERSISTED'; end if;
  update public.dte_production_documents
     set status = 'submitting', updated_at = now()
   where tenant_id = p_tenant_id and id = p_document_id and status = 'ready'
   returning * into changed_document;
  if not found then raise exception 'DTE_DOCUMENT_STATE_CONFLICT'; end if;
  update public.dte_production_folio_ledger
     set state = 'issued', issued_at = now(), updated_at = now()
   where tenant_id = p_tenant_id and document_id = p_document_id and state = 'reserved';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'DTE_FOLIO_STATE_CONFLICT'; end if;
  insert into public.dte_production_audit(tenant_id, document_id, action)
  values (p_tenant_id, p_document_id, 'submission_started_folio_issued');
  return next changed_document;
end;
$$;

create or replace function public.claim_dte_recipient_outbox()
returns setof public.dte_production_recipient_outbox
language plpgsql security definer set search_path = public as $$
declare claimed public.dte_production_recipient_outbox%rowtype;
begin
  select * into claimed from public.dte_production_recipient_outbox where status in ('pending','failed') order by created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.dte_production_recipient_outbox set status='delivering', attempts=attempts+1 where id=claimed.id returning * into claimed;
  return next claimed;
end;
$$;

alter table public.dte_production_tenant_settings enable row level security;
alter table public.dte_production_cafs enable row level security;
alter table public.dte_production_documents enable row level security;
alter table public.dte_production_folio_ledger enable row level security;
alter table public.dte_production_artifacts enable row level security;
alter table public.dte_production_submission_attempts enable row level security;
alter table public.dte_production_recipient_outbox enable row level security;
alter table public.dte_production_audit enable row level security;

revoke all on function public.claim_dte_recipient_outbox() from public, anon, authenticated;
revoke all on function public.begin_dte_production_submission(uuid, uuid) from public, anon, authenticated;
revoke all on function public.import_dte_production_caf_metadata(uuid, uuid, integer, text, integer, integer, date, text, text, text) from public, anon, authenticated;
revoke all on function public.reserve_dte_production_folio(uuid, integer, uuid, text) from public, anon, authenticated;

comment on table public.dte_production_cafs is
  'Metadata CAF only. Never store AUTORIZACION XML, RSASK, RSAPK private material, certificates or keys.';
comment on table public.dte_production_artifacts is
  'Opaque keys in a private bucket only. Public URLs are forbidden.';
comment on table public.dte_production_submission_attempts is
  'Exactly one upload attempt per document. Ambiguous results require manual status reconciliation.';

commit;
