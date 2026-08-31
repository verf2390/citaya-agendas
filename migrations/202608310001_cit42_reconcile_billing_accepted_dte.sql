begin;

create or replace function public.billing_reconcile_accepted_production_dte(
  p_tenant_id uuid,
  p_intent_id uuid,
  p_production_document_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent_row public.dte_payment_document_intents%rowtype;
  document_row public.dte_production_documents%rowtype;
  sale_payment_row public.billing_sale_payments%rowtype;
  schedule_row public.billing_payment_schedule%rowtype;
  sale_row public.billing_sales%rowtype;
  coverage_row public.billing_sale_item_document_coverage%rowtype;
  allocation_row record;

  payment_relation_count bigint;
  allocation_count bigint;
  allocation_total bigint;
  inserted_count integer := 0;
begin
  if p_tenant_id is null
     or p_intent_id is null
     or p_production_document_id is null then
    raise exception 'DTE_BILLING_RECONCILIATION_INPUT_INVALID';
  end if;

  select *
    into intent_row
    from public.dte_payment_document_intents
   where tenant_id = p_tenant_id
     and id = p_intent_id
     and production_document_id = p_production_document_id
   for update;

  if not found then
    raise exception 'DTE_BILLING_INTENT_NOT_FOUND';
  end if;

  if intent_row.origin <> 'automatic_payment'
     or intent_row.resolved_dte_type not in (33,39)
     or intent_row.status not in ('ACCEPTED','ACCEPTED_WITH_OBJECTIONS')
     or intent_row.payment_intent_id is null then
    raise exception 'DTE_BILLING_INTENT_NOT_RECONCILABLE';
  end if;

  select *
    into document_row
    from public.dte_production_documents
   where tenant_id = p_tenant_id
     and id = p_production_document_id
   for share;

  if not found then
    raise exception 'DTE_BILLING_DOCUMENT_NOT_FOUND';
  end if;

  if document_row.dte_type <> intent_row.resolved_dte_type
     or document_row.total_amount <> intent_row.amount_snapshot then
    raise exception 'DTE_BILLING_DOCUMENT_SNAPSHOT_MISMATCH';
  end if;

  if pg_catalog.lower(coalesce(document_row.sii_status,'')) not in (
    'accepted',
    'epr',
    'aceptado',
    'dok',
    'accepted_with_observations',
    'accepted_with_objections',
    'eok'
  ) then
    raise exception 'DTE_BILLING_DOCUMENT_NOT_ACCEPTED';
  end if;

  select count(*)
    into payment_relation_count
    from public.billing_sale_payments
   where tenant_id = p_tenant_id
     and payment_intent_id = intent_row.payment_intent_id;

  if payment_relation_count <> 1 then
    raise exception 'DTE_BILLING_PAYMENT_RELATION_AMBIGUOUS';
  end if;

  select *
    into sale_payment_row
    from public.billing_sale_payments
   where tenant_id = p_tenant_id
     and payment_intent_id = intent_row.payment_intent_id
   for update;

  if sale_payment_row.status <> 'VERIFIED'
     or sale_payment_row.validation_result <> 'provider_verified'
     or sale_payment_row.reconciliation_status not in ('NOT_REQUIRED','REVIEW_REQUIRED')
     or sale_payment_row.schedule_id is null then
    raise exception 'DTE_BILLING_PAYMENT_NOT_RECONCILABLE';
  end if;

  if sale_payment_row.amount <> intent_row.amount_snapshot
     or sale_payment_row.amount <> document_row.total_amount then
    raise exception 'DTE_BILLING_PAYMENT_AMOUNT_MISMATCH';
  end if;

  -- The row lock fences concurrent allocation inserts through the real
  -- (tenant_id,schedule_id) foreign key while the exact allocation set is read.
  select *
    into schedule_row
    from public.billing_payment_schedule
   where tenant_id = p_tenant_id
     and id = sale_payment_row.schedule_id
   for update;

  if not found then
    raise exception 'DTE_BILLING_SCHEDULE_RELATION_INVALID';
  end if;

  if schedule_row.sale_id is distinct from sale_payment_row.sale_id
     or schedule_row.payment_intent_id is distinct from intent_row.payment_intent_id
     or schedule_row.amount is distinct from sale_payment_row.amount
     or schedule_row.paid_amount is distinct from schedule_row.amount
     or schedule_row.status <> 'PAID' then
    raise exception 'DTE_BILLING_SCHEDULE_RELATION_INVALID';
  end if;

  select *
    into sale_row
    from public.billing_sales
   where tenant_id = p_tenant_id
     and id = sale_payment_row.sale_id
   for update;

  if not found then
    raise exception 'DTE_BILLING_SALE_NOT_FOUND';
  end if;

  if sale_row.requested_document_type <> intent_row.resolved_dte_type then
    raise exception 'DTE_BILLING_SALE_DOCUMENT_TYPE_MISMATCH';
  end if;

  select count(*),
         coalesce(sum(allocated_amount),0)
    into allocation_count,
         allocation_total
    from public.billing_payment_schedule_allocations
   where tenant_id = p_tenant_id
     and schedule_id = schedule_row.id
     and sale_id = sale_row.id;

  if allocation_count < 1
     or allocation_total <> sale_payment_row.amount then
    raise exception 'DTE_BILLING_ALLOCATION_TOTAL_MISMATCH';
  end if;

  for allocation_row in
    select *
      from public.billing_payment_schedule_allocations
     where tenant_id = p_tenant_id
       and schedule_id = schedule_row.id
       and sale_id = sale_row.id
     order by position, id
  loop
    coverage_row := null;

    select *
      into coverage_row
      from public.billing_sale_item_document_coverage
     where tenant_id = p_tenant_id
       and payment_schedule_allocation_id = allocation_row.id
       and status <> 'VOID'
     for update;

    if found then
      if coverage_row.sale_id is distinct from sale_row.id
         or coverage_row.sale_item_id is distinct from allocation_row.sale_item_id
         or coverage_row.dte_type is distinct from intent_row.resolved_dte_type
         or coverage_row.amount_from is distinct from allocation_row.amount_from
         or coverage_row.amount_to is distinct from allocation_row.amount_to
         or coverage_row.status <> 'ACCEPTED'
         or coverage_row.coverage_source <> 'DTE'
         or coverage_row.sale_payment_id is distinct from sale_payment_row.id
         or coverage_row.production_document_id is distinct from p_production_document_id
         or coverage_row.document_relation_status <> 'VALIDATED' then
        raise exception 'DTE_BILLING_EXISTING_COVERAGE_CONFLICT';
      end if;

      continue;
    end if;

    if exists (
      select 1
        from public.billing_sale_item_document_coverage existing
       where existing.tenant_id = p_tenant_id
         and existing.sale_item_id = allocation_row.sale_item_id
         and existing.status <> 'VOID'
         and existing.amount_from < allocation_row.amount_to
         and existing.amount_to > allocation_row.amount_from
    ) then
      raise exception 'DTE_BILLING_COVERAGE_RANGE_CONFLICT';
    end if;

    insert into public.billing_sale_item_document_coverage(
      tenant_id,
      sale_id,
      sale_item_id,
      dte_type,
      amount_from,
      amount_to,
      status,
      coverage_source,
      sale_payment_id,
      payment_schedule_allocation_id,
      production_document_id,
      document_relation_status
    ) values (
      p_tenant_id,
      sale_row.id,
      allocation_row.sale_item_id,
      intent_row.resolved_dte_type,
      allocation_row.amount_from,
      allocation_row.amount_to,
      'ACCEPTED',
      'DTE',
      sale_payment_row.id,
      allocation_row.id,
      p_production_document_id,
      'VALIDATED'
    );

    inserted_count := inserted_count + 1;
  end loop;

  update public.billing_sales
     set tax_treatment_status = 'READY',
         updated_at = pg_catalog.now()
   where tenant_id = p_tenant_id
     and id = sale_row.id
     and tax_treatment_status = 'PENDING';

  update public.appointments appointment
     set tax_treatment_status = 'READY',
         updated_at = pg_catalog.now()
   where appointment.tenant_id = p_tenant_id
     and appointment.tax_treatment_status = 'PENDING'
     and exists (
       select 1
         from public.billing_sale_appointments sale_appointment
        where sale_appointment.tenant_id = p_tenant_id
          and sale_appointment.sale_id = sale_row.id
          and sale_appointment.appointment_id = appointment.id
     );

  if inserted_count > 0 then
    insert into public.dte_document_events(
      tenant_id,
      intent_id,
      production_document_id,
      event_type,
      safe_metadata
    )
    select
      p_tenant_id,
      p_intent_id,
      p_production_document_id,
      'BILLING_COVERAGE_RECONCILED',
      pg_catalog.jsonb_build_object(
        'coverageRows', inserted_count,
        'dteType', intent_row.resolved_dte_type,
        'automatic', true
      )
    where not exists (
      select 1
        from public.dte_document_events existing_event
       where existing_event.tenant_id = p_tenant_id
         and existing_event.intent_id = p_intent_id
         and existing_event.production_document_id = p_production_document_id
         and existing_event.event_type = 'BILLING_COVERAGE_RECONCILED'
    );
  end if;

  return inserted_count;
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
set search_path = ''
as $$
declare
  intent_id uuid;
  reconciliation_intent_id uuid;
  intent_payment_intent_id uuid;
  intent_origin text;
  intent_dte_type integer;
  status_changed boolean := false;
  billing_error text;
  billing_review_error text;
  billing_review_marked boolean := false;
begin
  if p_status not in (
    'SUBMITTED',
    'ACCEPTED',
    'ACCEPTED_WITH_OBJECTIONS',
    'REJECTED'
  ) then
    raise exception 'DTE_RECONCILIATION_STATUS_INVALID';
  end if;

  update public.dte_payment_document_intents
     set status = p_status,
         safe_blocking_reason = case
           when p_status = 'REJECTED' then 'SII_EXPLICIT_REJECTION'
           else null
         end,
         updated_at = pg_catalog.now()
   where tenant_id = p_tenant_id
     and production_document_id = p_production_document_id
     and status in ('SUBMITTING','SUBMITTED','AMBIGUOUS')
   returning id, payment_intent_id, origin, resolved_dte_type
        into intent_id, intent_payment_intent_id, intent_origin, intent_dte_type;

  if intent_id is not null then
    status_changed := true;
  else
    select id, payment_intent_id, origin, resolved_dte_type
      into intent_id, intent_payment_intent_id, intent_origin, intent_dte_type
      from public.dte_payment_document_intents
     where tenant_id = p_tenant_id
       and production_document_id = p_production_document_id
       and status = p_status;

    if intent_id is null then
      raise exception 'DTE_INTENT_NOT_FOUND';
    end if;
  end if;

  reconciliation_intent_id := intent_id;

  if p_status in ('ACCEPTED','ACCEPTED_WITH_OBJECTIONS')
     and intent_origin = 'automatic_payment'
     and intent_dte_type in (33,39) then
    begin
      perform public.billing_reconcile_accepted_production_dte(
        p_tenant_id,
        intent_id,
        p_production_document_id
      );
    exception
      when others then
        billing_error := pg_catalog.left(sqlerrm,120);

        -- A malformed billing relation can also make its update trigger fail.
        -- Keep that secondary failure inside its own subtransaction so the
        -- authoritative SII status written above is never rolled back.
        begin
          update public.billing_sale_payments
             set reconciliation_status = 'REVIEW_REQUIRED'
           where tenant_id = p_tenant_id
             and payment_intent_id = intent_payment_intent_id
             and status = 'VERIFIED';
          billing_review_marked := found;
        exception
          when others then
            billing_review_error := pg_catalog.left(sqlerrm,120);
        end;

        insert into public.dte_document_events(
          tenant_id,
          intent_id,
          production_document_id,
          event_type,
          actor_id,
          safe_metadata
        )
        select
          p_tenant_id,
          reconciliation_intent_id,
          p_production_document_id,
          'BILLING_COVERAGE_RECONCILIATION_BLOCKED',
          p_actor_id,
          pg_catalog.jsonb_build_object(
            'reason', billing_error,
            'reviewRequiredMarked', billing_review_marked,
            'reviewMarkError', billing_review_error,
            'automaticRetry', false
          )
        where not exists (
          select 1
            from public.dte_document_events existing_event
           where existing_event.tenant_id = p_tenant_id
             and existing_event.intent_id = reconciliation_intent_id
             and existing_event.production_document_id = p_production_document_id
             and existing_event.event_type = 'BILLING_COVERAGE_RECONCILIATION_BLOCKED'
        );
    end;
  end if;

  if status_changed then
    insert into public.dte_document_events(
      tenant_id,
      intent_id,
      production_document_id,
      event_type,
      actor_id,
      safe_metadata
    ) values (
      p_tenant_id,
      intent_id,
      p_production_document_id,
      'MANUAL_STATUS_RECONCILED',
      p_actor_id,
      pg_catalog.jsonb_build_object(
        'intentStatus', p_status,
        'siiStatus', pg_catalog.left(p_sii_status,32)
      )
    );
  end if;

  return intent_id;
end;
$$;


revoke all on function public.billing_reconcile_accepted_production_dte(
  uuid,uuid,uuid
) from public,anon,authenticated;

revoke all on function public.dte_reconcile_intent_status(
  uuid,uuid,text,text,uuid
) from public,anon,authenticated;

grant execute on function public.dte_reconcile_intent_status(
  uuid,uuid,text,text,uuid
) to service_role;

comment on function public.billing_reconcile_accepted_production_dte(
  uuid,uuid,uuid
) is
  'CIT-42: reconciles an accepted automatic production DTE with exact billing schedule allocations. Local-only and idempotent; never contacts SII.';

commit;
