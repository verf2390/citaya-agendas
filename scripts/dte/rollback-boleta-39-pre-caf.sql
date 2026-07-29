-- Execute only during an explicitly authorized rollback window.
drop trigger if exists dte_intent_mirror_boleta_draft
  on public.dte_payment_document_intents;
drop function if exists public.dte_mirror_boleta_intent_to_draft();
drop trigger if exists dte_intent_00_explicit_document_selection
  on public.dte_payment_document_intents;
drop function if exists public.dte_apply_explicit_document_selection();
drop trigger if exists dte_draft_document_type_guard
  on public.dte_invoice_drafts;
drop function if exists public.dte_draft_document_type_guard();
drop trigger if exists dte_billing_sale_document_selection_guard
  on public.billing_sales;
drop function if exists public.dte_billing_sale_document_selection_guard();
drop trigger if exists dte_billing_sale_00_default_document_selection
  on public.billing_sales;
drop function if exists public.dte_billing_sale_default_document_selection();
drop trigger if exists dte_appointment_document_selection_guard
  on public.appointments;
drop function if exists public.dte_appointment_document_selection_guard();
drop policy if exists dte_tenant_document_capabilities_tenant_read
  on public.dte_tenant_document_capabilities;
drop table if exists public.dte_tenant_document_capabilities;
alter table public.dte_invoice_drafts
  drop constraint if exists dte_invoice_drafts_dte_type_check;
alter table public.dte_invoice_drafts
  add constraint dte_invoice_drafts_dte_type_check check (dte_type=33);
alter table public.dte_production_documents
  drop constraint if exists dte_production_documents_dte_type_check;
alter table public.dte_production_documents
  add constraint dte_production_documents_dte_type_check
  check (dte_type in (33,56,61));
alter table public.dte_production_cafs
  drop constraint if exists dte_production_cafs_dte_type_check;
alter table public.dte_production_cafs
  add constraint dte_production_cafs_dte_type_check
  check (dte_type in (33,56,61));
alter table public.dte_production_folio_ledger
  drop constraint if exists dte_production_folio_ledger_dte_type_check;
alter table public.dte_production_folio_ledger
  add constraint dte_production_folio_ledger_dte_type_check
  check (dte_type in (33,56,61));
alter table public.billing_sales
  drop column if exists document_selection_locked_at,
  drop column if exists requested_document_type;
update public.appointments
   set requested_document_type=39
 where requested_document_type is null;
alter table public.appointments
  alter column requested_document_type set default 39,
  alter column requested_document_type set not null,
  drop column if exists tax_document_selection_locked_at,
  drop column if exists tax_document_selection;
