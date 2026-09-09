-- CIT-64: public discovery must not expose private tenant contact fields.
-- Prepared for review only; apply separately through the migration process.
begin;

drop policy if exists temp_allow_select_for_subdomain on public.tenants;

revoke select on public.tenants from anon;

-- Table-level REVOKE does not remove pre-existing column-level grants.
-- Reset SELECT on every current column, including address and phone_display,
-- before restoring the explicit discovery allow-list. Other roles are untouched.
do $$
declare
  tenant_column record;
begin
  for tenant_column in
    select attname
    from pg_catalog.pg_attribute
    where attrelid = 'public.tenants'::regclass
      and attnum > 0
      and not attisdropped
  loop
    execute format('revoke select (%I) on public.tenants from anon', tenant_column.attname);
  end loop;
end;
$$;

grant select (id, slug, name, logo_url, city, description, show_address, show_phone)
  on public.tenants to anon;

-- Preserve public_tenant_read USING (true): only the allow-listed metadata is
-- directly discoverable by anon. Contact is served by the public API's home
-- flags or by the authorized appointment endpoint after booking.
commit;
