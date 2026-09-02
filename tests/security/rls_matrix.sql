-- Local-only RLS acceptance matrix. Run after the hardening migration in an
-- ephemeral Supabase/PostgreSQL database. Never point this at a remote project.
-- Required fixtures:
--   tenant A: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
--   tenant B: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
--   active owner/admin of A: 11111111-1111-4111-8111-111111111111
--   active owner/admin of B: 22222222-2222-4222-8222-222222222222
--   user without membership: 33333333-3333-4333-8333-333333333333
--   active platform super_admin: 44444444-4444-4444-8444-444444444444
-- Each tenant must have at least one appointment fixture.

begin;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
do $$
begin
  if not exists (
    select 1 from public.appointments
    where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) then raise exception 'RLS: correct tenant member was denied'; end if;
  if exists (
    select 1 from public.appointments
    where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then raise exception 'RLS: cross-tenant appointment was exposed'; end if;
end $$;

select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',
  true
);
do $$
begin
  if exists (select 1 from public.appointments) then
    raise exception 'RLS: user without membership saw appointments';
  end if;
end $$;

select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-8444-444444444444',
  true
);
do $$
begin
  if not exists (
    select 1 from public.appointments
    where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) or not exists (
    select 1 from public.appointments
    where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then raise exception 'RLS: platform super_admin was not authorized'; end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform 1 from public.appointments limit 1;
    raise exception 'RLS: anon could read appointments';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.payments limit 1;
    raise exception 'RLS: anon could read payments';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.customers limit 1;
    raise exception 'RLS: anon could read customers';
  exception when insufficient_privilege then null;
  end;
end $$;


-- DTE legal-cutover tables: tenant admin, foreign tenant, no membership,
-- platform admin and public access. Fixtures for both tenants are required.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$
begin
  if not exists (select 1 from public.customer_tax_profiles where tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
     or exists (select 1 from public.customer_tax_profiles where tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception 'RLS: customer tax profile tenant isolation failed';
  end if;
  if not exists (select 1 from public.dte_payment_document_intents where tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
     or exists (select 1 from public.dte_payment_document_intents where tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception 'RLS: DTE intent tenant isolation failed';
  end if;
  if not exists (select 1 from public.dte_sii_authorization_evidence where tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
     or exists (select 1 from public.dte_sii_authorization_evidence where tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception 'RLS: authorization evidence tenant isolation failed';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$
begin
  if exists (select 1 from public.customer_tax_profiles)
     or exists (select 1 from public.dte_sii_authorization_evidence)
     or exists (select 1 from public.dte_legal_activation)
     or exists (select 1 from public.dte_legal_activation_events) then
    raise exception 'RLS: no-membership user saw DTE cutover data';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
do $$
begin
  if not exists (select 1 from public.dte_sii_authorization_evidence where tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
     or not exists (select 1 from public.dte_sii_authorization_evidence where tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception 'RLS: platform admin cannot read both tenants';
  end if;
end $$;

set local role anon;
do $$
begin
  begin perform 1 from public.customer_tax_profiles limit 1; raise exception 'RLS: anon tax profile read'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.dte_sii_authorization_evidence limit 1; raise exception 'RLS: anon evidence read'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.dte_legal_activation limit 1; raise exception 'RLS: anon activation read'; exception when insufficient_privilege then null; end;
end $$;

rollback;
