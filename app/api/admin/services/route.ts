export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type TenantResolution = {
  tenantId: string;
  error: string;
  status: number;
};

const SERVICE_SELECT =
  "id,tenant_id,name,description,public_description,internal_description,tax_description,tax_description_review_status,contains_potentially_sensitive_information,payment_policy,deposit_type,deposit_value,provisional_expiry_minutes,payment_configuration_complete,duration_min,price,currency,is_active,created_at";
const SERVICE_SELECT_NO_CREATED =
  "id,tenant_id,name,description,public_description,internal_description,tax_description,tax_description_review_status,contains_potentially_sensitive_information,payment_policy,deposit_type,deposit_value,provisional_expiry_minutes,payment_configuration_complete,duration_min,price,currency,is_active";

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
  return Number.isSafeInteger(numberValue) && numberValue >= 0 ? numberValue : null;
}

function parsePolicy(body: Record<string, unknown>, price: number) {
  const paymentPolicy = String(body?.paymentPolicy ?? body?.payment_policy ?? "no_advance");
  const depositTypeRaw = body?.depositType ?? body?.deposit_type ?? null;
  const depositType = depositTypeRaw === "" ? null : depositTypeRaw;
  const depositValueRaw = body?.depositValue ?? body?.deposit_value ?? null;
  const depositValue = depositValueRaw == null || depositValueRaw === ""
    ? null
    : parseNonNegativeNumber(depositValueRaw);
  const expiry = parsePositiveInteger(body?.provisionalExpiryMinutes ?? body?.provisional_expiry_minutes ?? 30);
  if (!new Set(["no_advance", "deposit", "full_payment"]).has(paymentPolicy)) return null;
  if (!expiry || expiry > 10080) return null;
  if (paymentPolicy !== "deposit") return {
    payment_policy: paymentPolicy, deposit_type: null, deposit_value: null,
    provisional_expiry_minutes: expiry, payment_configuration_complete: true,
  };
  if (depositType === "fixed_amount" && depositValue != null && depositValue > 0 && depositValue <= price) {
    return { payment_policy: paymentPolicy, deposit_type: depositType, deposit_value: depositValue,
      provisional_expiry_minutes: expiry, payment_configuration_complete: true };
  }
  if (depositType === "percentage" && depositValue != null && depositValue >= 1 && depositValue <= 10000) {
    return { payment_policy: paymentPolicy, deposit_type: depositType, deposit_value: depositValue,
      provisional_expiry_minutes: expiry, payment_configuration_complete: true };
  }
  return null;
}

function parsePositiveInteger(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return Math.round(numberValue);
}

function normalizeService(row: Record<string, unknown>) {
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
    public_description: row.public_description ?? null,
    internal_description: row.internal_description ?? null,
    tax_description: row.tax_description ?? null,
    duration_min: typeof duration === "number" ? duration : null,
    price: typeof row.price === "number" ? row.price : row.price ?? null,
    currency: row.currency ?? "CLP",
    is_active: active,
  };
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function resolveTenantId(
  req: Request,
  body?: Record<string, unknown> | null,
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
    const tenant = await resolveTenantId(req);
    if (!tenant.tenantId) return jsonError(tenant.error, tenant.status);
    const access = await requireTenantAdmin({ req, tenantId: tenant.tenantId });
    if (!access.ok) return jsonError(access.error, access.status);

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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error listando servicios";
    console.error("[api/admin/services] list unexpected:", message);
    return jsonError(message, 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return jsonError("JSON inválido", 400);
    const tenant = await resolveTenantId(req, body);
    if (!tenant.tenantId) return jsonError(tenant.error, tenant.status);
    const access = await requireTenantAdmin({ req, tenantId: tenant.tenantId });
    if (!access.ok) return jsonError(access.error, access.status);

    const name = cleanText(body?.name);
    const description = cleanText(body?.description);
    const publicDescription = cleanText(body?.publicDescription ?? body?.public_description);
    const internalDescription = cleanText(body?.internalDescription ?? body?.internal_description);
    const taxDescription = cleanText(body?.taxDescription ?? body?.tax_description);
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
    const policy = parsePolicy(body, price);
    if (!policy) return jsonError("Configuración de pago inválida", 400);
    const taxReviewStatus = body?.taxDescriptionApproved === true ? "approved" : "pending";
    if (taxReviewStatus === "approved" && !taxDescription) return jsonError("La descripción tributaria aprobada es obligatoria", 400);
    if (isActive && taxReviewStatus !== "approved") return jsonError("Revisa y aprueba la descripción tributaria antes de publicar el servicio", 409);

    const payload = {
      tenant_id: tenant.tenantId,
      name,
      description: description || null,
      public_description: publicDescription || null,
      internal_description: internalDescription || null,
      tax_description: taxDescription || null,
      tax_description_review_status: taxReviewStatus,
      contains_potentially_sensitive_information: body?.containsPotentiallySensitiveInformation === true,
      ...policy,
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error creando servicio";
    console.error("[api/admin/services] create unexpected:", message);
    return jsonError(message, 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return jsonError("JSON inválido", 400);
    const tenant = await resolveTenantId(req, body);
    if (!tenant.tenantId) return jsonError(tenant.error, tenant.status);
    const access = await requireTenantAdmin({ req, tenantId: tenant.tenantId });
    if (!access.ok) return jsonError(access.error, access.status);

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
    if ("publicDescription" in (body ?? {}) || "public_description" in (body ?? {})) {
      update.public_description = cleanText(body?.publicDescription ?? body?.public_description) || null;
    }
    if ("internalDescription" in (body ?? {}) || "internal_description" in (body ?? {})) {
      update.internal_description = cleanText(body?.internalDescription ?? body?.internal_description) || null;
    }
    if ("taxDescription" in (body ?? {}) || "tax_description" in (body ?? {})) {
      update.tax_description = cleanText(body?.taxDescription ?? body?.tax_description) || null;
      update.tax_description_review_status = "pending";
    }
    if ("containsPotentiallySensitiveInformation" in (body ?? {})) {
      update.contains_potentially_sensitive_information = body.containsPotentiallySensitiveInformation === true;
    }
    if ("price" in (body ?? {})) {
      const price = parseNonNegativeNumber(body?.price);
      if (price === null) {
        return jsonError("price debe ser un número mayor o igual a 0", 400);
      }
      update.price = price;
    }
    const changesPolicy = ["paymentPolicy","payment_policy","depositType","deposit_type","depositValue","deposit_value","provisionalExpiryMinutes","provisional_expiry_minutes"]
      .some((key) => key in (body ?? {}));
    if (changesPolicy) {
      const nextPrice = Number(update.price ?? existing.data.price ?? 0);
      const policy = parsePolicy({ ...existing.data, ...body }, nextPrice);
      if (!policy) return jsonError("Configuración de pago inválida", 400);
      Object.assign(update, policy);
    }
    if ("taxDescriptionApproved" in (body ?? {})) {
      const taxDescription = String(update.tax_description ?? existing.data.tax_description ?? "").trim();
      if (body.taxDescriptionApproved === true && !taxDescription) return jsonError("La descripción tributaria aprobada es obligatoria", 400);
      update.tax_description_review_status = body.taxDescriptionApproved === true ? "approved" : "pending";
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
      const nextActive =
        typeof body?.is_active === "boolean"
          ? body.is_active
          : typeof body?.active === "boolean"
            ? body.active
            : true;
      const review = String(update.tax_description_review_status ?? existing.data.tax_description_review_status ?? "pending");
      const paymentComplete = Boolean(update.payment_configuration_complete ?? existing.data.payment_configuration_complete);
      if (nextActive && (review !== "approved" || !paymentComplete)) {
        return jsonError("El servicio requiere descripción tributaria aprobada y condición de pago completa", 409);
      }
      update.is_active = nextActive;
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error actualizando servicio";
    console.error("[api/admin/services] update unexpected:", message);
    return jsonError(message, 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return jsonError("JSON inválido", 400);
    const tenant = await resolveTenantId(req, body);
    if (!tenant.tenantId) return jsonError(tenant.error, tenant.status);
    const access = await requireTenantAdmin({ req, tenantId: tenant.tenantId });
    if (!access.ok) return jsonError(access.error, access.status);

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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desactivando servicio";
    console.error(
      "[api/admin/services] deactivate unexpected:",
      message,
    );
    return jsonError(message, 500);
  }
}
