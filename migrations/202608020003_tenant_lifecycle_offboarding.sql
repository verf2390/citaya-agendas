-- Archiving is a reversible operational lock, never a deletion. No tenant is
-- archived by this migration; invocation requires a separately authorised run.
alter table public.tenants
  add column if not exists lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active','archived')),
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid,
  add column if not exists archive_reason text,
  add constraint tenants_archive_shape check (
    (lifecycle_status='active' and archived_at is null) or
    (lifecycle_status='archived' and archived_at is not null and length(trim(coalesce(archive_reason,''))) between 10 and 500)
  );

create or replace function public.tenant_is_operational(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.tenants where id=p_tenant_id and lifecycle_status='active');
$$;

create or replace function public.assert_tenant_operational_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.tenant_is_operational(new.tenant_id) then raise exception 'TENANT_ARCHIVED'; end if;
  return new;
end;
$$;

create trigger appointments_tenant_operational before insert on public.appointments
for each row execute function public.assert_tenant_operational_trigger();
create trigger payment_intents_tenant_operational before insert on public.payment_intents
for each row execute function public.assert_tenant_operational_trigger();
create trigger dte_intents_tenant_operational before insert on public.dte_payment_document_intents
for each row execute function public.assert_tenant_operational_trigger();

create or replace function public.archive_tenant_for_offboarding(
  p_tenant_id uuid,p_actor_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  if length(trim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'ARCHIVE_REASON_REQUIRED'; end if;
  if not public.is_platform_admin(p_actor_id) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  update public.tenants set lifecycle_status='archived',archived_at=now(),archived_by=p_actor_id,
    archive_reason=trim(p_reason) where id=p_tenant_id and lifecycle_status='active';
  get diagnostics changed=row_count;
  if changed=0 then raise exception 'TENANT_NOT_ACTIVE'; end if;
  update public.tenant_members set is_active=false where tenant_id=p_tenant_id and is_active=true;
  update public.services set is_active=false where tenant_id=p_tenant_id and is_active=true;
  update public.tenant_payment_settings set active=false,updated_at=now()
    where tenant_id=p_tenant_id and active=true;
  update public.dte_tenant_issuance_settings set production_enabled=false,issuance_mode='manual',updated_at=now()
    where tenant_id=p_tenant_id;
  update public.dte_tenant_document_capabilities set customer_selection_enabled=false,
    admin_draft_enabled=false,issuance_enabled=false,updated_at=now() where tenant_id=p_tenant_id;
  return jsonb_build_object(
    'tenantId',p_tenant_id,'archived',true,'historicalRecordsPreserved',true,
    'externalSecretRevocationRequired',true,'contractualExportReviewRequired',true,
    'futureOperationalAnonymizationReviewRequired',true
  );
end;
$$;

revoke all on function public.tenant_is_operational(uuid),
  public.archive_tenant_for_offboarding(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.tenant_is_operational(uuid) to service_role,authenticated;
grant execute on function public.archive_tenant_for_offboarding(uuid,uuid,text) to service_role;

comment on column public.tenants.lifecycle_status is 'Archived tenants retain legal, accounting, tax and consent history but cannot create operations.';
comment on function public.archive_tenant_for_offboarding(uuid,uuid,text) is 'Explicit offboarding step. External integration secrets must be revoked separately and audited.';
