begin;

-- CIT-72 safety guard: the current billing initializer still requires a
-- commercial DTE selection (33/39). Until billing is document-independent,
-- external BHE tenants must keep Citaya payment collection disabled.
-- This prevents representing an external BHE service as DTE 39 merely to make
-- the payment pipeline work.

alter table public.tenant_operational_features
  drop constraint if exists tenant_operational_features_external_bhe_payments_off;

alter table public.tenant_operational_features
  add constraint tenant_operational_features_external_bhe_payments_off
  check (
    tax_document_mode <> 'external_bhe'
    or payments_enabled = false
  );

comment on constraint tenant_operational_features_external_bhe_payments_off
  on public.tenant_operational_features is
  'Temporary fail-closed guard: external BHE cannot use Citaya payment collection until billing is decoupled from DTE 33/39.';

commit;
