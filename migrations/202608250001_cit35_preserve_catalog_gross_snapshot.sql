-- CIT-35: preserve catalog-gross semantics in automatic Factura 33 snapshots.
--
-- Trigger order is significant and PostgreSQL fires same-event triggers by
-- name: complete_snapshot -> enrich_catalog_gross -> freeze_final_tax_snapshot.
-- The enrichment is deliberately a no-op unless one verified payment maps to
-- one fully paid, affected catalog-gross billing item with exact CLP totals.

create or replace function public.dte_intent_enrich_catalog_gross_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  billing_item record;
  billing_item_count integer;
begin
  if new.status <> 'PENDING'
     or new.resolved_dte_type <> 33
     or new.origin <> 'automatic_payment'
     or new.payment_intent_id is null then
    return new;
  end if;

  select count(*)
    into billing_item_count
    from public.billing_sale_payments payment
    join public.billing_sale_items item
      on item.tenant_id = payment.tenant_id
     and item.sale_id = payment.sale_id
   where payment.tenant_id = new.tenant_id
     and payment.payment_intent_id = new.payment_intent_id
     and payment.status = 'VERIFIED'
     and payment.validation_result = 'provider_verified'
     and payment.reconciliation_status = 'NOT_REQUIRED'
     and payment.currency = 'CLP'
     and payment.amount = new.amount_snapshot;

  if billing_item_count <> 1 then
    return new;
  end if;

  select item.*
    into billing_item
    from public.billing_sale_payments payment
    join public.billing_sale_items item
      on item.tenant_id = payment.tenant_id
     and item.sale_id = payment.sale_id
   where payment.tenant_id = new.tenant_id
     and payment.payment_intent_id = new.payment_intent_id
     and payment.status = 'VERIFIED'
     and payment.validation_result = 'provider_verified'
     and payment.reconciliation_status = 'NOT_REQUIRED'
     and payment.currency = 'CLP'
     and payment.amount = new.amount_snapshot;

  if billing_item.quantity is distinct from 1
     or billing_item.discount_basis_points is distinct from 0
     or billing_item.tax_treatment_snapshot is distinct from 'affected'
     or billing_item.pricing_mode is distinct from 'catalog_gross'
     or billing_item.unit_net_amount is null
     or billing_item.unit_net_amount <= 0
     or billing_item.net_amount is distinct from billing_item.unit_net_amount
     or billing_item.tax_amount is null
     or billing_item.tax_amount <= 0
     or billing_item.net_amount + billing_item.tax_amount
       is distinct from billing_item.total_amount
     or billing_item.total_amount is distinct from new.amount_snapshot
     or billing_item.catalog_unit_gross_amount
       is distinct from billing_item.total_amount then
    return new;
  end if;

  new.immutable_snapshot := jsonb_set(
    new.immutable_snapshot,
    '{lines}',
    jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'serviceId', billing_item.service_id,
      'appointmentId', billing_item.appointment_id,
      'position', billing_item.position,
      'description', billing_item.description,
      'quantity', billing_item.quantity,
      'unitNetAmount', billing_item.unit_net_amount,
      'discountBasisPoints', billing_item.discount_basis_points,
      'discountAmount', billing_item.discount_amount,
      'netAmount', billing_item.net_amount,
      'taxAmount', billing_item.tax_amount,
      'totalAmount', billing_item.total_amount,
      'grossAmount', billing_item.total_amount,
      'pricingMode', billing_item.pricing_mode,
      'catalogUnitGrossAmount', billing_item.catalog_unit_gross_amount
    ))),
    true
  );
  return new;
end;
$$;

drop trigger if exists dte_intent_enrich_catalog_gross_snapshot
  on public.dte_payment_document_intents;
create trigger dte_intent_enrich_catalog_gross_snapshot
before insert on public.dte_payment_document_intents
for each row execute function public.dte_intent_enrich_catalog_gross_snapshot();

comment on function public.dte_intent_enrich_catalog_gross_snapshot() is
  'CIT-35: preserves exact catalog-gross billing item semantics before the final immutable DTE tax snapshot is frozen.';
