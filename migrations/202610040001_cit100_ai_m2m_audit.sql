begin;

alter table public.ai_request_audit
  drop constraint if exists ai_request_audit_auth_mode_check;

alter table public.ai_request_audit
  alter column user_id drop not null,
  add column if not exists service_id text;

alter table public.ai_request_audit
  add constraint ai_request_audit_auth_mode_check
  check (auth_mode in ('tenant_members', 'platform_admin', 'm2m'));

alter table public.ai_request_audit
  drop constraint if exists ai_request_audit_actor_check;

alter table public.ai_request_audit
  add constraint ai_request_audit_actor_check
  check (
    (
      auth_mode in ('tenant_members', 'platform_admin')
      and user_id is not null
      and service_id is null
    )
    or
    (
      auth_mode = 'm2m'
      and user_id is null
      and service_id = 'n8n'
    )
  );

create or replace function public.begin_ai_service_request_audit(
  p_tenant_id uuid,
  p_service_id text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_daily_token_limit integer,
  p_reserved_tokens integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_used_tokens bigint;
begin
  if p_tenant_id is null
     or p_service_id <> 'n8n'
     or p_provider not in ('openai', 'local', 'hybrid')
     or length(coalesce(p_model, '')) not between 1 and 120
     or length(coalesce(p_prompt_version, '')) not between 1 and 120
     or p_daily_token_limit not between 1000 and 10000000
     or p_reserved_tokens not between 128 and 8192 then
    raise exception 'AI_AUDIT_INVALID_INPUT';
  end if;

  if not exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.lifecycle_status = 'active'
      and t.operational_mode in ('demo', 'live', 'internal')
  ) then
    raise exception 'AI_AUDIT_FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtext('citaya-ai:' || p_tenant_id::text));

  select coalesce(
    sum(
      case
        when status = 'started' then reserved_tokens
        else total_tokens
      end
    ),
    0
  )
  into v_used_tokens
  from public.ai_request_audit
  where tenant_id = p_tenant_id
    and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';

  if v_used_tokens + p_reserved_tokens > p_daily_token_limit then
    raise exception 'AI_DAILY_TOKEN_LIMIT';
  end if;

  insert into public.ai_request_audit (
    tenant_id,
    user_id,
    service_id,
    auth_mode,
    provider,
    model,
    prompt_version,
    reserved_tokens
  ) values (
    p_tenant_id,
    null,
    p_service_id,
    'm2m',
    p_provider,
    p_model,
    p_prompt_version,
    p_reserved_tokens
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.finish_ai_service_request_audit(
  p_request_id uuid,
  p_tenant_id uuid,
  p_service_id text,
  p_status text,
  p_tool_names text[],
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_duration_ms integer,
  p_effective_provider text default null,
  p_effective_model text default null,
  p_fallback_used boolean default false,
  p_provider_duration_ms integer default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_service_id <> 'n8n'
     or p_status not in ('succeeded', 'failed')
     or p_input_tokens < 0
     or p_output_tokens < 0
     or p_total_tokens < 0
     or p_total_tokens <> p_input_tokens + p_output_tokens
     or p_duration_ms < 0
     or (p_effective_provider not in ('openai', 'local') and p_effective_provider is not null)
     or (p_effective_provider is null) <> (p_effective_model is null)
     or (p_effective_model is not null and length(p_effective_model) not between 1 and 120)
     or (p_provider_duration_ms is not null and p_provider_duration_ms < 0)
     or cardinality(coalesce(p_tool_names, array[]::text[])) > 20 then
    return false;
  end if;

  update public.ai_request_audit
  set status = p_status,
      tool_names = to_jsonb(coalesce(p_tool_names, array[]::text[])),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      total_tokens = p_total_tokens,
      duration_ms = p_duration_ms,
      effective_provider = p_effective_provider,
      effective_model = p_effective_model,
      fallback_used = coalesce(p_fallback_used, false),
      provider_duration_ms = p_provider_duration_ms,
      error_code = case
        when p_error_code is null then null
        else left(p_error_code, 120)
      end,
      completed_at = now()
  where id = p_request_id
    and tenant_id = p_tenant_id
    and auth_mode = 'm2m'
    and user_id is null
    and service_id = p_service_id
    and status = 'started';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.begin_ai_service_request_audit(
  uuid, text, text, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.finish_ai_service_request_audit(
  uuid, uuid, text, text, text[], integer, integer, integer, integer,
  text, text, boolean, integer, text
) from public, anon, authenticated;

grant execute on function public.begin_ai_service_request_audit(
  uuid, text, text, text, text, integer, integer
) to service_role;
grant execute on function public.finish_ai_service_request_audit(
  uuid, uuid, text, text, text[], integer, integer, integer, integer,
  text, text, boolean, integer, text
) to service_role;

commit;
