begin;

create table if not exists public.ai_tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  provider text not null default 'openai'
    check (provider in ('openai', 'local', 'hybrid')),
  model_override text,
  prompt_version text not null default 'citaya-app-assistant-v1',
  requests_per_minute integer not null default 10
    check (requests_per_minute between 1 and 60),
  daily_token_limit integer not null default 50000
    check (daily_token_limit between 1000 and 10000000),
  max_output_tokens integer not null default 800
    check (max_output_tokens between 128 and 4096),
  timeout_ms integer not null default 20000
    check (timeout_ms between 1000 and 120000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (model_override is null or length(model_override) between 1 and 120),
  check (length(prompt_version) between 1 and 120)
);

create table if not exists public.ai_request_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  auth_mode text not null check (auth_mode in ('tenant_members', 'platform_admin')),
  provider text not null check (provider in ('openai', 'local', 'hybrid')),
  model text not null check (length(model) between 1 and 120),
  effective_provider text
    check (effective_provider is null or effective_provider in ('openai', 'local')),
  effective_model text
    check (effective_model is null or length(effective_model) between 1 and 120),
  fallback_used boolean not null default false,
  provider_duration_ms integer
    check (provider_duration_ms is null or provider_duration_ms >= 0),
  prompt_version text not null check (length(prompt_version) between 1 and 120),
  status text not null default 'started'
    check (status in ('started', 'succeeded', 'failed')),
  tool_names jsonb not null default '[]'::jsonb
    check (jsonb_typeof(tool_names) = 'array'),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  reserved_tokens integer not null default 0 check (reserved_tokens >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_request_audit_tenant_created_idx
  on public.ai_request_audit (tenant_id, created_at desc);

alter table public.ai_tenant_settings enable row level security;
alter table public.ai_request_audit enable row level security;

drop policy if exists ai_tenant_settings_member_read
  on public.ai_tenant_settings;
create policy ai_tenant_settings_member_read
  on public.ai_tenant_settings
  for select
  to authenticated
  using (
    public.is_tenant_member(tenant_id, auth.uid())
    or public.is_platform_admin(auth.uid())
  );

drop policy if exists ai_request_audit_member_read
  on public.ai_request_audit;
create policy ai_request_audit_member_read
  on public.ai_request_audit
  for select
  to authenticated
  using (
    public.is_tenant_member(tenant_id, auth.uid())
    or public.is_platform_admin(auth.uid())
  );

revoke all on public.ai_tenant_settings from anon, authenticated;
revoke all on public.ai_request_audit from anon, authenticated;
grant select on public.ai_tenant_settings to authenticated;
grant select on public.ai_request_audit to authenticated;

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

  select coalesce(sum(greatest(total_tokens, reserved_tokens)), 0)
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

create or replace function public.finish_ai_request_audit(
  p_request_id uuid,
  p_tenant_id uuid,
  p_user_id uuid,
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
  if p_status not in ('succeeded', 'failed')
     or p_input_tokens < 0
     or p_output_tokens < 0
     or p_total_tokens < 0
     or p_duration_ms < 0
     or p_effective_provider not in ('openai', 'local') and p_effective_provider is not null
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
    and user_id = p_user_id
    and status = 'started';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.begin_ai_request_audit(
  uuid, uuid, text, text, text, text, integer, integer
) from public;
revoke all on function public.finish_ai_request_audit(
  uuid, uuid, uuid, text, text[], integer, integer, integer, integer,
  text, text, boolean, integer, text
) from public;
grant execute on function public.begin_ai_request_audit(
  uuid, uuid, text, text, text, text, integer, integer
) to service_role;
grant execute on function public.finish_ai_request_audit(
  uuid, uuid, uuid, text, text[], integer, integer, integer, integer,
  text, text, boolean, integer, text
) to service_role;


create or replace function public.get_ai_usage_summary(
  p_tenant_id uuid,
  p_user_id uuid,
  p_auth_mode text,
  p_since timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  v_result jsonb;
begin
  if p_tenant_id is null
     or p_user_id is null
     or p_auth_mode not in ('tenant_members', 'platform_admin')
     or p_since is null
     or p_since < now() - interval '31 days'
     or p_since > now() then
    raise exception 'AI_USAGE_INVALID_INPUT';
  end if;

  if (
    p_auth_mode = 'tenant_members'
    and not public.is_tenant_member(p_tenant_id, p_user_id)
  ) or (
    p_auth_mode = 'platform_admin'
    and not public.is_platform_admin(p_user_id)
  ) then
    raise exception 'AI_USAGE_FORBIDDEN';
  end if;

  select jsonb_build_object(
    'requests', count(*),
    'succeeded', count(*) filter (where status = 'succeeded'),
    'failed', count(*) filter (where status = 'failed'),
    'local_requests', count(*) filter (where effective_provider = 'local'),
    'cloud_requests', count(*) filter (where effective_provider = 'openai'),
    'fallback_requests', count(*) filter (where fallback_used),
    'total_tokens', coalesce(sum(total_tokens), 0),
    'cloud_tokens', coalesce(
      sum(total_tokens) filter (where effective_provider = 'openai'),
      0
    ),
    'avg_duration_ms', coalesce(round(avg(duration_ms)), 0),
    'avg_provider_duration_ms', coalesce(round(avg(provider_duration_ms)), 0)
  )
  into v_result
  from public.ai_request_audit
  where tenant_id = p_tenant_id
    and created_at >= p_since;

  return coalesce(v_result, '{}'::jsonb);
end;
$;

revoke all on function public.get_ai_usage_summary(
  uuid, uuid, text, timestamptz
) from public;
grant execute on function public.get_ai_usage_summary(
  uuid, uuid, text, timestamptz
) to service_role;

commit;
