begin;

-- Reuse the canonical RUT semantics introduced by the legal DTE activation
-- migration. Invalid historical values raise RUT_INVALID and roll back this
-- entire migration instead of becoming searchable through a lax comparison.
do $$
begin
  if to_regprocedure('public.normalize_chilean_rut(text)') is null then
    raise exception 'NORMALIZE_CHILEAN_RUT_REQUIRED';
  end if;
end;
$$;

update public.dte_production_tenant_settings
   set issuer_rut = public.normalize_chilean_rut(issuer_rut)
 where issuer_rut is distinct from public.normalize_chilean_rut(issuer_rut);

alter table public.dte_production_tenant_settings
  drop constraint if exists dte_production_tenant_settings_issuer_rut_canonical;
alter table public.dte_production_tenant_settings
  add constraint dte_production_tenant_settings_issuer_rut_canonical
  check (issuer_rut = public.normalize_chilean_rut(issuer_rut));

-- The older expression index still protects semantic uniqueness. This direct
-- index makes the canonical equality used by public verification indexable.
create unique index if not exists dte_production_tenant_settings_issuer_rut_canonical_uidx
  on public.dte_production_tenant_settings (issuer_rut);

comment on constraint dte_production_tenant_settings_issuer_rut_canonical
  on public.dte_production_tenant_settings is
  'Issuer RUT is persisted canonically as an undotted body plus hyphen and DV (for example 78195645-7).';

commit;
