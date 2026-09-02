begin;

-- A pre-declaration issuer is a real tenant profile, but it must not pretend
-- that an SII production resolution already exists.
alter table public.dte_production_tenant_settings
  add column if not exists issuer_profile_state text not null default 'pre_declaration',
  alter column resolution_date drop not null,
  alter column resolution_number drop not null,
  alter column sii_office drop not null;

alter table public.dte_production_tenant_settings
  drop constraint if exists dte_production_tenant_settings_profile_state_check;
alter table public.dte_production_tenant_settings
  add constraint dte_production_tenant_settings_profile_state_check
  check (issuer_profile_state in (
    'pre_declaration', 'declared', 'ready_for_issuance', 'suspended'
  ));

create unique index if not exists dte_production_issuer_rut_unique
  on public.dte_production_tenant_settings (
    upper(regexp_replace(issuer_rut, '[^0-9K]', '', 'g'))
  );

create table if not exists public.dte_tenant_readiness_evidence (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  issuer_profile_complete boolean not null default false,
  secure_production_root_ready boolean not null default false,
  certificate_valid boolean not null default false,
  certificate_rut_match boolean not null default false,
  private_key_matches_certificate boolean not null default false,
  trust_anchor_valid boolean not null default false,
  private_bucket_ready boolean not null default false,
  persistence_ready boolean not null default false,
  ledger_ready boolean not null default false,
  tenant_isolation_valid boolean not null default false,
  worker_tenant_aware boolean not null default false,
  idempotency_ready boolean not null default false,
  caf_procedures_ready boolean not null default false,
  production_caf_root_ready boolean not null default false,
  certificate_sha256 text check (
    certificate_sha256 is null or certificate_sha256 ~ '^[a-f0-9]{64}$'
  ),
  certificate_public_key_sha256 text check (
    certificate_public_key_sha256 is null or
    certificate_public_key_sha256 ~ '^[a-f0-9]{64}$'
  ),
  trust_anchor_sha256 text check (
    trust_anchor_sha256 is null or trust_anchor_sha256 ~ '^[a-f0-9]{64}$'
  ),
  safe_blocking_reason text,
  checked_at timestamptz not null default now()
);

alter table public.dte_tenant_readiness_evidence enable row level security;
revoke all on public.dte_tenant_readiness_evidence
  from public, anon, authenticated;

comment on table public.dte_tenant_readiness_evidence is
  'Safe readiness attestations only: booleans and public-key/certificate hashes. Never store paths, passwords, certificates, private keys, CAF XML or tokens.';

-- The bucket is private and service-role-only. Existing public assets retain
-- their prior read behavior, but this bucket can never match that policy.
insert into storage.buckets (id, name, public)
values ('dte-production-private', 'dte-production-private', false)
on conflict (id) do update
set name = excluded.name, public = false;

drop policy if exists "Public read" on storage.objects;
create policy "Public read" on storage.objects
  for select to public
  using (bucket_id <> 'dte-production-private');

drop policy if exists dte_production_service_role_only on storage.objects;
create policy dte_production_service_role_only on storage.objects
  for all to service_role
  using (bucket_id = 'dte-production-private')
  with check (bucket_id = 'dte-production-private');

create or replace function public.dte_tenant_operational_readiness(
  p_tenant_id uuid
) returns table (
  ready_for_declaration boolean,
  ready_for_issuance boolean,
  production_caf_count bigint,
  available_folio_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with state as (
    select
      t.id as tenant_id,
      p.enabled as profile_enabled,
      p.issuer_profile_state,
      p.issuer_rut,
      p.certificate_valid_from,
      p.certificate_valid_to,
      i.issuance_mode,
      i.production_enabled as issuance_production_enabled,
      i.sii_authorization_status,
      i.certificate_ready,
      i.caf_ready,
      i.folio_ready,
      i.endpoints_ready,
      i.storage_ready,
      i.worker_ready,
      i.readiness_tests_green,
      e.*,
      exists (
        select 1 from storage.buckets b
        where b.id = 'dte-production-private' and b.public = false
      ) as bucket_is_private,
      (
        select count(*) from public.dte_production_cafs c
        where c.tenant_id = t.id and c.active
      ) as caf_count,
      (
        select count(*) from public.dte_production_folio_ledger l
        where l.tenant_id = t.id and l.state = 'available'
      ) as folio_count
    from public.tenants t
    left join public.dte_production_tenant_settings p on p.tenant_id = t.id
    left join public.dte_tenant_issuance_settings i on i.tenant_id = t.id
    left join public.dte_tenant_readiness_evidence e on e.tenant_id = t.id
    where t.id = p_tenant_id
  ), evaluated as (
    select *,
      coalesce((
        issuer_profile_state in (
          'pre_declaration', 'declared', 'ready_for_issuance'
        )
        and upper(regexp_replace(coalesce(issuer_rut, ''), '[^0-9K]', '', 'g'))
          ~ '^[0-9]{7,8}[0-9K]$'
        and issuer_profile_complete
        and secure_production_root_ready
        and certificate_valid
        and certificate_rut_match
        and private_key_matches_certificate
        and trust_anchor_valid
        and certificate_valid_from <= now()
        and certificate_valid_to > now()
        and private_bucket_ready
        and bucket_is_private
        and persistence_ready
        and ledger_ready
        and tenant_isolation_valid
        and worker_tenant_aware
        and idempotency_ready
        and caf_procedures_ready
        and production_caf_root_ready
      ), false) as common_ready
    from state
  )
  select
    (
      common_ready
      and profile_enabled = false
      and issuance_production_enabled = false
      and issuance_mode = 'manual'
    ) as ready_for_declaration,
    (
      common_ready
      and issuer_profile_state in ('declared', 'ready_for_issuance')
      and sii_authorization_status = 'approved'
      and profile_enabled
      and issuance_production_enabled
      and issuance_mode = 'automatic_on_verified_payment'
      and certificate_ready
      and caf_ready
      and folio_ready
      and endpoints_ready
      and storage_ready
      and worker_ready
      and readiness_tests_green
      and caf_count > 0
      and folio_count > 0
    ) as ready_for_issuance,
    caf_count,
    folio_count
  from evaluated;
$$;

revoke all on function public.dte_tenant_operational_readiness(uuid)
  from public, anon, authenticated;
grant execute on function public.dte_tenant_operational_readiness(uuid)
  to service_role;

create or replace function public.dte_retry_blocked_issuance(
  p_tenant_id uuid,
  p_intent_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  can_retry boolean;
begin
  select r.ready_for_issuance into can_retry
  from public.dte_tenant_operational_readiness(p_tenant_id) r;
  if coalesce(can_retry, false) = false then return false; end if;

  update public.dte_payment_document_intents
     set status = 'PENDING',
         safe_blocking_reason = null,
         updated_at = now()
   where id = p_intent_id
     and tenant_id = p_tenant_id
     and status = 'BLOCKED'
     and network_attempt_count = 0
     and deterministic_retry_count < 3;
  if not found then return false; end if;

  update public.dte_issuance_outbox
     set status = 'PENDING',
         available_at = now(),
         locked_at = null,
         locked_by = null,
         last_safe_error = null,
         updated_at = now()
   where tenant_id = p_tenant_id
     and intent_id = p_intent_id
     and status = 'BLOCKED'
     and network_attempts = 0
     and deterministic_attempts < 3;
  if not found then
    raise exception 'DTE_RETRY_OUTBOX_STATE_INVALID';
  end if;

  insert into public.dte_document_events (
    tenant_id, intent_id, event_type, safe_metadata
  ) values (
    p_tenant_id, p_intent_id, 'ISSUANCE_REQUEUED',
    jsonb_build_object('automaticRetry', false)
  );
  return true;
end;
$$;

revoke all on function public.dte_retry_blocked_issuance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.dte_retry_blocked_issuance(uuid, uuid)
  to service_role;

-- Resolve the tax identity first. Only if no issuer profile owns the normalized
-- RUT may the canonical slug be considered or created.
do $$
declare
  rg_tenant_id uuid;
  rg_user_id uuid;
  rut_matches integer;
begin
  select count(*), (array_agg(p.tenant_id))[1]
    into rut_matches, rg_tenant_id
    from public.dte_production_tenant_settings p
   where upper(regexp_replace(p.issuer_rut, '[^0-9K]', '', 'g'))
       = upper(regexp_replace('78.195.645-7', '[^0-9K]', '', 'g'));
  if rut_matches > 1 then raise exception 'RG_ISSUER_RUT_NOT_UNIQUE'; end if;

  if rg_tenant_id is null then
    select t.id into rg_tenant_id
      from public.tenants t
     where t.slug = 'rg-spa';
  end if;

  if rg_tenant_id is null then
    insert into public.tenants (
      slug, name, address, city, admin_email, contact_email,
      show_address, show_phone, show_address_home,
      show_address_after_booking, show_phone_home,
      show_phone_after_booking
    ) values (
      'rg-spa', 'R&G SPA', 'Regimiento Arica N°301 depto/local 215',
      'Coquimbo', 'verf14@gmail.com', 'verf14@gmail.com',
      false, false, false, false, false, false
    ) returning id into rg_tenant_id;
  end if;

  if (select slug from public.tenants where id = rg_tenant_id) <> 'rg-spa' then
    raise exception 'RG_ISSUER_SLUG_CONFLICT';
  end if;

  select (array_agg(u.id))[1], count(*) into rg_user_id, rut_matches
    from auth.users u
   where lower(u.email) = lower('verf14@gmail.com');
  if rut_matches <> 1 then raise exception 'RG_ADMIN_IDENTITY_NOT_UNIQUE'; end if;

  insert into public.tenant_members (
    tenant_id, user_id, role, email, is_active
  ) values (
    rg_tenant_id, rg_user_id, 'owner', 'verf14@gmail.com', true
  )
  on conflict (tenant_id, user_id) do update
     set role = 'owner',
         email = excluded.email,
         is_active = true,
         updated_at = now();

  insert into public.dte_production_tenant_settings (
    tenant_id, enabled, issuer_rut, issuer_legal_name, issuer_activity,
    issuer_activity_code, issuer_address, issuer_commune, issuer_city,
    resolution_date, resolution_number, sii_office, sender_rut,
    certificate_secret_ref, certificate_valid_from, certificate_valid_to,
    issuer_profile_state, updated_at
  ) values (
    rg_tenant_id, false, '78.195.645-7', 'R&G SPA',
    'Servicios digitales', null,
    'Regimiento Arica N°301 depto/local 215', 'Coquimbo', 'Coquimbo',
    null, null, null, '27.164.542-2',
    'external-secret:rg-spa:' || rg_tenant_id::text,
    '2026-05-06 00:10:28+00', '2028-05-26 13:01:31+00',
    'pre_declaration', now()
  )
  on conflict (tenant_id) do update
     set enabled = false,
         issuer_rut = excluded.issuer_rut,
         issuer_legal_name = excluded.issuer_legal_name,
         issuer_activity = excluded.issuer_activity,
         issuer_activity_code = excluded.issuer_activity_code,
         issuer_address = excluded.issuer_address,
         issuer_commune = excluded.issuer_commune,
         issuer_city = excluded.issuer_city,
         resolution_date = null,
         resolution_number = null,
         sii_office = null,
         sender_rut = excluded.sender_rut,
         certificate_secret_ref = excluded.certificate_secret_ref,
         certificate_valid_from = excluded.certificate_valid_from,
         certificate_valid_to = excluded.certificate_valid_to,
         issuer_profile_state = 'pre_declaration',
         updated_at = now();

  insert into public.dte_tenant_issuance_settings (
    tenant_id, issuance_mode, consumer_document_type, invoice_on_request,
    auto_email_delivery, tax_treatment, production_enabled,
    sii_authorization_status, certificate_ready, certificate_valid_to,
    caf_ready, folio_ready, endpoints_ready, storage_ready, worker_ready,
    readiness_tests_green, safe_blocking_reason
  ) values (
    rg_tenant_id, 'manual', 'unsupported', true, false, 'unconfigured',
    false, 'not_configured', false, '2028-05-26 13:01:31+00',
    false, false, false, false, false, false,
    'PRE_DECLARATION_TRUST_ANCHOR_PENDING'
  )
  on conflict (tenant_id) do update
     set issuance_mode = 'manual',
         production_enabled = false,
         sii_authorization_status = 'not_configured',
         certificate_ready = false,
         certificate_valid_to = excluded.certificate_valid_to,
         caf_ready = false,
         folio_ready = false,
         endpoints_ready = false,
         storage_ready = false,
         worker_ready = false,
         readiness_tests_green = false,
         safe_blocking_reason = 'PRE_DECLARATION_TRUST_ANCHOR_PENDING',
         updated_at = now();

  insert into public.dte_tenant_readiness_evidence (
    tenant_id, safe_blocking_reason
  ) values (
    rg_tenant_id, 'PRE_DECLARATION_TRUST_ANCHOR_PENDING'
  )
  on conflict (tenant_id) do nothing;
end;
$$;

comment on column public.dte_production_tenant_settings.issuer_profile_state is
  'pre_declaration has no SII production resolution and cannot issue.';
comment on function public.dte_tenant_operational_readiness(uuid) is
  'Separates declaration readiness from issuance readiness; neither implies the other.';
comment on function public.dte_retry_blocked_issuance(uuid, uuid) is
  'Manual service-role requeue for deterministic pre-network blocks only.';

commit;
