import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";

type TenantRow = {
  id: string;
  slug: string;
  name: string;

  // ✅ NUEVO (por-tenant)
  min_lead_time_min: number | null;

  phone_display: string | null;
  logo_url: string | null;
  description: string | null;
  address: string | null;
  city: string | null;

  show_address_home: boolean | null;
  show_phone_home: boolean | null;
  show_address_after_booking: boolean | null;
  show_phone_after_booking: boolean | null;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function looksLikeTenantRow(v: unknown): v is TenantRow {
  if (!isObject(v)) return false;

  return (
    typeof v.id === "string" &&
    typeof v.slug === "string" &&
    typeof v.name === "string" &&
    (v.phone_display === null || typeof v.phone_display === "string") &&
    (v.min_lead_time_min === null || typeof v.min_lead_time_min === "number")
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");

  if (!slug) {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select(
      [
        "id",
        "slug",
        "name",
        "min_lead_time_min",
        "phone_display",
        "logo_url",
        "description",
        "address",
        "city",
        "show_address_home",
        "show_phone_home",
        "show_address_after_booking",
        "show_phone_after_booking",
      ].join(","),
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Tenant lookup unavailable" },
      { status: 503 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Tenant not found" },
      { status: 404 },
    );
  }

  if (!looksLikeTenantRow(data)) {
    return NextResponse.json(
      { error: "Invalid tenant payload" },
      { status: 500 },
    );
  }

  const address_display =
    [data.address, data.city].filter(Boolean).join(" · ").trim() || null;
  const [paymentConfig, boletaCapability] = await Promise.all([
    getTenantPaymentConfig(data.id),
    supabaseAdmin
      .from("dte_tenant_document_capabilities")
      .select("customer_selection_enabled,issuance_enabled,certification_status")
      .eq("tenant_id", data.id)
      .eq("environment", "production")
      .eq("dte_type", 39)
      .maybeSingle(),
  ]);

  const tenant = {
    id: data.id,
    slug: data.slug,
    name: data.name,

    // ✅ NUEVO
    min_lead_time_min: data.min_lead_time_min,

    phone_display: data.phone_display,
    logo_url: data.logo_url,
    description: data.description,
    address: data.address,
    city: data.city,

    show_address_home: data.show_address_home,
    show_phone_home: data.show_phone_home,
    show_address_after_booking: data.show_address_after_booking,
    show_phone_after_booking: data.show_phone_after_booking,

    address_display,
    payment_mode: paymentConfig.mode,
    payment_enabled: paymentConfig.enabled,
    payment_methods_enabled: paymentConfig.paymentMethodsEnabled,
    payment_collection_mode: paymentConfig.collectionMode,
    deposit_type: paymentConfig.depositType,
    deposit_value: paymentConfig.depositValue,
    boleta_document_selection_enabled:
      boletaCapability.data?.customer_selection_enabled === true &&
      boletaCapability.data?.issuance_enabled === true &&
      boletaCapability.data?.certification_status === "production_authorized",
  };

  return NextResponse.json({ tenant });
}
