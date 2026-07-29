export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { loadAdminDocumentRows } from "@/lib/dte/admin-document-rows";

export async function GET(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  try {
    const documents = await loadAdminDocumentRows(auth.tenantId);
    return NextResponse.json({ ok: true, documents });
  } catch {
    return NextResponse.json(
      { ok: false, error: "No se pudieron actualizar los documentos." },
      { status: 503 },
    );
  }
}
