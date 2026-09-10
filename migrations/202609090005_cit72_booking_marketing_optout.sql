begin;

create or replace function public.create_public_appointment_with_legal_acceptance(
  p_tenant_id uuid,p_professional_id uuid,p_service_id uuid,p_start_at timestamptz,
  p_customer_id uuid,p_customer_name text,p_customer_phone text,p_customer_email text,
  p_notes text,p_payment_required boolean,p_payment_status text,p_manage_token_hash text,
  p_manage_token_expires_at timestamptz,p_idempotency_key text,p_legal jsonb,
  p_source_ip inet,p_user_agent text
) returns table(appointment_id uuid,duplicate boolean)
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_result record;
  v_kind text;
  v_doc public.legal_documents%rowtype;
  v_required text[]:=array[
    'consumer_terms',
    'privacy_notice',
    'cancellation_refund_policy'
  ];
  v_item jsonb;
  v_sensitive boolean;
  v_destination text;
  v_destination_hash text;
  v_marketing_accepted boolean;
  v_latest_marketing_event public.marketing_consent_events%rowtype;
  v_marketing_event_id uuid;
begin
  if not public.legal_identity_complete(p_tenant_id) then
    raise exception 'LEGAL_IDENTITY_INCOMPLETE';
  end if;

  select l.handles_sensitive_data into v_sensitive
  from public.tenant_legal_profiles l
  where l.tenant_id=p_tenant_id
    and l.sensitive_data_review_status<>'pending';

  if not found or v_sensitive is null then
    raise exception 'SENSITIVE_DATA_REVIEW_PENDING';
  end if;

  if v_sensitive then
    v_required:=pg_catalog.array_append(
      v_required,
      'sensitive_data_authorization'
    );
  end if;

  foreach v_kind in array v_required loop
    v_item:=p_legal->v_kind;

    select * into v_doc
    from public.legal_documents d
    where d.id=nullif(v_item->>'documentId','')::uuid
      and d.owner_kind='tenant'
      and d.tenant_id=p_tenant_id
      and d.document_type=v_kind
      and d.status='published'
      and d.effective_at<=pg_catalog.now()
      and d.version=(v_item->>'version')::integer
      and d.content_sha256=v_item->>'hash';

    if not found
       or coalesce((v_item->>'accepted')::boolean,false) is not true then
      raise exception 'LEGAL_ACCEPTANCE_REQUIRED';
    end if;
  end loop;

  select * into v_result
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

  appointment_id:=v_result.appointment_id;
  duplicate:=v_result.duplicate;

  if duplicate then
    return next;
    return;
  end if;

  foreach v_kind in array v_required loop
    v_item:=p_legal->v_kind;

    select * into v_doc
    from public.legal_documents d
    where d.id=(v_item->>'documentId')::uuid;

    insert into public.legal_acceptances(
      tenant_id,
      document_id,
      document_version,
      document_hash,
      actor_type,
      customer_id,
      appointment_id,
      acceptance_context,
      accepted_declaration,
      source_ip,
      user_agent
    ) values (
      p_tenant_id,
      v_doc.id,
      v_doc.version,
      v_doc.content_sha256,
      'consumer',
      p_customer_id,
      appointment_id,
      'booking',
      pg_catalog.left(v_item->>'declaration',1000),
      p_source_ip,
      pg_catalog.left(p_user_agent,500)
    );
  end loop;

  -- Marketing is independent from transactional booking communications.
  -- A checked box grants/re-grants consent.
  -- An unchecked box suppresses marketing and revokes a previous active grant.
  select * into v_doc
  from public.legal_documents d
  where d.id=(p_legal#>>'{privacy_notice,documentId}')::uuid
    and d.tenant_id=p_tenant_id
    and d.document_type='privacy_notice';

  v_destination:=pg_catalog.lower(
    pg_catalog.btrim(p_customer_email)
  );

  if v_destination is not null
     and pg_catalog.length(v_destination)>=3 then

    v_destination_hash:=pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(v_destination,'UTF8'),
        'sha256'::text
      ),
      'hex'
    );

    v_marketing_accepted:=
      coalesce((p_legal#>>'{marketing,accepted}')::boolean,false);

    if v_marketing_accepted then

      -- A new explicit grant overrides a previous suppression.
      delete from public.marketing_suppressions s
      where s.tenant_id=p_tenant_id
        and s.channel='email'
        and s.destination_hash=v_destination_hash;

      insert into public.marketing_consent_events(
        tenant_id,
        customer_id,
        appointment_id,
        channel,
        purpose,
        event_type,
        privacy_document_id,
        privacy_document_version,
        destination_hash,
        source_context
      ) values (
        p_tenant_id,
        p_customer_id,
        appointment_id,
        'email',
        pg_catalog.left(
          p_legal#>>'{marketing,purpose}',
          500
        ),
        'granted',
        v_doc.id,
        v_doc.version,
        v_destination_hash,
        'booking'
      );

    else
      v_marketing_event_id:=null;

      select e.*
      into v_latest_marketing_event
      from public.marketing_consent_events e
      where e.tenant_id=p_tenant_id
        and e.channel='email'
        and e.destination_hash=v_destination_hash
      order by e.occurred_at desc,e.id desc
      limit 1;

      if found and v_latest_marketing_event.event_type='granted' then
        insert into public.marketing_consent_events(
          tenant_id,
          customer_id,
          appointment_id,
          channel,
          purpose,
          event_type,
          privacy_document_id,
          privacy_document_version,
          destination_hash,
          source_context
        ) values (
          p_tenant_id,
          p_customer_id,
          appointment_id,
          'email',
          'Revocación de comunicaciones comerciales registrada durante una nueva reserva.',
          'revoked',
          v_doc.id,
          v_doc.version,
          v_destination_hash,
          'booking'
        )
        returning id into v_marketing_event_id;

      elsif found and v_latest_marketing_event.event_type='revoked' then
        v_marketing_event_id:=v_latest_marketing_event.id;
      end if;

      insert into public.marketing_suppressions(
        tenant_id,
        channel,
        destination_hash,
        reason,
        source_event_id
      ) values (
        p_tenant_id,
        'email',
        v_destination_hash,
        'Cliente no autorizó promociones durante la reserva.',
        v_marketing_event_id
      )
      on conflict (tenant_id,channel,destination_hash)
      do update set
        suppressed_at=pg_catalog.now(),
        reason=excluded.reason,
        source_event_id=excluded.source_event_id;
    end if;
  end if;

  return next;
end;
$$;

commit;
