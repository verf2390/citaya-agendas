import { NextResponse } from "next/server";

import { normalizeRut, validateRut } from "@/lib/dte/rut";
import { consumeRateLimit, opaqueKey, requestIp } from "@/lib/security/request";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function fail(status = 404) {
  return NextResponse.json({ ok: false, error: "Perfil no disponible" }, { status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const tenantId = String(body?.tenantId ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const rut = String(body?.rut ?? "").trim();
  if (
    !/^[0-9a-f-]{36}$/i.test(tenantId) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !validateRut(rut)
  ) return fail(400);

  const allowed = await consumeRateLimit({
    scope: "tax_profile_lookup",
    key: opaqueKey(requestIp(req), tenantId, email),
    limit: 5,
    windowSeconds: 15 * 60,
  });
  if (!allowed) return fail(429);

  const normalizedRut = normalizeRut(rut);
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("rut_normalized", normalizedRut)
    .eq("email", email)
    .maybeSingle();
  if (!customer?.id) return fail();

  const { data: profile } = await supabaseAdmin
    .from("customer_tax_profiles")
    .select("rut_normalized,legal_name,business_activity,tax_address,tax_commune,tax_city,tax_email")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (!profile) return fail();

  return NextResponse.json({
    ok: true,
    profile: {
      rut: profile.rut_normalized,
      legalName: profile.legal_name,
      businessActivity: profile.business_activity,
      address: profile.tax_address,
      commune: profile.tax_commune,
      city: profile.tax_city,
      taxEmail: profile.tax_email,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
