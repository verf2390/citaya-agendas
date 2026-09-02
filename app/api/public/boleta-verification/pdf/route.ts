export const runtime = "nodejs";

import { verifyBoletaPdfGrant } from "@/lib/dte/public-boleta-verification";
import { createServerProductionDteService } from "@/lib/dte/production/server";
import { loadTenantOperationalContext } from "@/lib/tenant/operational-server";

export async function GET(req: Request) {
  const grant = verifyBoletaPdfGrant(new URL(req.url).searchParams.get("grant") ?? "");
  if (!grant) return new Response("Enlace inválido o vencido.", { status: 404 });
  try {
    const operational = await loadTenantOperationalContext(grant.tenantId);
    if (!operational.capabilities.publicTaxDocument) throw new Error("TENANT_MODE_PUBLIC_DTE_BLOCKED");
    const artifact = await createServerProductionDteService().download(
      grant.tenantId,
      grant.documentId,
      "pdf",
    );
    return new Response(new Uint8Array(artifact.bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${artifact.fileName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Representación no disponible.", { status: 404 });
  }
}
