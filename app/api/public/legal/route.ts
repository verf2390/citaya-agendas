import { NextResponse } from "next/server";

import {
  getPublicLegalBundleByTenantId,
  resolveTenantForPublicRequest,
} from "@/lib/legal/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("tenant")?.trim() ?? "";
  const tenant = await resolveTenantForPublicRequest(req, slug);
  if (!tenant) {
    return NextResponse.json({ ok: false, error: "No disponible" }, { status: 404 });
  }
  const bundle = await getPublicLegalBundleByTenantId(tenant.id, tenant.slug);
  if (!bundle) {
    return NextResponse.json({ ok: false, error: "No disponible" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, legal: bundle }, {
    headers: { "Cache-Control": "no-store" },
  });
}
