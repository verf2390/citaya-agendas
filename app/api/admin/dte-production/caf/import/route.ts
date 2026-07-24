export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  requireProductionAdmin,
  safeProductionApiError,
} from "@/lib/dte/production/api";
import { importServerProductionCaf } from "@/lib/dte/production/server";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      tenantId?: string;
      tenantSlug?: string;
      dteType?: 33 | 56 | 61;
      expectedSha256?: string;
      expectedRange?: { from: number; to: number };
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
    if (
      ![33, 56, 61].includes(Number(body.dteType)) ||
      !/^[a-f0-9]{64}$/.test(String(body.expectedSha256 ?? ""))
    )
      throw new Error("DTE_CAF_IMPORT_INPUT_INVALID");
    const caf = await importServerProductionCaf({
      tenantId: auth.tenantId,
      dteType: Number(body.dteType) as 33 | 56 | 61,
      expectedSha256: String(body.expectedSha256),
      actorId: auth.userId,
      expectedRange: body.expectedRange,
    });
    return NextResponse.json({
      ok: true,
      caf: {
        id: caf.id,
        dteType: caf.dteType,
        rangeFrom: caf.rangeFrom,
        rangeTo: caf.rangeTo,
        sha256: caf.sha256,
        trustStatus: caf.trustStatus,
      },
    });
  } catch (error) {
    return safeProductionApiError(error);
  }
}
