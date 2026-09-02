export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  requireProductionAdmin,
  safeProductionApiError,
} from "@/lib/dte/production/api";
import { createServerProductionDteService } from "@/lib/dte/production/server";
import type { ProductionDraftInput } from "@/lib/dte/production/types";

type DraftRequest = Omit<ProductionDraftInput, "tenantId"> & {
  tenantId?: string;
  tenantSlug?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DraftRequest;
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
    const document = await createServerProductionDteService().createDraft(
      {
        tenantId: auth.tenantId,
        dteType: body.dteType,
        businessOperationId: body.businessOperationId,
        recipient: body.recipient,
        lines: body.lines,
        references: body.references,
      },
      auth.userId,
    );
    return NextResponse.json({ ok: true, document });
  } catch (error) {
    return safeProductionApiError(error);
  }
}
