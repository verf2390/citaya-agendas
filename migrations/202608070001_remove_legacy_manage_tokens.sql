-- Apply only after the 14-day compatibility window created by
-- 202607230001_security_hardening.sql has elapsed in the target environment.
-- This migration fails closed if any legacy link is still inside its window.

do $$
begin
  if exists (
    select 1
    from public.appointments
    where manage_token is not null
      and manage_token_legacy_expires_at > now()
  ) then
    raise exception 'legacy_manage_token_window_still_active';
  end if;
end $$;

update public.appointments
set manage_token = null,
    manage_token_legacy_expires_at = null
where manage_token is not null
   or manage_token_legacy_expires_at is not null;

alter table public.appointments
  drop constraint if exists appointments_no_plaintext_manage_token;
alter table public.appointments
  add constraint appointments_no_plaintext_manage_token
  check (manage_token is null);
