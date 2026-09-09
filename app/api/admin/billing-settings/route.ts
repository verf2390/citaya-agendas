import { NextResponse } from "next/server";
import { z } from "zod";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";

const DocumentTypeSchema = z.enum(["boleta", "factura", "exenta"]);
const ProviderSchema = z.enum(["none", "manual_sii", "api_provider"]);
const ProviderStatusSchema = z.enum([
  "not_configured",
  "pending",
  "connected",
  "error",
]);

const BillingSettingsSchema = z.object({
  legalName: z.string().trim().optional().nullable(),
  taxId: z.string().trim().optional().nullable(),
  businessActivity: z.string().trim().optional().nullable(),
  taxAddress: z.string().trim().optional().nullable(),
  taxCommune: z.string().trim().optional().nullable(),
  taxCity: z.string().trim().optional().nullable(),
  taxEmail: z.string().trim().optional().nullable(),
  taxPhone: z.string().trim().optional().nullable(),
  defaultDocumentType: DocumentTypeSchema.default("boleta"),
  provider: ProviderSchema.default("none"),
  providerStatus: ProviderStatusSchema.default("not_configured"),
  autoIssueOnPaid: z.boolean().default(false),
  allowInvoiceRequest: z.boolean().default(true),
});

const SELECT_COLUMNS = `
  tenant_id,
  legal_name,
  tax_id,
  business_activity,
  tax_address,
  tax_commune,
  tax_city,
  tax_email,
  tax_phone,
  default_document_type,
  provider,
  provider_status,
  auto_issue_on_paid,
  allow_invoice_request
`;

function emptyToNull(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text || null;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function rowToSettings(row: any, tenantId: string) {
  return {
    tenantId,
    legalName: row?.legal_name ?? "",
    taxId: row?.tax_id ?? "",
    businessActivity: row?.business_activity ?? "",
    taxAddress: row?.tax_address ?? "",
    taxCommune: row?.tax_commune ?? "",
    taxCity: row?.tax_city ?? "",
    taxEmail: row?.tax_email ?? "",
    taxPhone: row?.tax_phone ?? "",
    defaultDocumentType: row?.default_document_type ?? "boleta",
    provider: row?.provider ?? "none",
    providerStatus: row?.provider_status ?? "not_configured",
    autoIssueOnPaid: Boolean(row?.auto_issue_on_paid),
    allowInvoiceRequest:
      typeof row?.allow_invoice_request === "boolean"
        ? row.allow_invoice_request
        : true,
  };
}

export async function GET(req: Request) {
  try {
    const access = await requireHostTenantAdmin(req);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.status === 500 ? "Error cargando facturación" : access.error },
        { status: access.status },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("tenant_billing_settings")
      .select(SELECT_COLUMNS)
      .eq("tenant_id", access.tenantId)
      .maybeSingle();

    if (error) {
      console.error("[admin/billing-settings] GET error:", error);
      return NextResponse.json(
        { ok: false, error: "Error cargando facturación" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      settings: rowToSettings(data, access.tenantId),
    });
  } catch (error) {
    console.error("[admin/billing-settings] GET unexpected:", error);
    return NextResponse.json(
      { ok: false, error: "Error cargando facturación" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const access = await requireHostTenantAdmin(req);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.status === 500 ? "Error guardando facturación" : access.error },
        { status: access.status },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = BillingSettingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Configuracion tributaria invalida" },
        { status: 400 },
      );
    }

    const settings = parsed.data;

    const taxEmail = emptyToNull(settings.taxEmail);
    const taxId = emptyToNull(settings.taxId);
    const billingEnabled =
      settings.provider !== "none" ||
      settings.providerStatus !== "not_configured" ||
      settings.autoIssueOnPaid;

    if (billingEnabled && !taxId) {
      return NextResponse.json(
        { ok: false, error: "RUT requerido para activar facturacion." },
        { status: 400 },
      );
    }

    if (taxEmail && !isEmail(taxEmail)) {
      return NextResponse.json(
        { ok: false, error: "Email tributario invalido." },
        { status: 400 },
      );
    }

    const payload = {
      tenant_id: access.tenantId,
      legal_name: emptyToNull(settings.legalName),
      tax_id: taxId,
      business_activity: emptyToNull(settings.businessActivity),
      tax_address: emptyToNull(settings.taxAddress),
      tax_commune: emptyToNull(settings.taxCommune),
      tax_city: emptyToNull(settings.taxCity),
      tax_email: taxEmail,
      tax_phone: emptyToNull(settings.taxPhone),
      default_document_type: settings.defaultDocumentType,
      provider: settings.provider,
      provider_status: settings.providerStatus,
      auto_issue_on_paid: settings.autoIssueOnPaid,
      allow_invoice_request: settings.allowInvoiceRequest,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("tenant_billing_settings")
      .upsert(payload, { onConflict: "tenant_id" })
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      console.error("[admin/billing-settings] PUT error:", error);
      return NextResponse.json(
        { ok: false, error: "Error guardando facturación" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      settings: rowToSettings(data, access.tenantId),
    });
  } catch (error) {
    console.error("[admin/billing-settings] PUT unexpected:", error);
    return NextResponse.json(
      { ok: false, error: "Error guardando facturación" },
      { status: 500 },
    );
  }
}
