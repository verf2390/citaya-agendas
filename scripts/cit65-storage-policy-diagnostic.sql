-- CIT-65 read-only pre/post-deployment diagnostic. Run manually in the target
-- Supabase SQL console before or after the migration is deployed through the
-- normal controlled process.

select id, name, public
  from storage.buckets
 order by id;

select policyname, roles, cmd, permissive, qual, with_check
  from pg_catalog.pg_policies
 where schemaname = 'storage'
   and tablename = 'objects'
 order by policyname;
