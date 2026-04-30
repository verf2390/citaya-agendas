export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type WaitlistAdminRow = {
  id: string;
  tenant_id: string;
  service_id: string;
  professional_id: string | null;
  date: string;
  time: string;
  desired_from_at: string | null;
  desired_to_at: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  notes: string | null;
  source: string | null;
  status: string;
  notified_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

async function requireUser(req: Request) {
  const token = getBearerToken(req);
  if (!token) return false;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && !!data?.user;
}

export async function GET(req: Request) {
  try {
    if (!(await requireUser(req))) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(req.url);
    const tenantId = String(searchParams.get("tenantId") || "").trim();
    const status = String(searchParams.get("status") || "active").trim();

    if (!tenantId || !isUuid(tenantId)) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido o inválido" },
        { status: 400 },
      );
    }

    let query = supabaseAdmin
      .from("waitlist_requests")
      .select(
        [
          "id",
          "tenant_id",
          "service_id",
          "professional_id",
          "date",
          "time",
          "desired_from_at",
          "desired_to_at",
          "customer_name",
          "customer_email",
          "customer_phone",
          "notes",
          "source",
          "status",
          "notified_at",
          "deleted_at",
          "created_at",
        ].join(","),
      )
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500);

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { ok: false, error: "No se pudo cargar lista de espera" },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as unknown as WaitlistAdminRow[];
    const serviceIds = Array.from(
      new Set(rows.map((row) => row.service_id).filter(Boolean)),
    );
    const serviceNameById = new Map<string, string>();

    if (serviceIds.length > 0) {
      const { data: services, error: servicesError } = await supabaseAdmin
        .from("services")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .in("id", serviceIds);

      if (servicesError) {
        return NextResponse.json(
          { ok: false, error: "No se pudieron cargar servicios" },
          { status: 500 },
        );
      }

      for (const service of services ?? []) {
        serviceNameById.set(String(service.id), String(service.name ?? ""));
      }
    }

    const items = rows.map((row) => ({
      ...row,
      service_name: serviceNameById.get(String(row.service_id)) || null,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("[admin/waitlist] error:", error);
    return NextResponse.json(
      { ok: false, error: "Error inesperado" },
      { status: 500 },
    );
  }
}
