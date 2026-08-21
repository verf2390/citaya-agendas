import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseJson } from "@/lib/api/parse";
import { AppointmentCreateSchema } from "@/lib/api/schemas";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import {
  deriveManageToken,
  hashManageToken,
  manageTokenExpiresAt,
} from "@/lib/security/manage-tokens.mjs";
import {
  consumeRateLimit,
  idempotencyKey,
  opaqueKey,
  requestIp,
} from "@/lib/security/request";
import { normalizeRut } from "@/lib/dte/rut";
import { validateBookingTaxInput } from "@/lib/dte/cutover";
import { validatePublicLegalConsent } from "@/lib/legal/consent.mjs";
import {
  getPublicLegalBundleByTenantId,
  resolveTenantForPublicRequest,
} from "@/lib/legal/server";
import {
  getTenantPublicBaseUrl,
  getTenantSlugFromHostname,
} from "@/lib/tenant";
import { isSafeDemoAppointmentMode } from "@/lib/tenant/operational-mode.mjs";
import {
  loadTenantOperationalContext,
  TenantOperationalError,
} from "@/lib/tenant/operational-server";
import {
  dispatchAppointmentCreatedEvent,
  runPostPersistedAppointmentEffect,
  shouldDispatchAppointmentCreatedEvent,
} from "@/services/automations/appointment-events.mjs";

function publicError(status = 400, error = "No se pudo crear la reserva") {
  return NextResponse.json({ ok: false, error }, { status });
}

function publicTenantBaseUrl(req: Request, tenantSlug: string) {
  const forwardedHost = (req.headers.get("x-forwarded-host") ?? "").split(",")[0]?.trim();
  const requestHost = (req.headers.get("host") ?? "").split(",")[0]?.trim();
  const host = forwardedHost || requestHost || "";
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (!host || getTenantSlugFromHostname(hostname) !== tenantSlug) return null;
  const forwardedProtocol = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

async function resolveCustomerId(input: {
  tenantId: string;
  customerId?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  rut: string | null;
}) {
  const rut = input.rut ? normalizeRut(input.rut) : null;
  if (input.customerId) {
    const { data } = await supabaseAdmin.from("customers").select("id,rut_normalized")
      .eq("id", input.customerId).eq("tenant_id", input.tenantId).maybeSingle();
    if (!data) throw new Error("invalid_customer");
    if (rut && data.rut_normalized && data.rut_normalized !== rut) throw new Error("customer_rut_mismatch");
    const { error } = await supabaseAdmin.from("customers").update(rut ? { rut_normalized: rut } : {})
      .eq("id", data.id).eq("tenant_id", input.tenantId);
    if (error) throw error;
    return data.id;
  }
  const phone = String(input.phone ?? "").replace(/[^+\d]/g, "").slice(0, 32) || null;
  const email = String(input.email ?? "").trim().toLowerCase().slice(0, 254) || null;
  let existing = rut ? (await supabaseAdmin.from("customers").select("id,rut_normalized")
    .eq("tenant_id", input.tenantId).eq("rut_normalized", rut).maybeSingle()).data : null;
  if (!existing && phone) {
    existing = (await supabaseAdmin.from("customers").select("id,rut_normalized")
      .eq("tenant_id", input.tenantId).eq("phone", phone).maybeSingle()).data;
  }
  if (!existing && email) {
    existing = (await supabaseAdmin.from("customers").select("id,rut_normalized")
      .eq("tenant_id", input.tenantId).eq("email", email).maybeSingle()).data;
  }
  if (existing?.id) {
    if (rut && existing.rut_normalized && existing.rut_normalized !== rut) {
      throw new Error("customer_rut_mismatch");
    }
    const { error } = await supabaseAdmin.from("customers").update({
      ...(rut ? { rut_normalized: rut } : {}),
      full_name: input.name.slice(0, 120),
      phone,
      email,
    })
      .eq("id", existing.id).eq("tenant_id", input.tenantId);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await supabaseAdmin.from("customers").insert({
    tenant_id: input.tenantId,
    full_name: input.name.slice(0, 120),
    phone,
    email,
    ...(rut ? { rut_normalized: rut } : {}),
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function POST(req: Request) {
  try {
    const parsed = await parseJson(req, AppointmentCreateSchema);
    if (!parsed.ok) return parsed.res;
    const input = parsed.data;
    const isAdminRequest = Boolean(req.headers.get("authorization"));
    let publicTenantSlug: string | null = null;
    let legalConsent: Record<string, unknown> | null = null;
    if (!isAdminRequest) {
      const resolvedTenant = await resolveTenantForPublicRequest(
        req,
        String(input.tenantSlug ?? ""),
      );
      if (!resolvedTenant || resolvedTenant.id !== input.tenantId) return publicError(404);
      publicTenantSlug = resolvedTenant.slug;
    }
    const operational = await loadTenantOperationalContext(input.tenantId);
    if (isAdminRequest) {
      publicTenantSlug = operational.tenantSlug || null;
    }
    const isDemoAppointment = isSafeDemoAppointmentMode(
      operational.capabilities,
    );
    if (
      operational.operationalMode === "demo" &&
      !isDemoAppointment
    ) {
      return publicError(409);
    }
    if (!operational.capabilities.createAppointment && !isAdminRequest) {
      return publicError(404);
    }

    if (!isAdminRequest) {
      if (!isDemoAppointment) {
        const legalBundle = await getPublicLegalBundleByTenantId(
          input.tenantId,
          publicTenantSlug ?? undefined,
        );
        const validation = validatePublicLegalConsent({
          tenantId: input.tenantId,
          bundle: legalBundle ?? {},
          consent: input.legalConsent,
        });
        if (!validation.ok) {
          return publicError(409, "Debes revisar y aceptar las condiciones vigentes del prestador.");
        }
        legalConsent = validation.value;
      }
    }
    const requestedDocumentType =
      isDemoAppointment
        ? null
        : input.taxDocumentType ??
          (input.invoiceRequested === true ? 33 : isAdminRequest ? 39 : null);
    let bookingTax;
    try {
      bookingTax = validateBookingTaxInput({
        customerRut: isDemoAppointment ? undefined : input.customerRut,
        invoiceRequested: !isDemoAppointment && input.invoiceRequested === true,
        taxDocumentType: requestedDocumentType,
        taxProfile: requestedDocumentType === 33 ? {
          rut: input.invoiceReceiverRut ?? "",
          legalName: input.invoiceReceiverLegalName ?? "",
          businessActivity: input.invoiceReceiverActivity ?? "",
          address: input.invoiceReceiverAddress ?? "",
          commune: input.invoiceReceiverCommune ?? "",
          city: input.invoiceReceiverCity ?? "",
          taxEmail: input.invoiceReceiverTaxEmail ?? input.customerEmail,
        } : null,
      });
    } catch {
      return publicError(400, requestedDocumentType === 33
        ? "Datos tributarios de factura incompletos"
        : "RUT inválido");
    }
    if (
      !isDemoAppointment &&
      !isAdminRequest &&
      (requestedDocumentType === 33 || requestedDocumentType === 39) &&
      !operational.capabilities.publicTaxDocument
    ) {
      return publicError(409, "La emisión de documentos tributarios no está disponible.");
    }

    if (!isDemoAppointment && !isAdminRequest && requestedDocumentType === 33) {
      const [
        { data: authorization, error: authorizationError },
        { data: activation, error: activationError },
        invoiceGate,
      ] = await Promise.all([
        supabaseAdmin
          .from("dte_sii_authorization_evidence")
          .select("authorized_types")
          .eq("tenant_id", input.tenantId)
          .eq("status", "current")
          .maybeSingle(),
        supabaseAdmin
          .from("dte_legal_activation")
          .select("status")
          .eq("tenant_id", input.tenantId)
          .eq("dte_type", 33)
          .maybeSingle(),
        supabaseAdmin.rpc("dte_activation_gate_report", {
          p_tenant_id: input.tenantId,
          p_dte_type: 33,
          p_global_feature_enabled: process.env.DTE_PRODUCTION_ENABLED === "true",
        }),
      ]);

      const invoiceAuthorized =
        !authorizationError &&
        !activationError &&
        !invoiceGate.error &&
        Array.isArray(authorization?.authorized_types) &&
        authorization.authorized_types.includes(33) &&
        activation?.status === "active" &&
        (invoiceGate.data as { ready?: boolean } | null)?.ready === true;

      if (!invoiceAuthorized) {
        return publicError(
          409,
          "La factura electrónica no está disponible para este prestador.",
        );
      }
    }

    if (!isDemoAppointment && !isAdminRequest && requestedDocumentType === 39) {
      const { data: capability, error: capabilityError } = await supabaseAdmin
        .from("dte_tenant_document_capabilities")
        .select("customer_selection_enabled,issuance_enabled,certification_status")
        .eq("tenant_id", input.tenantId)
        .eq("environment", "production")
        .eq("dte_type", 39)
        .maybeSingle();
      if (
        capabilityError ||
        !capability?.customer_selection_enabled ||
        !capability.issuance_enabled ||
        capability.certification_status !== "production_authorized"
      ) {
        return publicError(
          409,
          "La boleta electrónica estará disponible próximamente.",
        );
      }
    }
    const key = idempotencyKey(req, input.idempotencyKey);
    const pepper = process.env.CITAYA_MANAGE_TOKEN_PEPPER?.trim();
    if (!key || !pepper) return publicError(503);

    if (isAdminRequest) {
      const admin = await requireTenantAdmin({ req, tenantId: input.tenantId });
      if (!admin.ok) return publicError(404);
    } else {
      const allowed = await consumeRateLimit({
        scope: "appointment_create",
        key: opaqueKey(
          requestIp(req),
          input.tenantId,
          input.customerEmail ?? input.customerPhone ?? "anonymous",
        ),
        limit: 5,
        windowSeconds: 15 * 60,
      });
      if (!allowed) return publicError(429, "Demasiadas solicitudes");
    }

    const [{ data: service, error: serviceError }, { data: professional, error: professionalError }, { data: issuanceConfig }] =
      await Promise.all([
        supabaseAdmin.from("services")
          .select("id,tenant_id,duration_min,price,currency,is_active,tax_treatment,payment_policy,deposit_type,deposit_value,deposit_min_amount,deposit_max_amount,deposit_tax_document_policy_status,provisional_expiry_minutes,payment_configuration_complete,tax_description,tax_description_review_status")
          .eq("id", input.serviceId).eq("tenant_id", input.tenantId)
          .eq("is_active", true).maybeSingle(),
        supabaseAdmin.from("professionals")
          .select("id, tenant_id, active")
          .eq("id", input.professionalId).eq("tenant_id", input.tenantId)
          .eq("active", true).maybeSingle(),
        isDemoAppointment
          ? Promise.resolve({ data: null })
          : supabaseAdmin.from("dte_tenant_issuance_settings").select("tax_treatment,deposit_tax_document_policy_status").eq("tenant_id", input.tenantId).maybeSingle(),
      ]);
    const duration = Number(service?.duration_min);
    const price = Number(service?.price);
    if (
      serviceError || professionalError || !service || !professional ||
      !Number.isInteger(duration) || duration < 5 || duration > 480 ||
      !Number.isSafeInteger(price) || price < 0 ||
      (!isDemoAppointment && (
        service.payment_configuration_complete !== true ||
        service.tax_description_review_status !== "approved"
      ))
    ) {
      return publicError(409);
    }
    if (!isDemoAppointment && service.payment_policy === "deposit" && (
      service.deposit_tax_document_policy_status !== "enabled" ||
      issuanceConfig?.deposit_tax_document_policy_status !== "enabled"
    )) {
      return publicError(409, "El pago anticipado no está disponible por ahora.");
    }

    const customerId = await resolveCustomerId({
      tenantId: input.tenantId,
      customerId: input.customerId,
      name: input.customerName,
      phone: input.customerPhone,
      email: input.customerEmail,
      rut: bookingTax.customerRut || null,
    });
    if (!isDemoAppointment && bookingTax.taxProfile) {
      const profile = bookingTax.taxProfile;
      const { error: taxProfileError } = await supabaseAdmin.from("customer_tax_profiles").upsert({
        tenant_id: input.tenantId, customer_id: customerId, rut_normalized: profile.rut,
        legal_name: profile.legalName, business_activity: profile.businessActivity,
        tax_address: profile.address, tax_commune: profile.commune, tax_city: profile.city,
        tax_email: profile.taxEmail, updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,customer_id" });
      if (taxProfileError) return publicError(409, "Perfil tributario duplicado o inválido");
    }
    const paymentRequired = !isDemoAppointment && service.payment_policy !== "no_advance";
    const manageToken = deriveManageToken(input.tenantId, key, pepper);
    const rpcName = isAdminRequest
      ? "create_admin_appointment"
      : isDemoAppointment
        ? "create_public_appointment"
        : "create_public_appointment_with_legal_acceptance";
    const rpcInput: Record<string, unknown> = {
      p_tenant_id: input.tenantId,
      p_professional_id: input.professionalId,
      p_service_id: input.serviceId,
      p_start_at: new Date(input.startAt).toISOString(),
      p_customer_id: customerId,
      p_customer_name: input.customerName,
      p_customer_phone: input.customerPhone ?? "",
      p_customer_email: input.customerEmail ?? "",
      p_notes: input.notes ?? "",
      p_payment_required: paymentRequired,
      p_payment_status: isDemoAppointment
        ? "not_required"
        : isAdminRequest
          ? input.paymentStatus ?? "not_required"
          : "pending",
      p_manage_token_hash: hashManageToken(manageToken, pepper),
      p_manage_token_expires_at: manageTokenExpiresAt(),
      p_idempotency_key: key,
    };
    if (!isAdminRequest && !isDemoAppointment) {
      const forwardedIp = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
      rpcInput.p_legal = legalConsent;
      rpcInput.p_source_ip = /^[0-9a-f:.]+$/i.test(forwardedIp) ? forwardedIp : null;
      rpcInput.p_user_agent = req.headers.get("user-agent")?.slice(0, 500) ?? null;
    }
    const { data, error } = await supabaseAdmin.rpc(rpcName, rpcInput);
    if (error) {
      console.warn("[appointments/create] rejected", { code: error.code ?? null });
      return publicError(error.code === "23P01" ? 409 : 400);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.appointment_id) return publicError(500);
    if (!isDemoAppointment) {
      const taxTreatmentSnapshot = service.tax_treatment ??
        (["affected", "exempt"].includes(String(issuanceConfig?.tax_treatment)) ? issuanceConfig?.tax_treatment : null);
      const { error: taxSnapshotError } = await supabaseAdmin
        .from("appointments")
        .update({
          invoice_requested: requestedDocumentType === 33,
          invoice_receiver_rut: requestedDocumentType === 33 && input.invoiceReceiverRut ? normalizeRut(input.invoiceReceiverRut) : null,
          invoice_receiver_legal_name: requestedDocumentType === 33 ? input.invoiceReceiverLegalName ?? null : null,
          invoice_receiver_activity: requestedDocumentType === 33 ? input.invoiceReceiverActivity ?? null : null,
          invoice_receiver_address: requestedDocumentType === 33 ? input.invoiceReceiverAddress ?? null : null,
          invoice_receiver_commune: requestedDocumentType === 33 ? input.invoiceReceiverCommune ?? null : null,
          invoice_receiver_city: requestedDocumentType === 33 ? input.invoiceReceiverCity ?? null : null,
          customer_rut_snapshot: bookingTax.customerRut || null,
          requested_document_type: bookingTax.requestedDocumentType,
          tax_document_selection: bookingTax.requestedDocumentType,
          tax_treatment_snapshot: taxTreatmentSnapshot,
        })
        .eq("id", row.appointment_id)
        .eq("tenant_id", input.tenantId);
      if (taxSnapshotError) return publicError(500);
      const { error: saleError } = await supabaseAdmin.rpc(
        "billing_initialize_appointment_sale",
        {
          p_tenant_id: input.tenantId,
          p_appointment_id: row.appointment_id,
          p_requested_document_type: bookingTax.requestedDocumentType,
        },
      );
      if (saleError) {
        console.warn("[appointments/create] sale initialization rejected", { code: saleError.code ?? null });
        return publicError(409, "La configuración comercial del servicio está incompleta");
      }
    }
    if (
      shouldDispatchAppointmentCreatedEvent(
        operational.capabilities,
        row.duplicate,
      )
    ) {
      const notification = await runPostPersistedAppointmentEffect(
        () => dispatchAppointmentCreatedEvent({
          appointmentId: row.appointment_id,
          manageToken,
          publicBaseUrl: publicTenantSlug
            ? publicTenantBaseUrl(req, publicTenantSlug) ??
              getTenantPublicBaseUrl(publicTenantSlug) ??
              ""
            : "",
        }),
      );
      if (!notification.ok) {
        console.warn("[appointments/create] appointment notification failed", {
          called: notification.called,
          status: notification.status,
          reason: notification.reason,
        });
      }
    }
    return NextResponse.json({
      ok: true,
      appointmentId: row.appointment_id,
      manageToken,
      duplicate: row.duplicate === true,
      ...(isDemoAppointment ? { persisted: true } : {}),
    });
  } catch (error) {
    if (error instanceof TenantOperationalError) return publicError(409);
    console.error("[appointments/create] failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return publicError(500);
  }
}
