export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import { loadAdminAppointmentDocumentContexts } from "@/lib/dte/admin-appointment-document-context";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const;

function errorResponse(status: number, error: string) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function GET(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return errorResponse(auth.status, auth.error);

  const { searchParams } = new URL(req.url);
  const appointmentId = String(searchParams.get("appointmentId") ?? "").trim();
  if (!isUuid(appointmentId)) {
    return errorResponse(400, "appointmentId inválido.");
  }

  try {
    const [context] = await loadAdminAppointmentDocumentContexts(
      auth.tenantId,
      [appointmentId],
    );
    if (!context?.customerId) {
      return errorResponse(404, "Reserva no encontrada.");
    }
    return NextResponse.json(
      { ok: true, context },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return errorResponse(503, "No se pudo cargar el contexto tributario de la reserva.");
  }
}

export async function POST(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return errorResponse(auth.status, auth.error);

  const body = await req.json().catch(() => null);
  const rawIds = Array.isArray(body?.appointmentIds) ? body.appointmentIds : [];
  const appointmentIds = Array.from(
    new Set(
      rawIds
        .map((value: unknown) => String(value ?? "").trim())
        .filter((value: string) => isUuid(value)),
    ),
  ).slice(0, 200);

  if (appointmentIds.length === 0) {
    return NextResponse.json(
      { ok: true, contexts: [] },
      { headers: NO_STORE_HEADERS },
    );
  }

  try {
    const contexts = await loadAdminAppointmentDocumentContexts(
      auth.tenantId,
      appointmentIds,
    );
    return NextResponse.json(
      { ok: true, contexts },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return errorResponse(503, "No se pudieron cargar los estados tributarios.");
  }
}
