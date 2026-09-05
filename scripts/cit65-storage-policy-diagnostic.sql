-- CIT-65 read-only post-deployment diagnostic. Run manually in the target
-- Supabase SQL console after the migration has been deployed through the
-- normal controlled process.

select id, name, public
  from storage.buckets
 order by id;

select policyname, roles, cmd, qual, with_check
  from pg_catalog.pg_policies
 where schemaname = 'storage'
   and tablename = 'objects'
 order by policyname;
