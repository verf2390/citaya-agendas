export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type TenantResolution = {
  tenantId: string;
  error: string;
  status: number;
};

const SERVICE_SELECT =
  "id, tenant_id, name, description, duration_min, price, currency, is_active, created_at";
const SERVICE_SELECT_NO_CREATED =
  "id, tenant_id, name, description, duration_min, price, currency, is_active";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function getHostnameFromReq(req: Request) {
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host.split(",")[0]?.trim().split(":")[0] ?? "";
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseNonNegativeNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function parsePositiveInteger(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return Math.round(numberValue);
}

function normalizeService(row: Record<string, any>) {
  const duration =
    row.duration_min ?? row.duration_minutes ?? row.duration ?? null;
  const active =
    typeof row.is_active === "boolean"
      ? row.is_active
      : typeof row.active === "boolean"
        ? row.active
        : true;

  return {
    ...row,
    description: row.description ?? null,
    duration_min: typeof duration === "number" ? duration : null,
    price: typeof row.price === "number" ? row.price : row.price ?? null,
    currency: row.currency ?? "CLP",
    is_active: active,
  };
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function requireUser(req: Request) {
  const token = getBearerToken(req);
  if (!token) return false;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && !!data?.user;
}

async function resolveTenantId(
  req: Request,
  body?: any,
): Promise<TenantResolution> {
  const url = new URL(req.url);
  const slug =
    cleanText(url.searchParams.get("tenant")) ||
    getTenantSlugFromHostname(getHostnameFromReq(req));

  if (slug) {
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (error) return { tenantId: "", error: error.message, status: 500 };
    if (!data?.id) {
      return {
        tenantId: "",
        error: `Tenant no encontrado para ${slug}`,
        status: 404,
      };
    }

    return { tenantId: data.id as string, error: "", status: 200 };
  }

  const tenantIdFromBody =
    cleanText(body?.tenantId) || cleanText(url.searchParams.get("tenantId"));
  if (tenantIdFromBody && isUuid(tenantIdFromBody)) {
    return { tenantId: tenantIdFromBody, error: "", status: 200 };
  }

  return {
    tenantId: "",
    error: "No se pudo resolver tenant actual",
    status: 400,
  };
}

async function fetchServiceById(id: string, tenantId: string) {
  const withCreated = await supabaseAdmin
    .from("services")
    .select(SERVICE_SELECT)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!withCreated.error) return withCreated;

  return supabaseAdmin
    .from("services")
    .select(SERVICE_SELECT_NO_CREATED)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
}

async function selectChangedService(id: string, tenantId: string) {
  const { data, error } = await fetchServiceById(id, tenantId);
  if (error) return { service: null, error };
  return { service: data ? normalizeService(data) : null, error: null };
}

export async function GET(req: Request) {
  try {
    if (!(await requireUser(req))) return jsonError("Unauthorized", 401);

    const tenant = await resolveTenantId(req);
    if (!tenant.tenantId) return jsonError(tenant.error, tenant.status);

    const withCreated = await supabaseAdmin
      .from("services")
      .select(SERVICE_SELECT)
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false });

    const result = withCreated.error
      ? await supabaseAdmin
          .from("services")
          .select(SERVICE_SELECT_NO_CREATED)
          .eq("tenant_id", tenant.tenantId)
          .order("name", { ascending: true })
      : withCreated;

    if (result.error) {
      console.error("[api/admin/services] list error:", result.error);
      return jsonError(result.error.message, 500);
    }

    const services = (result.data ?? []).map((row) => normalizeService(row));
    return NextResponse.json({ ok: true, services });
  } catch (error: any) {
    console.error("[api/admin/services] list unexpected:", error?.message || error);
    return jsonError(error?.message ?? "Error listando servicios", 500);
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireUser(req))) return jsonError("Unauthorized", 401);

    const body = await req.json().catch(() => null);
    const tenant = await resolveTenantId(req, body);
    if (!tenant.tenantId) return jsonError(tenant.error, tenant.status);

    const name = cleanText(body?.name);
    const description = cleanText(body?.description);
    const price = parseNonNegativeNumber(body?.price);
    const durationMin = parsePositiveInteger(
      body?.duration_min ?? body?.duration_minutes ?? body?.duration,
    );
    const isActive =
      typeof body?.is_active === "boolean"
        ? body.is_active
        : typeof body?.active === "boolean"
          ? body.active
          : true;
    const currency = cleanText(body?.currency) || "CLP";

    if (!name) return jsonError("name requerido", 400);
    if (price === null) {
      return jsonError("price debe ser un número mayor o igual a 0", 400);
    }
    if (durationMin === null) {
      return jsonError("duration debe ser un número mayor a 0", 400);
    }

    const payload = {
      tenant_id: tenant.tenantId,
      name,
      description: description || null,
      price,
      duration_min: durationMin,
      currency,
      is_active: isActive,
    };

    const { data, error } = await supabaseAdmin
      .from("services")
      .insert(payload)
      .select(SERVICE_SELECT_NO_CREATED)
      .single();

    if (error) {
      console.error("[api/admin/services] create error:", error);
      return jsonError(error.message, 500);
    }

    return NextResponse.json({ ok: true, service: normalizeService(data) });
  } catch (error: any) {
    console.error("[api/admin/services] create unexpected:", error?.message || error);
    return jsonError(error?.message ?? "Error creando servicio", 500);
  }
}

export async function PATCH(req: Request) {
  try {
    if (!(await requireUser(req))) return jsonError("Unauthorized", 401);

    const body = await req.json().catch(() => null);
    const tenant = await resolveTenantId(req, body);
    if (!tenant.tenantId) return jsonError(tenant.error, tenant.status);

    const serviceId = cleanText(body?.id ?? body?.serviceId);
    if (!serviceId || !isUuid(serviceId)) {
      return jsonError("id de servicio inválido", 400);
    }

    const existing = await fetchServiceById(serviceId, tenant.tenantId);
    if (existing.error) {
      console.error("[api/admin/services] lookup error:", existing.error);
      return jsonError(existing.error.message, 500);
    }
    if (!existing.data) {
      return jsonError("Servicio no encontrado para este tenant", 404);
    }

    const update: Record<string, unknown> = {};

    if ("name" in (body ?? {})) {
      const name = cleanText(body?.name);
      if (!name) return jsonError("name requerido", 400);
      update.name = name;
    }
    if ("description" in (body ?? {})) {
      const description = cleanText(body?.description);
      update.description = description || null;
    }
    if ("price" in (body ?? {})) {
      const price = parseNonNegativeNumber(body?.price);
      if (price === null) {
        return jsonError("price debe ser un número mayor o igual a 0", 400);
      }
      update.price = price;
    }
    if (
      "duration" in (body ?? {}) ||
      "duration_min" in (body ?? {}) ||
      "duration_minutes" in (body ?? {})
    ) {
      const durationMin = parsePositiveInteger(
        body?.duration_min ?? body?.duration_minutes ?? body?.duration,
      );
      if (durationMin === null) {
        return jsonError("duration debe ser un número mayor a 0", 400);
      }
      update.duration_min = durationMin;
    }
    if ("currency" in (body ?? {})) {
      update.currency = cleanText(body?.currency) || "CLP";
    }
    if ("is_active" in (body ?? {}) || "active" in (body ?? {})) {
      update.is_active =
        typeof body?.is_active === "boolean"
          ? body.is_active
          : typeof body?.active === "boolean"
            ? body.active
            : true;
    }

    if (Object.keys(update).length === 0) {
      const service = normalizeService(existing.data);
      return NextResponse.json({ ok: true, service });
    }

    const { error } = await supabaseAdmin
      .from("services")
      .update(update)
      .eq("id", serviceId)
      .eq("tenant_id", tenant.tenantId);

    if (error) {
      console.error("[api/admin/services] update error:", error);
      return jsonError(error.message, 500);
    }

    const { service, error: selectError } = await selectChangedService(
      serviceId,
      tenant.tenantId,
    );
    if (selectError) return jsonError(selectError.message, 500);
    if (!service) return jsonError("Servicio no encontrado para este tenant", 404);

    return NextResponse.json({ ok: true, service });
  } catch (error: any) {
    console.error("[api/admin/services] update unexpected:", error?.message || error);
    return jsonError(error?.message ?? "Error actualizando servicio", 500);
  }
}

export async function DELETE(req: Request) {
  try {
    if (!(await requireUser(req))) return jsonError("Unauthorized", 401);

    const url = new URL(req.url);
    const body = await req.json().catch(() => null);
    const tenant = await resolveTenantId(req, body);
    if (!tenant.tenantId) return jsonError(tenant.error, tenant.status);

    const serviceId =
      cleanText(body?.id ?? body?.serviceId) || cleanText(url.searchParams.get("id"));
    if (!serviceId || !isUuid(serviceId)) {
      return jsonError("id de servicio inválido", 400);
    }

    const existing = await fetchServiceById(serviceId, tenant.tenantId);
    if (existing.error) return jsonError(existing.error.message, 500);
    if (!existing.data) {
      return jsonError("Servicio no encontrado para este tenant", 404);
    }

    const { error } = await supabaseAdmin
      .from("services")
      .update({ is_active: false })
      .eq("id", serviceId)
      .eq("tenant_id", tenant.tenantId);

    if (error) {
      console.error("[api/admin/services] deactivate error:", error);
      return jsonError(error.message, 500);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error(
      "[api/admin/services] deactivate unexpected:",
      error?.message || error,
    );
    return jsonError(error?.message ?? "Error desactivando servicio", 500);
  }
}
