export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createBoletaPdfGrant,
  matchesPublicBoletaVerification,
} from "@/lib/dte/public-boleta-verification";
import { normalizeRut, validateRut } from "@/lib/dte/rut";
import {
  consumeRateLimit,
  opaqueKey,
  requestIp,
} from "@/lib/security/request";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const Query = z.object({
  issuerRut: z.string().trim().min(8).max(16),
  documentType: z.literal(39),
  folio: z.number().int().positive().max(2_147_483_647),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalAmount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const notFound = () =>
  NextResponse.json(
    { ok: true, found: false, message: "No encontramos una boleta que coincida con todos los datos." },
    { headers: { "cache-control": "no-store" } },
  );

export async function POST(req: Request) {
  const parsed = Query.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !validateRut(parsed.data?.issuerRut ?? "")) {
    return NextResponse.json(
      { ok: false, error: "Revisa RUT, folio, fecha y total." },
      { status: 400 },
    );
  }
  const issuerRut = normalizeRut(parsed.data.issuerRut);
  const allowed = await consumeRateLimit({
    scope: "public_boleta_verification",
    key: opaqueKey(requestIp(req), issuerRut),
    limit: 8,
    windowSeconds: 15 * 60,
  });
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "Demasiadas consultas. Intenta más tarde." },
      { status: 429 },
    );
  }

  const issuer = await supabaseAdmin
    .from("dte_production_tenant_settings")
    .select("tenant_id,issuer_legal_name")
    .eq("issuer_rut", issuerRut)
    .maybeSingle();
  if (issuer.error || !issuer.data) return notFound();
  const document = await supabaseAdmin
    .from("dte_production_documents")
    .select("id,dte_type,folio,issue_date,total_amount,sii_status")
    .eq("tenant_id", issuer.data.tenant_id)
    .eq("dte_type", 39)
    .eq("folio", parsed.data.folio)
    .eq("issue_date", parsed.data.issueDate)
    .eq("total_amount", parsed.data.totalAmount)
    .maybeSingle();
  if (
    document.error ||
    !document.data ||
    !matchesPublicBoletaVerification(parsed.data, document.data)
  ) {
    return notFound();
  }
  const artifact = await supabaseAdmin
    .from("dte_production_artifacts")
    .select("id")
    .eq("tenant_id", issuer.data.tenant_id)
    .eq("document_id", document.data.id)
    .eq("kind", "pdf")
    .maybeSingle();

  return NextResponse.json(
    {
      ok: true,
      found: true,
      document: {
        issuer: issuer.data.issuer_legal_name,
        documentType: "Boleta Electrónica",
        folio: document.data.folio,
        issueDate: document.data.issue_date,
        totalAmount: Number(document.data.total_amount),
        status: "Aceptada por el SII",
        pdfUrl: artifact.data
          ? `/api/public/boleta-verification/pdf?grant=${encodeURIComponent(
              createBoletaPdfGrant({
                tenantId: issuer.data.tenant_id,
                documentId: document.data.id,
              }),
            )}`
          : null,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
