-- Ensure pgcrypto digest() is resolvable from the payment -> DTE automatic chain.
-- pgcrypto is installed in schema extensions, while these SECURITY DEFINER
-- functions were deployed with search_path=public only.

alter function public.finalize_verified_payment(
  uuid,
  text,
  text,
  jsonb
)
set search_path = public, extensions;

alter function public.billing_create_payment_review_document(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text
)
set search_path = public, extensions;

alter function public.dte_enqueue_payment_snapshot(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid
)
set search_path = public, extensions;
