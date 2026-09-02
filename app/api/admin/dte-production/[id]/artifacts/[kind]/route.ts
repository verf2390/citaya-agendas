export const runtime = "nodejs";

import {
  requireProductionAdmin,
  safeProductionApiError,
} from "@/lib/dte/production/api";
import { createServerProductionDteService } from "@/lib/dte/production/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string; kind: string }> },
) {
  try {
    const url = new URL(req.url);
    const auth = await requireProductionAdmin(
      req,
      url.searchParams.get("tenantId"),
      url.searchParams.get("tenantSlug"),
    );
    if (!auth.ok)
      return Response.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    const { id, kind } = await context.params;
    if (kind !== "dte_xml" && kind !== "pdf")
      throw new Error("DTE_ARTIFACT_KIND_INVALID");
    const audit = await supabaseAdmin.from("restricted_data_access_audit").insert({
      tenant_id: auth.tenantId,
      actor_user_id: auth.userId,
      resource_type: "dte_artifact",
      resource_id: id,
      action: "DOWNLOAD",
      safe_context: { kind },
    });
    if (audit.error) throw new Error("DTE_RESTRICTED_ACCESS_AUDIT_FAILED");
    const artifact = await createServerProductionDteService().download(
      auth.tenantId,
      id,
      kind,
    );
    return new Response(new Uint8Array(artifact.bytes), {
      headers: {
        "content-type": artifact.contentType,
        "content-disposition": `attachment; filename="${artifact.fileName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return safeProductionApiError(error);
  }
}
