-- Run only inside the externally controlled migration transaction. Fixtures
-- are isolated by this savepoint and are always rolled back before COMMIT.
\set ON_ERROR_STOP on

savepoint boleta39_production_smoke;

create temporary table boleta39_smoke_context on commit drop as
with distinct_memberships as (
  select distinct on (tm.tenant_id)
    tm.tenant_id,
    tm.user_id
  from public.tenant_members tm
  where tm.is_active is true
    and lower(tm.role) in ('owner','admin')
  order by tm.tenant_id,tm.user_id
),
memberships as (
  select *,row_number() over (order by tenant_id) as ordinal
  from distinct_memberships
)
select
  (select tenant_id from memberships where ordinal=1) as tenant_id,
  (select user_id from memberships where ordinal=1) as owner_user_id,
  (select user_id from memberships where ordinal=2) as other_user_id,
  gen_random_uuid() as customer_id,
  gen_random_uuid() as sale_id,
  gen_random_uuid() as draft_id,
  (select count(*) from public.dte_issuance_outbox
    where status in ('PENDING','PROCESSING')) as executable_outbox_before,
  (select count(*) from public.dte_production_folio_ledger
    where state='reserved') as reserved_folios_before;

do $$
begin
  if exists (
    select 1 from boleta39_smoke_context
     where tenant_id is null or owner_user_id is null or other_user_id is null
  ) then
    raise exception 'BOLETA39_SMOKE_REQUIRES_TWO_TENANT_IDENTITIES';
  end if;
end;
$$;

insert into public.customers(id,tenant_id,full_name,email,rut_normalized)
select customer_id,tenant_id,'Consumidor PRE-CAF smoke',
  'boleta39-smoke@example.invalid','66666666-6'
from boleta39_smoke_context;

insert into public.billing_sales(
  id,tenant_id,customer_id,status,net_amount,tax_amount,total_amount,
  paid_amount,requested_document_type
)
select sale_id,tenant_id,customer_id,'DRAFT',37798,7182,44980,0,39
from boleta39_smoke_context;

insert into public.billing_sale_items(
  tenant_id,sale_id,position,description,quantity,unit_net_amount,
  discount_amount,net_amount,tax_amount,total_amount,pricing_mode,
  catalog_unit_gross_amount,service_snapshot
)
select tenant_id,sale_id,1,'Servicio bruto 14990',1,12597,0,12597,2393,
  14990,'catalog_gross',14990,'{"fixture":"boleta39-pre-caf"}'::jsonb
from boleta39_smoke_context
union all
select tenant_id,sale_id,2,'Servicio bruto 29990',1,25201,0,25201,4789,
  29990,'catalog_gross',29990,'{"fixture":"boleta39-pre-caf"}'::jsonb
from boleta39_smoke_context;

insert into public.dte_invoice_drafts(
  id,tenant_id,sale_id,customer_id,dte_type,source,status,issuer_preview,
  recipient_preview,net_amount,tax_amount,total_amount,review_reason,
  operational_reason
)
select draft_id,tenant_id,sale_id,customer_id,39,'manual','REVIEW_REQUIRED',
  '{}'::jsonb,'{"rut":"66666666-6"}'::jsonb,37798,7182,44980,
  'PRE_CAF_ISSUANCE_DISABLED','BOLETA39_PRE_CAF_PRODUCTION_SMOKE'
from boleta39_smoke_context;

insert into public.dte_invoice_draft_lines(
  tenant_id,draft_id,position,description,quantity,unit_net_amount,
  discount_amount,net_amount,tax_amount,total_amount,pricing_mode,
  catalog_unit_gross_amount,catalog_snapshot
)
select tenant_id,draft_id,1,'Servicio bruto 14990',1,12597,0,12597,2393,
  14990,'catalog_gross',14990,
  '{"fixture":"boleta39-pre-caf","unitGrossAmount":14990}'::jsonb
from boleta39_smoke_context
union all
select tenant_id,draft_id,2,'Servicio bruto 29990',1,25201,0,25201,4789,
  29990,'catalog_gross',29990,
  '{"fixture":"boleta39-pre-caf","unitGrossAmount":29990}'::jsonb
from boleta39_smoke_context;

grant select on boleta39_smoke_context to authenticated;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select owner_user_id::text from boleta39_smoke_context),
  true
);
do $$
begin
  if (
    select count(*) from public.dte_invoice_drafts
     where operational_reason='BOLETA39_PRE_CAF_PRODUCTION_SMOKE'
  )<>1 then
    raise exception 'BOLETA39_OWNER_RLS_DENIED';
  end if;
end;
$$;
select set_config(
  'request.jwt.claim.sub',
  (select other_user_id::text from boleta39_smoke_context),
  true
);
do $$
begin
  if (
    select count(*) from public.dte_invoice_drafts
     where operational_reason='BOLETA39_PRE_CAF_PRODUCTION_SMOKE'
  )<>0 then
    raise exception 'BOLETA39_CROSS_TENANT_RLS_LEAK';
  end if;
  if has_table_privilege(
    'authenticated','public.dte_invoice_drafts','UPDATE'
  ) then
    raise exception 'BOLETA39_CROSS_TENANT_UPDATE_GRANTED';
  end if;
end;
$$;
reset role;

do $$
begin
  if exists (
    select 1 from boleta39_smoke_context c
    where c.executable_outbox_before <> (
      select count(*) from public.dte_issuance_outbox
       where status in ('PENDING','PROCESSING')
    ) or c.reserved_folios_before <> (
      select count(*) from public.dte_production_folio_ledger
       where state='reserved'
    )
  ) then
    raise exception 'BOLETA39_SMOKE_TOUCHED_OUTBOX_OR_FOLIOS';
  end if;
  if 37798+7182<>44980 then raise exception 'BOLETA39_SMOKE_TOTALS_INVALID'; end if;
end;
$$;

rollback to savepoint boleta39_production_smoke;

do $$
begin
  if exists (
    select 1 from public.dte_invoice_drafts
     where operational_reason='BOLETA39_PRE_CAF_PRODUCTION_SMOKE'
  ) then
    raise exception 'BOLETA39_SMOKE_FIXTURE_ROLLBACK_FAILED';
  end if;
  if to_regclass('public.dte_tenant_document_capabilities') is null then
    raise exception 'BOLETA39_MIGRATION_STRUCTURE_MISSING';
  end if;
end;
$$;
