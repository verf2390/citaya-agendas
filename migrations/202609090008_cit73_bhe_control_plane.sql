begin;

-- CIT-73 phase 1A. Internal authority records, independent of delivery mechanism.
-- No historical flags are promoted and no existing tenant data is backfilled.
do $$
begin
  if pg_catalog.to_regprocedure('public.normalize_chilean_rut(text)') is null
     or pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'BHE_IDENTITY_PRIMITIVES_REQUIRED';
  end if;
end;
$$;

create table public.bhe_issuers (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  tax_identifier_fingerprint text not null check (tax_identifier_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'UNVERIFIED' check (status in ('UNVERIFIED','VERIFIED','INACTIVE')),
  evidence_reference text not null check (pg_catalog.length(pg_catalog.btrim(evidence_reference)) between 3 and 300),
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null,
  updated_by uuid not null,
  version bigint not null default 1 check (version > 0),
  unique (tenant_id,id),
  check (status <> 'VERIFIED' or (verified_at is not null and verified_by is not null))
);

-- One current candidate/verified taxpayer per tenant. Inactive identities remain historical.
create unique index bhe_one_current_issuer_per_tenant
  on public.bhe_issuers(tenant_id) where status <> 'INACTIVE';

-- Each dimension has its own record ID, revision, lifecycle and evidence.
-- The discriminator and composite parent FK prohibit mixing dimensions/tenants/issuers.
create table public.bhe_authority_records (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  issuer_id uuid not null,
  domain text not null check (domain in ('ELIGIBILITY','APPLICATION','CERTIFICATION','AUTHORIZATION')),
  revision bigint not null check (revision > 0),
  parent_id uuid,
  parent_domain text,
  status text not null,
  evidence_reference text check (evidence_reference is null or pg_catalog.length(pg_catalog.btrim(evidence_reference)) between 3 and 300),
  evidence_verified_at timestamptz,
  evidence_verified_by uuid,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null,
  updated_by uuid not null,
  version bigint not null default 1 check (version > 0),
  unique (tenant_id,issuer_id,id,domain),
  unique (tenant_id,issuer_id,domain,revision),
  foreign key (tenant_id,issuer_id) references public.bhe_issuers(tenant_id,id) on delete restrict,
  foreign key (tenant_id,issuer_id,parent_id,parent_domain)
    references public.bhe_authority_records(tenant_id,issuer_id,id,domain) on delete restrict,
  constraint bhe_authority_domain_status check (
    (domain='ELIGIBILITY' and status in ('NOT_ASSESSED','UNDER_REVIEW','ELIGIBLE','INELIGIBLE'))
    or (domain='APPLICATION' and status in ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','WITHDRAWN'))
    or (domain='CERTIFICATION' and status in ('NOT_STARTED','IN_PROGRESS','VALID','FAILED','INVALIDATED'))
    or (domain='AUTHORIZATION' and status in ('NOT_GRANTED','ACTIVE','SUSPENDED','REVOKED'))
  ),
  constraint bhe_authority_parent_shape check ((
    (domain='ELIGIBILITY' and parent_id is null and parent_domain is null)
    or (domain='APPLICATION' and parent_id is not null and parent_domain='ELIGIBILITY')
    or (domain='CERTIFICATION' and parent_id is not null and parent_domain='APPLICATION')
    or (domain='AUTHORIZATION' and parent_id is not null and parent_domain='CERTIFICATION')
  ) is true),
  constraint bhe_authority_positive_evidence check (
    status not in ('ELIGIBLE','APPROVED','VALID','ACTIVE')
    or (evidence_reference is not null and evidence_verified_at is not null and evidence_verified_by is not null)
  ),
  check (valid_from is null or valid_until is null or valid_until >= valid_from)
);

create unique index bhe_one_open_record_per_dimension
  on public.bhe_authority_records(tenant_id,issuer_id,domain)
  where status in ('NOT_ASSESSED','UNDER_REVIEW','DRAFT','SUBMITTED','NOT_STARTED','IN_PROGRESS','VALID','NOT_GRANTED','ACTIVE','SUSPENDED');

create table public.bhe_authority_controls (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  generation bigint not null default 0 check (generation >= 0),
  -- Phase 1A has no operation that releases this latch. Future enablement must
  -- explicitly bind a reviewed generation; restoring compatible facts is insufficient.
  requires_explicit_enablement boolean not null default true check (requires_explicit_enablement),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table public.bhe_authority_audit (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  domain text not null check (domain in ('ISSUER','ELIGIBILITY','APPLICATION','CERTIFICATION','AUTHORIZATION','LEGACY_SETTINGS')),
  entity_id uuid not null,
  action text not null,
  actor_kind text not null check (actor_kind in ('PLATFORM_ADMIN','SYSTEM')),
  actor_user_id uuid,
  reason text not null check (pg_catalog.length(pg_catalog.btrim(reason)) between 10 and 500),
  previous_state jsonb not null,
  new_state jsonb not null,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  entity_version bigint not null check (entity_version > 0),
  generation bigint not null check (generation > 0),
  unique (tenant_id,generation),
  check ((actor_kind='PLATFORM_ADMIN' and actor_user_id is not null)
    or (actor_kind='SYSTEM' and actor_user_id is null and domain='LEGACY_SETTINGS' and action='DEFAULT_CREATED'))
);

alter table public.bhe_issuers enable row level security;
alter table public.bhe_authority_records enable row level security;
alter table public.bhe_authority_controls enable row level security;
alter table public.bhe_authority_audit enable row level security;
-- Explicitly remove Supabase's inherited grants, including service_role and TRUNCATE.
revoke all on table public.bhe_issuers, public.bhe_authority_records,
  public.bhe_authority_controls, public.bhe_authority_audit from public,anon,authenticated,service_role;

comment on table public.bhe_issuers is
  'Tenant-scoped taxpayer identity, distinct from tenant and professional. Only a tenant-bound fingerprint is persisted.';
comment on table public.bhe_authority_records is
  'Independent internal authority dimensions with immutable lineage, historical revisions and audited state versions. Not a transport contract.';
comment on table public.bhe_authority_controls is
  'Administrative generation and closed enablement latch. No authority report is wired to execution in phase 1A.';

commit;
