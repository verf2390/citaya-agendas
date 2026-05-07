import { NextResponse } from "next/server";
import { z } from "zod";

import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const DocumentTypeSchema = z.enum(["boleta", "factura", "exenta"]);
const ProviderSchema = z.enum(["none", "manual_sii", "api_provider"]);
const ProviderStatusSchema = z.enum([
  "not_configured",
  "pending",
  "connected",
  "error",
]);

const BillingSettingsSchema = z.object({
  tenantId: z.string().uuid(),
  tenantSlug: z.string().trim().optional().nullable(),
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

function schemaHint(error: { message?: string }) {
  const message = error.message ?? "";
  if (
    message.includes("tenant_billing_settings") ||
    message.includes("default_document_type") ||
    message.includes("provider_status")
  ) {
    return "Ejecuta docs/BILLING_SETTINGS_SCHEMA.sql en Supabase.";
  }
  return null;
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

async function requireUser(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, error: "Unauthorized", status: 401 };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false as const, error: "Unauthorized", status: 401 };
  }

  return { ok: true as const };
}

async function validateTenant(tenantId: string, tenantSlug?: string | null) {
  let query = supabaseAdmin.from("tenants").select("id, slug").eq("id", tenantId);
  if (tenantSlug) query = query.eq("slug", tenantSlug);

  const { data, error } = await query.maybeSingle();
  if (error || !data?.id) return false;
  return true;
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    }

    const { searchParams } = new URL(req.url);
    const tenantId = String(searchParams.get("tenantId") ?? "").trim();
    const tenantSlug = String(searchParams.get("tenantSlug") ?? "").trim();

    if (!tenantId || !isUuid(tenantId)) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido o invalido" },
        { status: 400 },
      );
    }

    if (!(await validateTenant(tenantId, tenantSlug || null))) {
      return NextResponse.json(
        { ok: false, error: "Tenant no autorizado o inexistente" },
        { status: 403 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("tenant_billing_settings")
      .select(SELECT_COLUMNS)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      console.error("[admin/billing-settings] GET error:", error);
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          schemaHint: schemaHint(error),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      settings: rowToSettings(data, tenantId),
    });
  } catch (error: any) {
    console.error("[admin/billing-settings] GET unexpected:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Error cargando facturacion" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
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
    if (!(await validateTenant(settings.tenantId, settings.tenantSlug ?? null))) {
      return NextResponse.json(
        { ok: false, error: "Tenant no autorizado o inexistente" },
        { status: 403 },
      );
    }

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
      tenant_id: settings.tenantId,
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
        {
          ok: false,
          error: error.message,
          schemaHint: schemaHint(error),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      settings: rowToSettings(data, settings.tenantId),
    });
  } catch (error: any) {
    console.error("[admin/billing-settings] PUT unexpected:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Error guardando facturacion" },
      { status: 500 },
    );
  }
}
