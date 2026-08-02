import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { LEGAL_DOCUMENT_LABELS, type LegalDocumentType } from "@/lib/legal/templates";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function optionalText(value: unknown, max: number) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function sourceIp(req: Request) {
  const value = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim();
  return value && /^[0-9a-f:.]+$/i.test(value) ? value : null;
}

async function load(access: Extract<Awaited<ReturnType<typeof requireHostTenantAdmin>>, { ok: true }>) {
  const tenantId = access.tenantId;
  const [tenant, tax, profile, documents, mandates, acceptances, gate] = await Promise.all([
    supabaseAdmin.from("tenants").select("id,slug,name,address,city,contact_email,phone_display").eq("id", tenantId).single(),
    supabaseAdmin.from("dte_production_tenant_settings").select("issuer_legal_name,issuer_rut,issuer_address,issuer_commune,issuer_city").eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("tenant_legal_profiles").select("*").eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("legal_documents").select("id,document_type,version,title,content,content_sha256,status,effective_at,published_at,created_at").eq("owner_kind", "tenant").eq("tenant_id", tenantId).order("document_type").order("version", { ascending: false }),
    supabaseAdmin.from("tenant_dte_mandates").select("id,signer_full_name,signer_rut,signer_capacity,accepted_at,evidence_kind").eq("tenant_id", tenantId).order("accepted_at", { ascending: false }).limit(5),
    supabaseAdmin.from("legal_acceptances").select("id,document_id,document_version,actor_type,acceptance_context,accepted_declaration,accepted_at").eq("tenant_id", tenantId).order("accepted_at", { ascending: false }).limit(50),
    supabaseAdmin.rpc("tenant_legal_gate_report", { p_tenant_id: tenantId }),
  ]);
  return {
    tenant: tenant.data,
    tax: tax.data,
    profile: profile.data,
    documents: documents.data ?? [],
    mandates: mandates.data ?? [],
    acceptances: acceptances.data ?? [],
    gate: gate.data ?? { ready: false },
  };
}

export async function GET(req: Request) {
  const access = await requireHostTenantAdmin(req);
  if (!access.ok) return error(access.error, access.status);
  return NextResponse.json({ ok: true, ...(await load(access)) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request) {
  const access = await requireHostTenantAdmin(req);
  if (!access.ok) return error(access.error, access.status);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return error("JSON inválido");

  if (body.action === "profile") {
    const supportEmail = optionalText(body.supportEmail, 254);
    const privacyEmail = optionalText(body.privacyContactEmail, 254);
    if ((supportEmail && !supportEmail.includes("@")) || (privacyEmail && !privacyEmail.includes("@"))) {
      return error("Los correos de contacto no son válidos");
    }
    const handlesSensitiveData = body.handlesSensitiveData === true;
    const sensitivePurpose = optionalText(body.sensitiveDataPurpose, 1000);
    if (handlesSensitiveData && (!sensitivePurpose || sensitivePurpose.length < 10)) {
      return error("Describe una finalidad concreta para los datos sensibles");
    }
    const completeRequested = body.administrativeReviewStatus === "complete";
    const row = {
      tenant_id: access.tenantId,
      trade_name: optionalText(body.tradeName, 180),
      contact_address: optionalText(body.contactAddress, 300),
      support_email: supportEmail,
      support_phone: optionalText(body.supportPhone, 32),
      privacy_contact_name: optionalText(body.privacyContactName, 180),
      privacy_contact_email: privacyEmail,
      tenant_is_service_provider: body.tenantIsServiceProvider === true,
      handles_sensitive_data: handlesSensitiveData,
      sensitive_data_purpose: handlesSensitiveData ? sensitivePurpose : null,
      administrative_review_status: completeRequested ? "complete" : "draft",
      updated_by: access.userId,
      updated_at: new Date().toISOString(),
    };
    const result = await supabaseAdmin.from("tenant_legal_profiles").upsert(row, { onConflict: "tenant_id" });
    if (result.error) return error("No se pudo guardar el perfil legal", 409);
  } else if (body.action === "draft") {
    const type = String(body.documentType ?? "") as LegalDocumentType;
    if (!(type in LEGAL_DOCUMENT_LABELS)) return error("Tipo de documento inválido");
    const content = String(body.content ?? "").trim();
    if (content.length < 40) return error("El contenido está incompleto");
    const id = optionalText(body.id, 36);
    if (id) {
      const result = await supabaseAdmin.from("legal_documents").update({
        title: optionalText(body.title, 180) || LEGAL_DOCUMENT_LABELS[type],
        content,
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("tenant_id", access.tenantId).eq("owner_kind", "tenant").eq("status", "draft");
      if (result.error) return error("Solo se pueden editar borradores", 409);
    } else {
      const latest = await supabaseAdmin.from("legal_documents").select("version")
        .eq("tenant_id", access.tenantId).eq("owner_kind", "tenant")
        .eq("document_type", type).order("version", { ascending: false }).limit(1).maybeSingle();
      const result = await supabaseAdmin.from("legal_documents").insert({
        owner_kind: "tenant", tenant_id: access.tenantId, document_type: type,
        version: Number(latest.data?.version ?? 0) + 1,
        title: optionalText(body.title, 180) || LEGAL_DOCUMENT_LABELS[type],
        content, content_sha256: "0".repeat(64), status: "draft", created_by: access.userId,
      });
      if (result.error) return error("No se pudo crear el borrador", 409);
    }
  } else {
    return error("Acción inválida");
  }
  return NextResponse.json({ ok: true, ...(await load(access)) });
}

export async function POST(req: Request) {
  const access = await requireHostTenantAdmin(req);
  if (!access.ok) return error(access.error, access.status);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return error("JSON inválido");
  if (body.action === "publish") {
    const { error: publishError } = await supabaseAdmin.rpc("publish_legal_document", {
      p_tenant_id: access.tenantId,
      p_document_id: String(body.documentId ?? ""),
      p_actor_id: access.userId,
      p_effective_at: new Date().toISOString(),
    });
    if (publishError) return error(
      publishError.message.includes("PENDING") ? "Completa todos los campos pendientes antes de publicar" : "No se pudo publicar la versión",
      409,
    );
  } else if (body.action === "mandate") {
    if (body.confirmAuthority !== true || body.confirmOperations !== true || body.confirmCustody !== true) {
      return error("Debes confirmar facultades, operaciones DTE y custodia");
    }
    const declaration = "Declaro tener facultades para representar al tenant y autorizo generar, firmar, enviar, consultar y conservar DTE, además de custodiar certificado y CAF bajo controles de seguridad.";
    const { error: mandateError } = await supabaseAdmin.rpc("accept_tenant_dte_mandate", {
      p_tenant_id: access.tenantId,
      p_document_id: String(body.documentId ?? ""),
      p_actor_id: access.userId,
      p_signer_full_name: String(body.signerFullName ?? ""),
      p_signer_rut: String(body.signerRut ?? ""),
      p_signer_capacity: String(body.signerCapacity ?? ""),
      p_authority_confirmed: true,
      p_declaration: declaration,
      p_source_ip: sourceIp(req),
      p_user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    });
    if (mandateError) return error("No se pudo registrar la aceptación del mandato", 409);
  } else {
    return error("Acción inválida");
  }
  return NextResponse.json({ ok: true, ...(await load(access)) });
}
