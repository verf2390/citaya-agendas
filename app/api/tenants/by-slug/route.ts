import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type TenantRow = {
  id: string;
  slug: string;
  name: string;
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

  // mínimos para considerarlo tenant válido
  return (
    typeof v.id === "string" &&
    typeof v.slug === "string" &&
    typeof v.name === "string" &&
    (v.phone_display === null || typeof v.phone_display === "string")
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
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Tenant not found" },
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

  // ✅ No usamos spread (evita el error TS)
  const tenant = {
    id: data.id,
    slug: data.slug,
    name: data.name,
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
  };

  return NextResponse.json({ tenant });
}
