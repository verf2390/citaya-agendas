-- Prevent concurrent double-booking for active appointments.
-- Apply manually in Supabase SQL editor.

-- Required so uuid equality can participate in GiST exclusion constraints.
create extension if not exists btree_gist;

-- Preflight: this query must return 0 rows before adding the constraint.
-- If it returns rows, resolve the duplicated/overlapping active appointments first.
select
  a.id as appointment_a,
  b.id as appointment_b,
  a.tenant_id,
  a.professional_id,
  a.start_at,
  a.end_at,
  b.start_at as overlapping_start_at,
  b.end_at as overlapping_end_at
from appointments a
join appointments b
  on a.id < b.id
 and a.tenant_id = b.tenant_id
 and a.professional_id = b.professional_id
 and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)')
where a.professional_id is not null
  and b.professional_id is not null
  and (
    coalesce(lower(a.status), '') in ('confirmed', 'pending_payment', 'pending', 'paid')
    or coalesce(lower(a.booking_status), '') in ('confirmed', 'pending_payment', 'pending', 'paid')
    or coalesce(lower(a.payment_status), '') in ('confirmed', 'pending_payment', 'pending', 'paid')
  )
  and (
    coalesce(lower(b.status), '') in ('confirmed', 'pending_payment', 'pending', 'paid')
    or coalesce(lower(b.booking_status), '') in ('confirmed', 'pending_payment', 'pending', 'paid')
    or coalesce(lower(b.payment_status), '') in ('confirmed', 'pending_payment', 'pending', 'paid')
  )
  and coalesce(lower(a.status), '') not in ('canceled', 'cancelled', 'no_show', 'rejected')
  and coalesce(lower(a.booking_status), '') not in ('canceled', 'cancelled', 'no_show', 'rejected')
  and coalesce(lower(b.status), '') not in ('canceled', 'cancelled', 'no_show', 'rejected')
  and coalesce(lower(b.booking_status), '') not in ('canceled', 'cancelled', 'no_show', 'rejected');

alter table appointments
  add constraint appointments_no_active_overlap
  exclude using gist (
    tenant_id with =,
    professional_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (
    professional_id is not null
    and (
      coalesce(lower(status), '') in ('confirmed', 'pending_payment', 'pending', 'paid')
      or coalesce(lower(booking_status), '') in ('confirmed', 'pending_payment', 'pending', 'paid')
      or coalesce(lower(payment_status), '') in ('confirmed', 'pending_payment', 'pending', 'paid')
    )
    and coalesce(lower(status), '') not in ('canceled', 'cancelled', 'no_show', 'rejected')
    and coalesce(lower(booking_status), '') not in ('canceled', 'cancelled', 'no_show', 'rejected')
  );
