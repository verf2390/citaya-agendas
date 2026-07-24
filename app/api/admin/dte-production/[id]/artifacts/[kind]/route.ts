export const runtime = "nodejs";

import {
  requireProductionAdmin,
  safeProductionApiError,
} from "@/lib/dte/production/api";
import { createServerProductionDteService } from "@/lib/dte/production/server";

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
