
-- CIT-15: authenticated admin appointment creation for internal tenants.
-- Public booking remains governed by createAppointment.

create or replace function public.assert_tenant_can_create_admin_appointment(
  p_tenant_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lifecycle text;
  v_mode text;
begin
  select lifecycle_status, operational_mode
    into v_lifecycle, v_mode
    from public.tenants
   where id = p_tenant_id;

  if not found
     or v_lifecycle <> 'active'
     or v_mode not in ('internal','live') then
    raise exception 'TENANT_MODE_ADMIN_APPOINTMENT_BLOCKED';
  end if;
end;
$$;


create or replace function public.assert_tenant_operational_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trigger_source text;
  v_transfer_tenant text;
  v_admin_appointment_tenant text;
begin
  if tg_table_name='appointments' then
    v_admin_appointment_tenant :=
      coalesce(
        pg_catalog.current_setting(
          'citaya.admin_appointment_tenant_id',
          true
        ),
        ''
      );

    if v_admin_appointment_tenant = new.tenant_id::text then
      perform public.assert_tenant_can_create_admin_appointment(
        new.tenant_id
      );
    else
      perform public.assert_tenant_can_create_appointment(
        new.tenant_id
      );
    end if;

  elsif tg_table_name in ('payment_intents','payments','billing_sale_payments') then
    v_transfer_tenant :=
      coalesce(
        pg_catalog.current_setting(
          'citaya.manual_transfer_tenant_id',
          true
        ),
        ''
      );

    if coalesce(new.provider,'')='manual'
       and v_transfer_tenant = new.tenant_id::text then
      perform public.assert_tenant_can_confirm_transfer(new.tenant_id);
    else
      perform public.assert_tenant_can_create_payment(new.tenant_id);
    end if;

  elsif tg_table_name='dte_payment_document_intents' then
    perform public.assert_tenant_can_enqueue_dte(
      new.tenant_id,
      new.trigger_source
    );

  elsif tg_table_name='dte_issuance_outbox' then
    select trigger_source
      into v_trigger_source
      from public.dte_payment_document_intents
     where id=new.intent_id
       and tenant_id=new.tenant_id;

    perform public.assert_tenant_can_enqueue_dte(
      new.tenant_id,
      coalesce(v_trigger_source,'manual_admin')
    );

  else
    raise exception 'TENANT_MODE_TRIGGER_TABLE_UNSUPPORTED';
  end if;

  return new;
end;
$$;


create or replace function public.create_admin_appointment(
  p_tenant_id uuid,
  p_professional_id uuid,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_notes text,
  p_payment_required boolean,
  p_payment_status text,
  p_manage_token_hash text,
  p_manage_token_expires_at timestamptz,
  p_idempotency_key text
)
returns table(
  appointment_id uuid,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_tenant_can_create_admin_appointment(
    p_tenant_id
  );

  perform pg_catalog.set_config(
    'citaya.admin_appointment_tenant_id',
    p_tenant_id::text,
    true
  );

  return query
  select *
    from public.create_public_appointment(
      p_tenant_id,
      p_professional_id,
      p_service_id,
      p_start_at,
      p_customer_id,
      p_customer_name,
      p_customer_phone,
      p_customer_email,
      p_notes,
      p_payment_required,
      p_payment_status,
      p_manage_token_hash,
      p_manage_token_expires_at,
      p_idempotency_key
    );
end;
$$;

revoke all on function public.create_admin_appointment(
  uuid,uuid,uuid,timestamptz,uuid,text,text,text,text,
  boolean,text,text,timestamptz,text
) from public,anon,authenticated;

grant execute on function public.create_admin_appointment(
  uuid,uuid,uuid,timestamptz,uuid,text,text,text,text,
  boolean,text,text,timestamptz,text
) to service_role;

revoke all on function public.assert_tenant_can_create_admin_appointment(uuid)
  from public,anon,authenticated;

grant execute on function public.assert_tenant_can_create_admin_appointment(uuid)
  to service_role;
