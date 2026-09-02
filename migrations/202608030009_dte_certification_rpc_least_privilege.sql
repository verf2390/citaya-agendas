-- Restrict mutable Boleta 39 certification RPCs to service_role only.
-- Additive permission hardening; no tables, CAFs, folios or artifacts are changed.

revoke all privileges on function
  public.import_dte_certification_caf(
    uuid,text,integer,text,text,text,text,integer,integer,date,
    text,text,uuid,timestamptz,text
  )
from public, anon, authenticated;

revoke all privileges on function
  public.begin_dte_certification_run(
    uuid,text,integer,uuid,text,jsonb,uuid,text
  )
from public, anon, authenticated;

revoke all privileges on function
  public.validate_dte_certification_run(
    uuid,uuid,jsonb,jsonb,text
  )
from public, anon, authenticated;

revoke all privileges on function
  public.fail_dte_certification_run(
    uuid,uuid,text,text
  )
from public, anon, authenticated;

grant execute on function
  public.import_dte_certification_caf(
    uuid,text,integer,text,text,text,text,integer,integer,date,
    text,text,uuid,timestamptz,text
  )
to service_role;

grant execute on function
  public.begin_dte_certification_run(
    uuid,text,integer,uuid,text,jsonb,uuid,text
  )
to service_role;

grant execute on function
  public.validate_dte_certification_run(
    uuid,uuid,jsonb,jsonb,text
  )
to service_role;

grant execute on function
  public.fail_dte_certification_run(
    uuid,uuid,text,text
  )
to service_role;
