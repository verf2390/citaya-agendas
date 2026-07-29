begin;

alter table public.dte_issuance_outbox
  add column if not exists lease_expires_at timestamptz;

create index if not exists dte_issuance_outbox_manual_lease_idx
  on public.dte_issuance_outbox(status, lease_expires_at, available_at, created_at);

create or replace function public.dte_claim_manual_issuance_outbox(
  p_worker_id text
) returns setof public.dte_issuance_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  stale record;
  claimed public.dte_issuance_outbox%rowtype;
  stale_reason text;
  stale_ambiguous boolean;
begin
  if p_worker_id !~ '^[A-Za-z0-9:_-]{3,100}$' then
    raise exception 'DTE_WORKER_ID_INVALID';
  end if;

  -- A crashed process never causes an implicit retry. Expired work is made
  -- visible and requires an explicit authorized recovery decision.
  for stale in
    select
      o.id as outbox_id,
      o.tenant_id,
      o.intent_id,
      i.production_document_id,
      i.network_attempt_count,
      exists (
        select 1
          from public.dte_production_submission_attempts s
         where s.tenant_id = o.tenant_id
           and s.document_id = i.production_document_id
           and s.before_fetch_at is not null
      ) as fetch_started
      from public.dte_issuance_outbox o
      join public.dte_payment_document_intents i
        on i.tenant_id = o.tenant_id and i.id = o.intent_id
     where o.status = 'PROCESSING'
       and o.lease_expires_at is not null
       and o.lease_expires_at <= now()
       and i.trigger_source = 'manual_admin'
       and i.origin in (
         'manual_standalone',
         'manual_appointment',
         'manual_payment',
         'credit_note',
         'debit_note'
       )
     for update of o skip locked
  loop
    stale_ambiguous := stale.network_attempt_count > 0 or stale.fetch_started;
    stale_reason := case
      when stale_ambiguous then 'NETWORK_RESULT_UNKNOWN'
      else 'WORKER_LEASE_EXPIRED_EXPLICIT_RETRY_REQUIRED'
    end;

    update public.dte_payment_document_intents
       set status = case when stale_ambiguous then 'AMBIGUOUS' else 'BLOCKED' end,
           safe_blocking_reason = stale_reason,
           network_attempt_count = case when stale_ambiguous then 1 else network_attempt_count end,
           updated_at = now()
     where tenant_id = stale.tenant_id
       and id = stale.intent_id
       and status in ('PENDING','PREPARING','READY','SUBMITTING');

    update public.dte_issuance_outbox
       set status = 'BLOCKED',
           network_attempts = case when stale_ambiguous then 1 else network_attempts end,
           last_safe_error = stale_reason,
           lease_expires_at = null,
           updated_at = now()
     where id = stale.outbox_id
       and tenant_id = stale.tenant_id
       and status = 'PROCESSING';

    insert into public.dte_document_events(
      tenant_id,
      intent_id,
      production_document_id,
      event_type,
      safe_metadata
    ) values (
      stale.tenant_id,
      stale.intent_id,
      stale.production_document_id,
      case when stale_ambiguous
        then 'SUBMISSION_AMBIGUOUS'
        else 'WORKER_LEASE_EXPIRED'
      end,
      jsonb_build_object(
        'reason', stale_reason,
        'automaticRetry', false,
        'retryRequiresExplicitAuthorization', true
      )
    );
  end loop;

  select o.*
    into claimed
    from public.dte_issuance_outbox o
    join public.dte_payment_document_intents i
      on i.tenant_id = o.tenant_id and i.id = o.intent_id
    join public.dte_tenant_issuance_settings cfg
      on cfg.tenant_id = o.tenant_id
   where o.status = 'PENDING'
     and i.status = 'PENDING'
     and o.available_at <= now()
     and i.trigger_source = 'manual_admin'
     and i.origin in (
       'manual_standalone',
       'manual_appointment',
       'manual_payment',
       'credit_note',
       'debit_note'
     )
     and i.resolved_dte_type in (33,56,61)
     and cfg.production_enabled = true
     and not exists (
       select 1
         from public.dte_issuance_outbox active
        where active.tenant_id = o.tenant_id
          and active.status = 'PROCESSING'
     )
   order by o.created_at
   for update of o skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.dte_issuance_outbox
     set status = 'PROCESSING',
         locked_at = now(),
         locked_by = p_worker_id,
         lease_expires_at = now() + interval '15 minutes',
         updated_at = now()
   where id = claimed.id
     and tenant_id = claimed.tenant_id
     and status = 'PENDING'
   returning * into claimed;

  if found then
    return next claimed;
  end if;
end;
$$;

revoke all on function public.dte_claim_manual_issuance_outbox(text)
  from public, anon, authenticated;
grant execute on function public.dte_claim_manual_issuance_outbox(text)
  to service_role;

comment on function public.dte_claim_manual_issuance_outbox(text) is
  'Claims one eligible manual DTE outbox with a durable lease. Automatic payment intents and canceled/blocked rows are never selected; expired leases fail closed without retry.';

commit;
