-- CIT-72 runtime assertions. Fixture IDs are created by the matching Node test.

do $$
declare
  dte_tenant constant uuid := '72000000-0000-4000-8000-000000000001';
  bhe_tenant constant uuid := '72000000-0000-4000-8000-000000000002';
  actor constant uuid := '72000000-0000-4000-8000-000000000099';
  report jsonb;
  caps jsonb;
begin
  -- Existing live DTE tenant keeps the historical all-on feature profile.
  if not exists (
    select 1
    from public.tenant_operational_features f
    where f.tenant_id=dte_tenant
      and f.appointments_enabled
      and f.appointment_communications_enabled
      and f.external_communications_enabled
      and f.campaigns_enabled
      and f.payments_enabled
      and f.dte_enabled
      and f.tax_document_mode='citaya_dte'
  ) then
    raise exception 'CIT72_EXISTING_LIVE_PROFILE_NOT_PRESERVED';
  end if;

  report := public.tenant_live_readiness_report(dte_tenant);
  if coalesce((report->>'ready')::boolean,false) is not true then
    raise exception 'CIT72_EXISTING_DTE_LIVE_NOT_READY: %', report;
  end if;

  caps := public.resolve_tenant_operational_capabilities(dte_tenant);
  if coalesce((caps->>'createAppointment')::boolean,false) is not true
     or coalesce((caps->>'createPayment')::boolean,false) is not true
     or coalesce((caps->>'sendCampaign')::boolean,false) is not true
     or coalesce((caps->>'enqueueDte')::boolean,false) is not true
  then
    raise exception 'CIT72_EXISTING_DTE_CAPABILITIES_REGRESSED: %', caps;
  end if;

  -- Demo/non-live tenant is not implicitly granted production features.
  if not exists (
    select 1
    from public.tenant_operational_features f
    where f.tenant_id=bhe_tenant
      and not f.appointments_enabled
      and not f.appointment_communications_enabled
      and not f.external_communications_enabled
      and not f.campaigns_enabled
      and not f.payments_enabled
      and not f.dte_enabled
      and f.tax_document_mode='unconfigured'
  ) then
    raise exception 'CIT72_NON_LIVE_NOT_FAIL_CLOSED';
  end if;

  -- External BHE cannot be enabled without explicit review evidence.
  begin
    perform public.set_tenant_operational_features(
      bhe_tenant,actor,
      true,true,true,true,false,false,
      'external_bhe',null,
      'Intento de BHE sin evidencia para comprobar fail closed'
    );
    raise exception 'CIT72_EXTERNAL_BHE_WITHOUT_EVIDENCE_ACCEPTED';
  exception
    when others then
      if sqlerrm='CIT72_EXTERNAL_BHE_WITHOUT_EVIDENCE_ACCEPTED' then
        raise;
      end if;
      if sqlerrm not like '%EXTERNAL_BHE_EVIDENCE_REQUIRED%' then
        raise;
      end if;
  end;

  -- Configure a real agenda/communications tenant with external BHE, no Citaya
  -- payments and no Citaya DTE.
  perform public.set_tenant_operational_features(
    bhe_tenant,actor,
    true,true,true,true,false,false,
    'external_bhe','BHE externa verificada por platform admin para fixture CIT-72',
    'Configurar agenda live con BHE externa y sin pagos ni DTE Citaya'
  );

  report := public.tenant_live_readiness_report(bhe_tenant);
  if coalesce((report->>'ready')::boolean,false) is not true
     or report->>'taxDocumentMode' <> 'external_bhe'
     or coalesce((report->>'paymentGateReady')::boolean,false) is not true
     or coalesce((report->>'paymentsRequired')::boolean,true) is not false
     or coalesce((report->>'dteRequired')::boolean,true) is not false
  then
    raise exception 'CIT72_EXTERNAL_BHE_READINESS_INVALID: %', report;
  end if;

  -- Canonical mode transition must consume the new capability-aware readiness.
  perform public.set_tenant_operational_mode(
    bhe_tenant,'live',actor,
    'Promoción CIT-72 después de completar readiness capability-aware'
  );

  caps := public.resolve_tenant_operational_capabilities(bhe_tenant);
  if coalesce((caps->>'createAppointment')::boolean,false) is not true
     or coalesce((caps->>'appointmentOperationalCommunication')::boolean,false) is not true
     or coalesce((caps->>'sendExternalEmail')::boolean,false) is not true
     or coalesce((caps->>'sendCampaign')::boolean,false) is not true
     or coalesce((caps->>'createPayment')::boolean,true) is not false
     or coalesce((caps->>'confirmTransfer')::boolean,true) is not false
     or coalesce((caps->>'acceptPaymentWebhook')::boolean,true) is not false
     or coalesce((caps->>'enqueueDte')::boolean,true) is not false
     or coalesce((caps->>'runDteWorker')::boolean,true) is not false
     or coalesce((caps->>'publicTaxDocument')::boolean,true) is not false
  then
    raise exception 'CIT72_EXTERNAL_BHE_CAPABILITY_MATRIX_INVALID: %', caps;
  end if;

  -- Already-live tenants cannot be changed into a not-ready profile.
  begin
    perform public.set_tenant_operational_features(
      bhe_tenant,actor,
      false,false,false,false,false,false,
      'external_bhe','BHE externa verificada por platform admin para fixture CIT-72',
      'Intento de romper readiness de un tenant live para validar rollback'
    );
    raise exception 'CIT72_LIVE_NOT_READY_CHANGE_ACCEPTED';
  exception
    when others then
      if sqlerrm='CIT72_LIVE_NOT_READY_CHANGE_ACCEPTED' then
        raise;
      end if;
      if sqlerrm not like '%LIVE_TENANT_FEATURE_CHANGE_NOT_READY%' then
        raise;
      end if;
  end;

  if not exists (
    select 1 from public.tenant_operational_features f
    where f.tenant_id=bhe_tenant
      and f.appointments_enabled
      and f.campaigns_enabled
      and not f.payments_enabled
      and not f.dte_enabled
      and f.tax_document_mode='external_bhe'
  ) then
    raise exception 'CIT72_FAILED_CHANGE_WAS_NOT_ATOMIC';
  end if;

  if not exists (
    select 1 from public.tenant_operational_features_audit a
    where a.tenant_id=bhe_tenant
      and a.actor_user_id=actor
      and a.new_settings->>'tax_document_mode'='external_bhe'
  ) then
    raise exception 'CIT72_FEATURE_AUDIT_MISSING';
  end if;
end;
$$;

-- New tenant after the migration must receive a fail-closed profile via trigger.
insert into public.tenants(id,slug,name,lifecycle_status,operational_mode,address,contact_email)
values (
  '72000000-0000-4000-8000-000000000003',
  'cit72-new-tenant','CIT72 New Tenant','active','unclassified',
  'Dirección fixture 123','fixture-new@example.test'
);

do $$
begin
  if not exists (
    select 1 from public.tenant_operational_features f
    where f.tenant_id='72000000-0000-4000-8000-000000000003'
      and not f.appointments_enabled
      and not f.appointment_communications_enabled
      and not f.external_communications_enabled
      and not f.campaigns_enabled
      and not f.payments_enabled
      and not f.dte_enabled
      and f.tax_document_mode='unconfigured'
  ) then
    raise exception 'CIT72_NEW_TENANT_NOT_FAIL_CLOSED';
  end if;
end;
$$;
