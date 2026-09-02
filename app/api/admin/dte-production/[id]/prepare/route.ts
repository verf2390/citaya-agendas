export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  requireProductionAdmin,
  safeProductionApiError,
} from "@/lib/dte/production/api";
import { createServerProductionDteService } from "@/lib/dte/production/server";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const body = (await req.json()) as {
      tenantId?: string;
      tenantSlug?: string;
    };
    const auth = await requireProductionAdmin(
      req,
      body.tenantId,
      body.tenantSlug,
    );
    if (!auth.ok)
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    const { id } = await context.params;
    const document = await createServerProductionDteService().prepare(
      auth.tenantId,
      id,
      auth.userId,
    );
    return NextResponse.json({ ok: true, document });
  } catch (error) {
    return safeProductionApiError(error);
  }
}
