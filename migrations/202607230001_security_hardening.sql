-- Citaya canonical security hardening.
-- Apply through the normal reviewed Supabase migration process. Never run this
-- file from a public request or against production without a backup/change window.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create or replace function public.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = p_user_id
      and pa.is_active is true
      and lower(pa.role) = 'super_admin'
  );
$$;

create or replace function public.is_tenant_member(
  p_tenant_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_user_id
      and tm.is_active is true
      and lower(tm.role) in ('owner', 'admin')
  );
$$;

revoke all on function public.is_platform_admin(uuid) from public;
revoke all on function public.is_tenant_member(uuid, uuid) from public;
grant execute on function public.is_platform_admin(uuid) to authenticated, service_role;
grant execute on function public.is_tenant_member(uuid, uuid) to authenticated, service_role;

alter table if exists public.appointments
  add column if not exists manage_token_hash text,
  add column if not exists manage_token_expires_at timestamptz,
  add column if not exists manage_token_revoked_at timestamptz,
  add column if not exists manage_token_rotated_at timestamptz,
  add column if not exists manage_token_legacy_expires_at timestamptz,
  add column if not exists public_idempotency_key text,
  add column if not exists service_price numeric,
  add column if not exists service_duration_min integer,
  add column if not exists currency text;

-- Existing plaintext links get a bounded transition window. New code never
-- writes plaintext. A follow-up migration must null manage_token after this date.
update public.appointments
set manage_token_legacy_expires_at = now() + interval '14 days'
where manage_token is not null
  and manage_token_hash is null
  and manage_token_legacy_expires_at is null;

create unique index if not exists appointments_manage_token_hash_uidx
  on public.appointments (manage_token_hash)
  where manage_token_hash is not null;

create unique index if not exists appointments_public_idempotency_uidx
  on public.appointments (tenant_id, public_idempotency_key)
  where public_idempotency_key is not null;

do $$
begin
  if to_regclass('public.appointments') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.appointments'::regclass
         and conname = 'appointments_no_professional_overlap'
     ) then
    alter table public.appointments
      add constraint appointments_no_professional_overlap
      exclude using gist (
        tenant_id with =,
        professional_id with =,
        tstzrange(start_at, end_at, '[)') with &&
      )
      where (
        professional_id is not null
        and coalesce(booking_status, status, '') in ('confirmed', 'pending_payment')
      );
  end if;
end $$;

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  provider text not null check (provider in ('mercadopago', 'webpay', 'khipu', 'manual')),
  buy_order text,
  session_id text,
  amount numeric not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'created'
    check (status in ('created', 'pending', 'processing', 'succeeded', 'failed')),
  provider_payment_id text,
  idempotency_key text not null,
  audit_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (tenant_id, idempotency_key),
  unique (provider, provider_payment_id)
);

create unique index if not exists payment_intents_webpay_buy_order_uidx
  on public.payment_intents (buy_order)
  where buy_order is not null;

alter table if exists public.payments
  add column if not exists provider text,
  add column if not exists currency text default 'CLP',
  add column if not exists payment_intent_id uuid references public.payment_intents(id),
  add column if not exists audit_metadata jsonb not null default '{}'::jsonb,
  add column if not exists processed_at timestamptz;

create table if not exists public.api_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  primary key (scope, key_hash)
);

create or replace function public.consume_api_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.api_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_scope !~ '^[a-z0-9:_-]{1,64}$'
     or p_key_hash !~ '^[a-f0-9]{64}$'
     or p_limit < 1 or p_limit > 1000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    return false;
  end if;

  insert into public.api_rate_limits(scope, key_hash, window_started_at, request_count)
  values (p_scope, p_key_hash, v_now, 1)
  on conflict (scope, key_hash) do update
  set window_started_at = case
        when public.api_rate_limits.window_started_at
             <= v_now - make_interval(secs => p_window_seconds)
        then v_now else public.api_rate_limits.window_started_at end,
      request_count = case
        when public.api_rate_limits.window_started_at
             <= v_now - make_interval(secs => p_window_seconds)
        then 1 else public.api_rate_limits.request_count + 1 end
  returning * into v_row;

  return v_row.request_count <= p_limit;
end;
$$;

revoke all on public.api_rate_limits from anon, authenticated;
revoke all on function public.consume_api_rate_limit(text, text, integer, integer)
  from public;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer)
  to service_role;

create or replace function public.create_public_appointment(
  p_tenant_id uuid,
  p_professional_id uuid,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_notes text,
  p_payment_required boolean,
  p_payment_status text,
  p_manage_token_hash text,
  p_manage_token_expires_at timestamptz,
  p_idempotency_key text
)
returns table(appointment_id uuid, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service public.services%rowtype;
  v_end_at timestamptz;
  v_status text;
  v_existing uuid;
begin
  if length(coalesce(p_customer_name, '')) not between 1 and 120
     or length(coalesce(p_customer_phone, '')) > 32
     or length(coalesce(p_customer_email, '')) > 254
     or length(coalesce(p_notes, '')) > 1000
     or p_start_at < now() - interval '1 minute'
     or p_start_at > now() + interval '1 year'
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$'
     or p_manage_token_hash !~ '^[a-f0-9]{64}$'
     or p_manage_token_expires_at <= now() then
    raise exception 'invalid_public_appointment';
  end if;

  select s.* into v_service
  from public.services s
  where s.id = p_service_id
    and s.tenant_id = p_tenant_id
    and s.is_active is true
  for share;
  if not found or v_service.duration_min is null
     or v_service.duration_min not between 5 and 480 then
    raise exception 'invalid_service';
  end if;

  if not exists (
    select 1 from public.professionals p
    where p.id = p_professional_id
      and p.tenant_id = p_tenant_id
      and p.active is true
  ) then
    raise exception 'invalid_professional';
  end if;

  v_end_at := p_start_at + make_interval(mins => v_service.duration_min);
  if not exists (
    select 1 from public.availability a
    where a.tenant_id = p_tenant_id
      and a.professional_id = p_professional_id
      and a.is_active is true
      and a.day_of_week = extract(dow from p_start_at at time zone 'America/Santiago')
      and (p_start_at at time zone 'America/Santiago')::time >= a.start_time
      and (v_end_at at time zone 'America/Santiago')::time <= a.end_time
  ) then
    raise exception 'outside_availability';
  end if;

  select a.id into v_existing
  from public.appointments a
  where a.tenant_id = p_tenant_id
    and a.public_idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing, true;
    return;
  end if;

  v_status := case when p_payment_required then 'pending_payment' else 'confirmed' end;
  begin
    insert into public.appointments (
      tenant_id, professional_id, service_id, start_at, end_at,
      customer_id, customer_name, customer_phone, customer_email,
      service_name, description, service_price, service_duration_min,
      notes, currency, status, booking_status, payment_required,
      payment_status, source, manage_token, manage_token_hash,
      manage_token_expires_at, public_idempotency_key
    ) values (
      p_tenant_id, p_professional_id, p_service_id, p_start_at, v_end_at,
      p_customer_id, left(p_customer_name, 120), nullif(left(p_customer_phone, 32), ''),
      nullif(left(lower(p_customer_email), 254), ''),
      v_service.name, v_service.description, v_service.price, v_service.duration_min,
      nullif(left(p_notes, 1000), ''), upper(coalesce(v_service.currency, 'CLP')),
      v_status, v_status, p_payment_required,
      case when p_payment_required then 'pending'
           when p_payment_status = 'pay_later' then 'pay_later'
           else 'not_required' end,
      'booking_flow', null, p_manage_token_hash, p_manage_token_expires_at,
      p_idempotency_key
    )
    returning id into appointment_id;
  exception
    when exclusion_violation then
      raise exception 'slot_unavailable' using errcode = '23P01';
    when unique_violation then
      select a.id into appointment_id
      from public.appointments a
      where a.tenant_id = p_tenant_id
        and a.public_idempotency_key = p_idempotency_key;
      if appointment_id is null then raise; end if;
      duplicate := true;
      return next;
      return;
  end;
  duplicate := false;
  return next;
end;
$$;

revoke all on function public.create_public_appointment(
  uuid, uuid, uuid, timestamptz, uuid, text, text, text, text, boolean, text,
  text, timestamptz, text
) from public;
grant execute on function public.create_public_appointment(
  uuid, uuid, uuid, timestamptz, uuid, text, text, text, text, boolean, text,
  text, timestamptz, text
) to service_role;

create or replace function public.activate_payment_intent(
  p_intent_id uuid,
  p_provider_payment_id text,
  p_payment_url text,
  p_remaining_amount numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $
declare
  v_intent public.payment_intents%rowtype;
  v_payment_id uuid;
begin
  select * into v_intent
  from public.payment_intents
  where id = p_intent_id
  for update;

  if not found
     or length(coalesce(p_provider_payment_id, '')) not between 1 and 256
     or length(coalesce(p_payment_url, '')) not between 1 and 2048 then
    raise exception 'invalid_payment_activation';
  end if;
  if v_intent.status = 'pending'
     and v_intent.provider_payment_id = p_provider_payment_id then
    return false;
  end if;
  if v_intent.status <> 'created' then
    raise exception 'payment_intent_not_creatable';
  end if;

  update public.payment_intents
  set provider_payment_id = p_provider_payment_id,
      status = 'pending',
      updated_at = now()
  where id = v_intent.id;

  select p.id into v_payment_id
  from public.payments p
  where p.tenant_id = v_intent.tenant_id
    and p.appointment_id = v_intent.appointment_id
  order by p.created_at
  limit 1
  for update;

  if v_payment_id is null then
    insert into public.payments (
      tenant_id, appointment_id, external_reference, amount, status,
      provider, currency, payment_intent_id
    ) values (
      v_intent.tenant_id, v_intent.appointment_id,
      v_intent.appointment_id::text, v_intent.amount, 'pending',
      v_intent.provider, v_intent.currency, v_intent.id
    );
  else
    update public.payments
    set external_reference = v_intent.appointment_id::text,
        amount = v_intent.amount,
        status = 'pending',
        provider = v_intent.provider,
        currency = v_intent.currency,
        payment_intent_id = v_intent.id,
        updated_at = now()
    where id = v_payment_id;
  end if;

  update public.appointments
  set payment_required = true,
      payment_status = 'pending',
      payment_provider = v_intent.provider,
      payment_required_amount = v_intent.amount,
      payment_remaining_amount = greatest(coalesce(p_remaining_amount, 0), 0),
      payment_reference = p_provider_payment_id,
      payment_url = p_payment_url,
      status = 'pending_payment',
      booking_status = 'pending_payment',
      updated_at = now()
  where id = v_intent.appointment_id
    and tenant_id = v_intent.tenant_id
    and coalesce(payment_status, '') <> 'paid'
    and coalesce(status, '') not in ('canceled', 'cancelled');
  if not found then raise exception 'appointment_not_payable'; end if;
  return true;
end;
$;

revoke all on function public.activate_payment_intent(uuid, text, text, numeric)
  from public;
grant execute on function public.activate_payment_intent(uuid, text, text, numeric)
  to service_role;

create or replace function public.finalize_verified_payment(
  p_intent_id uuid,
  p_provider text,
  p_provider_payment_id text,
  p_audit_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.payment_intents%rowtype;
begin
  select * into v_intent
  from public.payment_intents
  where id = p_intent_id
  for update;

  if not found
     or v_intent.provider <> p_provider
     or v_intent.provider_payment_id <> p_provider_payment_id then
    raise exception 'payment_intent_mismatch';
  end if;
  if v_intent.status = 'succeeded' then return false; end if;
  if v_intent.status not in ('pending', 'processing') then
    raise exception 'payment_intent_not_payable';
  end if;

  update public.payment_intents
  set status = 'succeeded',
      audit_metadata = coalesce(p_audit_metadata, '{}'::jsonb),
      processed_at = now(),
      updated_at = now()
  where id = v_intent.id;

  update public.payments
  set status = 'paid',
      provider = p_provider,
      currency = v_intent.currency,
      amount = v_intent.amount,
      payment_intent_id = v_intent.id,
      audit_metadata = coalesce(p_audit_metadata, '{}'::jsonb),
      processed_at = now()
  where tenant_id = v_intent.tenant_id
    and appointment_id = v_intent.appointment_id
    and coalesce(status, '') <> 'paid';

  update public.appointments
  set payment_status = 'paid',
      payment_provider = p_provider,
      payment_reference = p_provider_payment_id,
      payment_paid_amount = v_intent.amount,
      status = 'confirmed',
      booking_status = 'confirmed',
      updated_at = now()
  where id = v_intent.appointment_id
    and tenant_id = v_intent.tenant_id
    and coalesce(payment_status, '') <> 'paid'
    and coalesce(status, '') <> 'canceled';

  if not found then
    raise exception 'appointment_not_payable';
  end if;
  return true;
end;
$$;

revoke all on function public.finalize_verified_payment(uuid, text, text, jsonb)
  from public;
grant execute on function public.finalize_verified_payment(uuid, text, text, jsonb)
  to service_role;

alter table if exists public.waitlist_requests
  add column if not exists idempotency_key text;
create unique index if not exists waitlist_requests_idempotency_uidx
  on public.waitlist_requests (tenant_id, idempotency_key)
  where idempotency_key is not null;

-- Canonical tenant isolation. Service-role bypass remains restricted to server
-- routes that perform authorization before querying.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'appointments', 'customers', 'professionals', 'services', 'availability',
    'service_availability_rules', 'payments', 'payment_intents',
    'tenant_payment_settings', 'waitlist_requests', 'tenant_billing_settings',
    'message_logs', 'tenant_reviews'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('drop policy if exists tenant_member_access on public.%I', v_table);
      execute format(
        'create policy tenant_member_access on public.%I for all to authenticated ' ||
        'using (public.is_tenant_member(tenant_id) or public.is_platform_admin()) ' ||
        'with check (public.is_tenant_member(tenant_id) or public.is_platform_admin())',
        v_table
      );
    end if;
  end loop;
end $$;

alter table if exists public.tenants enable row level security;
drop policy if exists tenant_member_access on public.tenants;
create policy tenant_member_access on public.tenants
  for all to authenticated
  using (public.is_tenant_member(id) or public.is_platform_admin())
  with check (public.is_tenant_member(id) or public.is_platform_admin());

alter table if exists public.tenant_members enable row level security;
drop policy if exists own_membership_read on public.tenant_members;
create policy own_membership_read on public.tenant_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

alter table if exists public.platform_admins enable row level security;
drop policy if exists own_platform_admin_read on public.platform_admins;
create policy own_platform_admin_read on public.platform_admins
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

-- Public booking data is exposed only through controlled columns; all writes
-- and all appointment/customer/payment data remain blocked from anon.
revoke all on public.appointments, public.customers, public.payments,
  public.payment_intents, public.waitlist_requests from anon;

revoke select on public.tenants from anon;
grant select (id, slug, name, logo_url, address, city, phone_display,
  description, show_address, show_phone) on public.tenants to anon;
drop policy if exists public_tenant_read on public.tenants;
create policy public_tenant_read on public.tenants for select to anon using (true);

revoke select on public.services from anon;
grant select (id, tenant_id, name, description, duration_min, price, currency,
  is_active, created_at) on public.services to anon;
drop policy if exists public_active_service_read on public.services;
create policy public_active_service_read on public.services
  for select to anon using (is_active is true);

revoke select on public.professionals from anon;
grant select (id, tenant_id, name, title, bio, avatar_url, active, created_at)
  on public.professionals to anon;
drop policy if exists public_active_professional_read on public.professionals;
create policy public_active_professional_read on public.professionals
  for select to anon using (active is true);

revoke select on public.tenant_reviews from anon;
grant select (id, tenant_id, customer_name, rating, comment, created_at)
  on public.tenant_reviews to anon;
drop policy if exists public_review_read on public.tenant_reviews;
create policy public_review_read on public.tenant_reviews
  for select to anon using (is_hidden is false);
