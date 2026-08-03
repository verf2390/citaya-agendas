\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.dte_certification_runs') is not null and
     (exists(select 1 from public.dte_certification_runs)
      or exists(select 1 from public.dte_certification_artifacts)) then
    raise exception 'DTE_CERTIFICATION_ROLLBACK_REFUSED_HISTORY_EXISTS';
  end if;
end;
$$;

drop function if exists public.dte_certification_inventory(uuid);
drop function if exists public.fail_dte_certification_run(uuid,uuid,text,text);
drop function if exists public.validate_dte_certification_run(uuid,uuid,jsonb,jsonb,text);
drop function if exists public.begin_dte_certification_run(uuid,text,integer,uuid,text,jsonb,uuid,text);
drop function if exists public.import_dte_certification_caf(uuid,text,integer,text,text,text,text,integer,integer,date,text,text,uuid,timestamptz,text);
drop table if exists public.dte_certification_artifacts;
drop table if exists public.dte_certification_folios;
drop table if exists public.dte_certification_runs;
drop table if exists public.dte_certification_cafs;
drop function if exists public.dte_certification_artifact_guard();
drop function if exists public.dte_certification_run_guard();
drop function if exists public.dte_certification_folio_transition_guard();
