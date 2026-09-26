-- CIT-97: quota reservations protect concurrent requests, but completed
-- requests must count their actual token usage. A reservation is not billable usage.
--
-- Before this migration every completed request counted at least reserved_tokens,
-- so zero-token deterministic reads exhausted a tenant's daily AI quota.

create or replace function public.begin_ai_request_audit(
  p_tenant_id uuid,
  p_user_id uuid,
  p_auth_mode text,
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
  if p_tenant_id is null or p_user_id is null
     or p_auth_mode not in ('tenant_members', 'platform_admin')
     or p_provider not in ('openai', 'local', 'hybrid')
     or length(coalesce(p_model, '')) not between 1 and 120
     or length(coalesce(p_prompt_version, '')) not between 1 and 120
     or p_daily_token_limit not between 1000 and 10000000
     or p_reserved_tokens not between 128 and 8192 then
    raise exception 'AI_AUDIT_INVALID_INPUT';
  end if;

  if (
    p_auth_mode = 'tenant_members'
    and not public.is_tenant_member(p_tenant_id, p_user_id)
  ) or (
    p_auth_mode = 'platform_admin'
    and not public.is_platform_admin(p_user_id)
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
    auth_mode,
    provider,
    model,
    prompt_version,
    reserved_tokens
  ) values (
    p_tenant_id,
    p_user_id,
    p_auth_mode,
    p_provider,
    p_model,
    p_prompt_version,
    p_reserved_tokens
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.begin_ai_request_audit(
  uuid, uuid, text, text, text, text, integer, integer
) from public, anon, authenticated;

grant execute on function public.begin_ai_request_audit(
  uuid, uuid, text, text, text, text, integer, integer
) to service_role;
