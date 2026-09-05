-- CIT-65: replace the known historical deny-one-bucket storage policy with an
-- explicit, fail-closed policy set. Validate the identity of the policy before
-- trusting its historical name. This validation must precede every change.
do $$
declare
  public_read record;
  normalized_qual text;
begin
  select cmd, roles, permissive, qual
    into public_read
    from pg_catalog.pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and policyname = 'Public read';

  if found then
    normalized_qual := pg_catalog.regexp_replace(
      coalesce(public_read.qual, ''),
      '[[:space:]()]',
      '',
      'g'
    );

    if public_read.cmd is distinct from 'SELECT'
       or public_read.roles is distinct from array['public']::name[]
       or public_read.permissive is distinct from 'PERMISSIVE'
       or normalized_qual !~
          '^([a-z_][a-z0-9_]*\.)?bucket_id(::text)?<>''dte-production-private''(::text)?$'
    then
      raise exception 'CIT65_UNEXPECTED_PUBLIC_READ_POLICY';
    end if;
  end if;
end
$$;

-- Inspect every other SELECT/ALL policy before changing anything. An unknown
-- negative bucket policy may contain legitimate additional conditions and
-- requires manual review.
do $$
declare
  candidate record;
  normalized_qual text;
begin
  for candidate in
    select policyname, qual
      from pg_catalog.pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and cmd in ('SELECT', 'ALL')
       and policyname <> 'Public read'
     order by policyname
  loop
    normalized_qual := pg_catalog.regexp_replace(
      pg_catalog.lower(coalesce(candidate.qual, '')),
      '[[:space:]()]',
      '',
      'g'
    );

    if normalized_qual ~ 'bucket_id(<>|!=)'
       or normalized_qual ~ 'not(bucket_id|[a-z_][a-z0-9_]*\.bucket_id)='
       or normalized_qual ~ '(bucket_id|[a-z_][a-z0-9_]*\.bucket_id)isdistinctfrom'
    then
      raise exception using message =
        'CIT65_UNREVIEWED_NEGATIVE_STORAGE_POLICY:' || candidate.policyname;
    end if;
  end loop;
end
$$;

-- This is the only historical policy whose removal is pre-reviewed by CIT-65.
drop policy if exists "Public read" on storage.objects;

-- The metadata flag and the RLS policy are both kept fail-closed. This update
-- changes no object and is safe to repeat.
update storage.buckets
   set public = false
 where id = 'dte-production-private';

-- This policy explicitly documents the access needed by the DTE backend and
-- is defensive for installations where service_role participates in RLS.
-- Supabase service_role normally has BYPASSRLS, so this policy does not and
-- must not be treated as restricting that role to this bucket.
drop policy if exists dte_production_service_role_only on storage.objects;
create policy dte_production_service_role_only on storage.objects
  for all to service_role
  using (bucket_id = 'dte-production-private')
  with check (bucket_id = 'dte-production-private');
