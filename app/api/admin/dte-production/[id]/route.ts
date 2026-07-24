export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  requireProductionAdmin,
  safeProductionApiError,
} from "@/lib/dte/production/api";
import { createServerProductionDteService } from "@/lib/dte/production/server";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const url = new URL(req.url);
    const auth = await requireProductionAdmin(
      req,
      url.searchParams.get("tenantId"),
      url.searchParams.get("tenantSlug"),
    );
    if (!auth.ok)
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    const { id } = await context.params;
    const detail = await createServerProductionDteService().getSafeDetail(
      auth.tenantId,
      id,
    );
    return NextResponse.json({ ok: true, detail });
  } catch (error) {
    return safeProductionApiError(error);
  }
}
