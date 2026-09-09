begin;

-- CIT-67 provisions a new tenant in a fail-closed legal state:
--   sensitive_data_review_status = 'pending'
--   handles_sensitive_data       = null
--   sensitive_data_purpose       = null
--
-- The original tenant_legal_profiles_check predates the review-status model and
-- rejects that state. The newer tenant_legal_profiles_sensitive_review_shape is
-- the canonical constraint and explicitly permits pending review.
do $preflight$
declare
  shape_definition text;
  legacy_definition text;
  shape_validated boolean;
begin
  select pg_catalog.pg_get_constraintdef(constraint_record.oid),
         constraint_record.convalidated
    into shape_definition, shape_validated
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = 'public.tenant_legal_profiles'::pg_catalog.regclass
    and constraint_record.conname = 'tenant_legal_profiles_sensitive_review_shape'
    and constraint_record.contype = 'c';

  if shape_definition is null then
    raise exception
      'CIT67_LEGAL_PENDING_FIX_PREFLIGHT_FAILED: canonical sensitive review constraint is missing';
  end if;

  if shape_validated is not true then
    raise exception
      'CIT67_LEGAL_PENDING_FIX_PREFLIGHT_FAILED: canonical sensitive review constraint is not validated';
  end if;

  if pg_catalog.position('sensitive_data_review_status' in shape_definition) = 0
     or pg_catalog.position('pending' in shape_definition) = 0
     or pg_catalog.position('confirmed_no' in shape_definition) = 0
     or pg_catalog.position('confirmed_yes' in shape_definition) = 0 then
    raise exception
      'CIT67_LEGAL_PENDING_FIX_PREFLIGHT_FAILED: canonical sensitive review constraint has unexpected definition: %',
      shape_definition;
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
    into legacy_definition
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = 'public.tenant_legal_profiles'::pg_catalog.regclass
    and constraint_record.conname = 'tenant_legal_profiles_check'
    and constraint_record.contype = 'c';

  if legacy_definition is not null
     and (
       pg_catalog.position('handles_sensitive_data' in legacy_definition) = 0
       or pg_catalog.position('sensitive_data_purpose' in legacy_definition) = 0
       or pg_catalog.position('sensitive_data_review_status' in legacy_definition) > 0
     ) then
    raise exception
      'CIT67_LEGAL_PENDING_FIX_PREFLIGHT_FAILED: legacy constraint has unexpected definition: %',
      legacy_definition;
  end if;
end;
$preflight$;

alter table public.tenant_legal_profiles
  drop constraint if exists tenant_legal_profiles_check;

do $postflight$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.tenant_legal_profiles'::pg_catalog.regclass
      and constraint_record.conname = 'tenant_legal_profiles_check'
  ) then
    raise exception
      'CIT67_LEGAL_PENDING_FIX_POSTFLIGHT_FAILED: legacy constraint still exists';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.tenant_legal_profiles'::pg_catalog.regclass
      and constraint_record.conname = 'tenant_legal_profiles_sensitive_review_shape'
      and constraint_record.contype = 'c'
      and constraint_record.convalidated is true
  ) then
    raise exception
      'CIT67_LEGAL_PENDING_FIX_POSTFLIGHT_FAILED: canonical sensitive review constraint is missing or invalid';
  end if;
end;
$postflight$;

comment on constraint tenant_legal_profiles_sensitive_review_shape
  on public.tenant_legal_profiles is
  'Canonical sensitive-data review shape. Pending review intentionally permits NULL handles_sensitive_data and NULL sensitive_data_purpose.';

commit;
