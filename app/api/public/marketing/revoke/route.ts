import { NextResponse } from "next/server";

import { resolveTenantForPublicRequest } from "@/lib/legal/server";
import { consumeRateLimit, opaqueKey, requestIp } from "@/lib/security/request";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const tenantSlug = String(body?.tenantSlug ?? "").trim().toLowerCase();
  const channel = String(body?.channel ?? "email").trim().toLowerCase();
  const destination = String(body?.destination ?? "").trim().toLowerCase();
  if (!tenantSlug || channel !== "email" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
    return NextResponse.json({ ok: false, error: "Solicitud inválida" }, { status: 400 });
  }
  const tenant = await resolveTenantForPublicRequest(req, tenantSlug);
  if (!tenant) return NextResponse.json({ ok: false, error: "No disponible" }, { status: 404 });
  const allowed = await consumeRateLimit({
    scope: "marketing_revoke",
    key: opaqueKey(requestIp(req), tenant.id, destination),
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (!allowed) return NextResponse.json({ ok: false, error: "Demasiadas solicitudes" }, { status: 429 });
  const { error } = await supabaseAdmin.rpc("revoke_marketing_consent", {
    p_tenant_id: tenant.id,
    p_channel: channel,
    p_destination: destination,
    p_reason: "Revocación solicitada por el titular mediante el canal público",
  });
  if (error) return NextResponse.json({ ok: false, error: "No se pudo registrar la revocación" }, { status: 409 });
  return NextResponse.json({ ok: true, message: "La revocación fue registrada." });
}
