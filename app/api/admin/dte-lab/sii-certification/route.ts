export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { resolve } from "node:path";

import { readSmokeTrace } from "@/lib/dte/persistence/dte-smoke-trace";
import { getSubmissionStatus, getSiiCertificationConfigFromEnv } from "@/lib/dte/sii/sii-certification-client";
import { SiiCertificationError } from "@/lib/dte/sii/sii-errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type SiiCertificationRequest = {
  tenantId?: string;
  tenantSlug?: string;
  operation?: "readiness" | "dry-run" | "status" | "submit";
  trackId?: string;
};

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function getHostnameFromReq(req: Request): string {
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";

  return host.split(",")[0]?.trim().split(":")[0] ?? "";
}

function getTenantSlugFromReq(
  req: Request,
  body?: SiiCertificationRequest | null,
): string {
  return (
    getTenantSlugFromHostname(getHostnameFromReq(req)) ||
    String(body?.tenantSlug ?? "").trim()
  );
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

async function validateTenantAccess(
  req: Request,
  tenantId: string,
  body?: SiiCertificationRequest | null,
) {
  const tenantSlug = getTenantSlugFromReq(req, body);

  if (!tenantSlug) {
    return {
      ok: false as const,
      error: "No se pudo detectar el tenant actual",
      status: 400,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id, slug")
    .eq("id", tenantId)
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (error || !data?.id) {
    return {
      ok: false as const,
      error: "Tenant no autorizado o inexistente",
      status: 403,
    };
  }

  return { ok: true as const };
}

function configSnapshot() {
  const config = getSiiCertificationConfigFromEnv();
  return {
    environment: config.environment,
    seedToken:
      config.seedUrl && config.tokenUrl ? "configurado" : "pendiente",
    submit: config.submitUrl ? "listo tecnicamente" : "pendiente",
    status: config.statusUrl ? "listo tecnicamente" : "pendiente",
    production: "bloqueada hasta aprobacion SII",
    enableSubmit: config.enableSubmit,
  };
}

function traceSnapshot() {
  const tracePath = resolve(
    process.cwd(),
    "tmp/dte-certification/smoke-submission-log.json",
  );
  const lastDryRun = readSmokeTrace(tracePath);
  return {
    lastDryRun,
    lastBlockedSubmitAttempt:
      lastDryRun?.lastAuditAction === "sii_submit_blocked" ? lastDryRun : null,
    statusCheckHistory: [],
  };
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    }

    const body = (await req.json().catch(() => null)) as SiiCertificationRequest | null;
    const tenantId = String(body?.tenantId ?? "").trim();
    const operation = body?.operation ?? "dry-run";

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido para SII certification" },
        { status: 400 },
      );
    }

    const tenantAccess = await validateTenantAccess(req, tenantId, body);
    if (!tenantAccess.ok) {
      return NextResponse.json(
        { ok: false, error: tenantAccess.error },
        { status: tenantAccess.status },
      );
    }

    if (operation === "submit") {
      const history = traceSnapshot();
      return NextResponse.json(
        {
          ok: false,
          error:
            "SII_SUBMIT_PENDING_REAL_CERTIFICATION: submit real bloqueado desde UI.",
          history,
        },
        { status: 423 },
      );
    }

    if (operation === "status") {
      const trackId = String(body?.trackId ?? "").trim();
      if (!trackId) {
        return NextResponse.json(
          { ok: false, error: "track_id requerido para consultar estado" },
          { status: 400 },
        );
      }
      const result = await getSubmissionStatus(trackId, getSiiCertificationConfigFromEnv(), {
        dryRun: true,
      });
      return NextResponse.json({ ok: result.ok, result });
    }

    return NextResponse.json({
      ok: true,
      globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
      operation,
      certification: configSnapshot(),
      history: traceSnapshot(),
      warning:
        "Esta API prepara certification SII. No emite documentos legales ni habilita produccion.",
    });
  } catch (error) {
    const message =
      error instanceof SiiCertificationError || error instanceof Error
        ? error.message
        : "Error SII certification";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
