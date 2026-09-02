begin;

create table if not exists public.dte_boleta39_commercial_customer_snapshots (
  intent_id uuid primary key references public.dte_payment_document_intents(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  customer_name text not null,
  customer_rut text,
  customer_email text,
  customer_phone text,
  captured_by uuid not null,
  captured_at timestamptz not null default now(),
  unique (tenant_id, intent_id)
);

alter table public.dte_boleta39_commercial_customer_snapshots enable row level security;

create or replace function public.dte_boleta39_customer_snapshot_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'DTE_BOLETA39_CUSTOMER_SNAPSHOT_IMMUTABLE';
end;
$$;

drop trigger if exists dte_boleta39_customer_snapshot_immutable
  on public.dte_boleta39_commercial_customer_snapshots;
create trigger dte_boleta39_customer_snapshot_immutable
before update or delete on public.dte_boleta39_commercial_customer_snapshots
for each row execute function public.dte_boleta39_customer_snapshot_immutable();

create or replace function public.capture_boleta39_commercial_customer_snapshot(
  p_tenant_id uuid,
  p_intent_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent_row record;
  customer_row record;
  snapshot_row record;
begin
  select * into snapshot_row
    from public.dte_boleta39_commercial_customer_snapshots
   where tenant_id = p_tenant_id and intent_id = p_intent_id;
  if snapshot_row.intent_id is not null then
    return jsonb_build_object(
      'customer_id', snapshot_row.customer_id,
      'customer_name', snapshot_row.customer_name,
      'customer_rut', snapshot_row.customer_rut,
      'customer_email', snapshot_row.customer_email,
      'customer_phone', snapshot_row.customer_phone,
      'captured_at', snapshot_row.captured_at
    );
  end if;

  select id, customer_id, status, resolved_dte_type, trigger_source,
         production_document_id
    into intent_row
    from public.dte_payment_document_intents
   where tenant_id = p_tenant_id and id = p_intent_id
   for update;

  if intent_row.id is null or intent_row.status <> 'PENDING' or
     intent_row.resolved_dte_type <> 39 or
     intent_row.trigger_source <> 'manual_admin' or
     intent_row.production_document_id is not null then
    raise exception 'DTE_BOLETA39_CUSTOMER_SNAPSHOT_INTENT_INVALID';
  end if;

  select id, full_name, rut_normalized, email, phone
    into customer_row
    from public.customers
   where tenant_id = p_tenant_id and id = intent_row.customer_id;
  if customer_row.id is null or nullif(pg_catalog.btrim(customer_row.full_name), '') is null then
    raise exception 'DTE_BOLETA39_CUSTOMER_NOT_FOUND';
  end if;

  insert into public.dte_boleta39_commercial_customer_snapshots(
    intent_id, tenant_id, customer_id, customer_name, customer_rut,
    customer_email, customer_phone, captured_by
  ) values (
    p_intent_id, p_tenant_id, customer_row.id,
    left(pg_catalog.btrim(customer_row.full_name), 180),
    nullif(customer_row.rut_normalized, ''),
    nullif(left(pg_catalog.lower(pg_catalog.btrim(customer_row.email)), 254), ''),
    nullif(left(pg_catalog.btrim(customer_row.phone), 32), ''),
    p_actor_id
  ) returning * into snapshot_row;

  return jsonb_build_object(
    'customer_id', snapshot_row.customer_id,
    'customer_name', snapshot_row.customer_name,
    'customer_rut', snapshot_row.customer_rut,
    'customer_email', snapshot_row.customer_email,
    'customer_phone', snapshot_row.customer_phone,
    'captured_at', snapshot_row.captured_at
  );
end;
$$;

revoke all on function public.capture_boleta39_commercial_customer_snapshot(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.capture_boleta39_commercial_customer_snapshot(uuid, uuid, uuid)
  to service_role;

comment on table public.dte_boleta39_commercial_customer_snapshots is
  'Append-only commercial customer identity frozen by the final manual type 39 confirmation. It is separate from the XML tax receiver.';

commit;
