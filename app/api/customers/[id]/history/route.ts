export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(
      token,
    );

    if (userErr || !userData?.user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    const { searchParams } = new URL(req.url);
    const tenantId = String(searchParams.get("tenantId") || "").trim();

    if (!tenantId || !isUuid(tenantId)) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido" },
        { status: 400 },
      );
    }

    if (!id || !isUuid(id)) {
      return NextResponse.json(
        { ok: false, error: "customerId inválido" },
        { status: 400 },
      );
    }

    const { data: customer, error: customerErr } = await supabaseAdmin
      .from("customers")
      .select("id, tenant_id, full_name, phone, email, notes, created_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (customerErr) {
      return NextResponse.json(
        { ok: false, error: customerErr.message },
        { status: 500 },
      );
    }

    if (!customer) {
      return NextResponse.json(
        { ok: false, error: "Cliente no encontrado" },
        { status: 404 },
      );
    }

    const { data: appointments, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .select(
        "id, start_at, end_at, status, booking_status, payment_status, payment_required_amount, payment_paid_amount, payment_provider, service_name, service_id, professional_id, notes",
      )
      .eq("tenant_id", tenantId)
      .eq("customer_id", id)
      .order("start_at", { ascending: false });

    if (apptErr) {
      return NextResponse.json(
        { ok: false, error: apptErr.message },
        { status: 500 },
      );
    }

    const serviceIds = Array.from(
      new Set(
        (appointments ?? [])
          .map((a) => a.service_id)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );

    const professionalIds = Array.from(
      new Set(
        (appointments ?? [])
          .map((a) => a.professional_id)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );

    let servicesMap = new Map<string, string>();
    let professionalsMap = new Map<string, string>();

    if (serviceIds.length > 0) {
      const { data: services } = await supabaseAdmin
        .from("services")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .in("id", serviceIds);

      servicesMap = new Map((services ?? []).map((s) => [s.id, s.name]));
    }

    if (professionalIds.length > 0) {
      const { data: professionals } = await supabaseAdmin
        .from("professionals")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .in("id", professionalIds);

      professionalsMap = new Map(
        (professionals ?? []).map((p) => [p.id, p.name ?? "—"]),
      );
    }

    const enrichedAppointments = (appointments ?? []).map((a) => ({
      ...a,
      service_name:
        a.service_name ||
        (a.service_id ? servicesMap.get(a.service_id) ?? "Servicio" : "Servicio"),
      professional_name: a.professional_id
        ? professionalsMap.get(a.professional_id) ?? null
        : null,
    }));

    const now = Date.now();
    const activeAppointments = enrichedAppointments.filter(
      (a) => a.status !== "canceled",
    );

    const lastVisit =
      activeAppointments.find((a) => {
        const ts = new Date(a.start_at).getTime();
        return Number.isFinite(ts) && ts <= now;
      }) ?? null;

    const upcoming =
      [...activeAppointments]
        .filter((a) => {
          const ts = new Date(a.start_at).getTime();
          return Number.isFinite(ts) && ts > now;
        })
        .sort(
          (a, b) =>
            new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
        )[0] ?? null;

    return NextResponse.json({
      ok: true,
      customer,
      summary: {
        totalAppointments: enrichedAppointments.length,
        lastVisit,
        upcoming,
      },
      appointments: enrichedAppointments,
    });
  } catch (e: any) {
    console.error("[api/customers/[id]/history] error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error cargando historial" },
      { status: 500 },
    );
  }
}
