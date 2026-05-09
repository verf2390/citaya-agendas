export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  createFolioStateFromCafLab,
  getFolioAvailability,
  markFolioUsed,
  reserveNextFolio,
} from "@/lib/dte/caf/folio-manager.lab";
import { parseCafLabXmlToData } from "@/lib/dte/caf/parse-caf";
import type { DteDocumentType } from "@/lib/dte/dte-types";
import type { TaxDocumentDraft } from "@/lib/dte/types";
import { validateRut } from "@/lib/dte/rut";
import { signXmlMockForLab } from "@/lib/dte/signing/sign-xml.placeholder";
import { buildBoletaXmlLab } from "@/lib/dte/xml/build-boleta";
import { buildFacturaXmlLab } from "@/lib/dte/xml/build-factura";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

type DteLabRequest = {
  tenantId?: string;
  tenantSlug?: string;
  legalName?: string;
  taxId?: string;
  businessActivity?: string;
  taxAddress?: string;
  taxCommune?: string;
  taxCity?: string;
  taxEmail?: string;
  defaultDocumentType?: "boleta" | "factura" | "exenta";
};

const LAB_ISSUER_RUT = "76.123.456-0";
const LAB_RECIPIENT_RUT = "11.111.111-1";
const LAB_FOLIO_FROM = 1001;
const LAB_FOLIO_TO = 1010;

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function getHostnameFromReq(req: Request): string {
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";

  return host.split(",")[0]?.trim().split(":")[0] ?? "";
}

function getTenantSlugFromReq(
  req: Request,
  body?: DteLabRequest | null,
): string {
  return (
    getTenantSlugFromHostname(getHostnameFromReq(req)) ||
    String(body?.tenantSlug ?? "").trim()
  );
}

async function requireUser(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, error: "Unauthorized", status: 401 };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false as const, error: "Unauthorized", status: 401 };
  }

  return { ok: true as const };
}

/**
 * LAB security guard:
 * - validates authenticated request separately with requireUser()
 * - forces tenantId to match the tenant resolved from current host/subdomain
 * - accepts body.tenantSlug only as fallback when host cannot resolve tenant
 *
 * This is still not a full tenant-members authorization system.
 * Future hardening should replace this with requireTenantAdmin/tenant_members.
 */
async function validateTenantAccess(
  req: Request,
  tenantId: string,
  body?: DteLabRequest | null,
) {
  const tenantSlug = getTenantSlugFromReq(req, body);

  if (!tenantSlug) {
    return {
      ok: false as const,
      error: "No se pudo detectar el tenant actual",
      status: 400,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id, slug")
    .eq("id", tenantId)
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (error || !data?.id) {
    return {
      ok: false as const,
      error: "Tenant no autorizado o inexistente",
      status: 403,
    };
  }

  return {
    ok: true as const,
    tenantId: data.id as string,
    tenantSlug: data.slug as string,
  };
}

function textOrFallback(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function resolveDocumentType(
  input: DteLabRequest["defaultDocumentType"],
): DteDocumentType {
  return input === "factura" ? "factura_afecta" : "boleta_afecta";
}

function buildDummyCafXml(
  issuerRut: string,
  documentType: DteDocumentType,
): string {
  const siiType = documentType === "factura_afecta" ? 33 : 39;

  return `
<AUTORIZACION>
  <CAF version="1.0">
    <DA>
      <RE>${issuerRut}</RE>
      <TD>${siiType}</TD>
      <RNG>
        <D>${LAB_FOLIO_FROM}</D>
        <H>${LAB_FOLIO_TO}</H>
      </RNG>
      <FA>${new Date().toISOString().slice(0, 10)}</FA>
    </DA>
  </CAF>
</AUTORIZACION>`;
}

function buildDraft(body: DteLabRequest, folio: number): TaxDocumentDraft {
  const documentType = resolveDocumentType(body.defaultDocumentType);
  const issuerRut = validateRut(String(body.taxId ?? ""))
    ? String(body.taxId)
    : LAB_ISSUER_RUT;

  return {
    tenantId: String(body.tenantId),
    issueMode: "citaya_own_dte",
    documentType,
    status: "draft",
    folio,
    issueDate: new Date().toISOString().slice(0, 10),
    issuer: {
      tenantId: String(body.tenantId),
      rut: issuerRut,
      legalName: textOrFallback(
        body.legalName,
        "Centro Psicológico Armonía SpA",
      ),
      businessActivity: textOrFallback(
        body.businessActivity,
        "Servicios profesionales",
      ),
      address: textOrFallback(body.taxAddress, "Av. Demo 123"),
      commune: textOrFallback(body.taxCommune, "La Serena"),
      city: textOrFallback(body.taxCity, "La Serena"),
      dteEnvironment: "certification",
    },
    recipient: {
      rut: LAB_RECIPIENT_RUT,
      legalName: "Cliente Demo",
      businessActivity: "Persona natural",
      address: "Sin dirección",
      commune: "La Serena",
      city: "La Serena",
      email: "cliente.demo@example.com",
    },
    lines: [
      {
        name: "Reserva demo Citaya",
        description: "Detalle de laboratorio sin validez tributaria",
        quantity: 1,
        unitPrice: 11900,
        amount: 11900,
      },
    ],
    netAmount: 10000,
    taxAmount: 1900,
    exemptAmount: 0,
    totalAmount: 11900,
  };
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    }

    const body = (await req.json().catch(() => null)) as DteLabRequest | null;
    const tenantId = String(body?.tenantId ?? "").trim();

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido para laboratorio DTE" },
        { status: 400 },
      );
    }

    const tenantAccess = await validateTenantAccess(req, tenantId, body);

    if (!tenantAccess.ok) {
      return NextResponse.json(
        { ok: false, error: tenantAccess.error },
        { status: tenantAccess.status },
      );
    }

    const requestedDocumentType = resolveDocumentType(body?.defaultDocumentType);
    const issuerRut = validateRut(String(body?.taxId ?? ""))
      ? String(body?.taxId)
      : LAB_ISSUER_RUT;

    const cafXml = buildDummyCafXml(issuerRut, requestedDocumentType);
    const caf = parseCafLabXmlToData(cafXml, tenantAccess.tenantId);
    const initialFolioState = createFolioStateFromCafLab(caf);
    const reserved = reserveNextFolio(initialFolioState);

    const draft = buildDraft(
      {
        ...(body ?? {}),
        tenantId: tenantAccess.tenantId,
        tenantSlug: tenantAccess.tenantSlug,
      },
      reserved.reservation.folio,
    );

    const xmlResult =
      draft.documentType === "factura_afecta"
        ? buildFacturaXmlLab(draft)
        : buildBoletaXmlLab(draft);

    if (!xmlResult.ok) {
      return NextResponse.json(
        { ok: false, error: xmlResult.error },
        { status: 400 },
      );
    }

    const signature = signXmlMockForLab(xmlResult.xml, {
      signatureTarget: `CitayaDocLab-${draft.documentType}-${draft.folio}`,
      mode: "mock",
    });

    const used = markFolioUsed(
      reserved.state,
      reserved.reservation,
      `lab-${draft.documentType}-${draft.folio}`,
    );

    const folioAvailability = getFolioAvailability(used.state);

    return NextResponse.json({
      ok: true,
      xml: signature.signedXml,
      metadata: {
        tipoDte: draft.documentType,
        folioDummy: draft.folio,
        rutEmisor: draft.issuer.rut,
        rutReceptor: draft.recipient.rut,
        montoTotal: draft.totalAmount,
        modo: "lab",
        xsdStatus: "pending",
        firma: "mock",
        caf: "dummy",
        estadoSii: "simulated",
        advertencia: "XML de laboratorio no válido para producción.",
        isProductionValid: false,
      },
      caf: {
        mode: caf.mode,
        isProductionValid: caf.isProductionValid,
        range: `${caf.rangeFrom}-${caf.rangeTo}`,
        rangeFrom: caf.rangeFrom,
        rangeTo: caf.rangeTo,
        rawXmlHash: caf.rawXmlHash,
      },
      folio: {
        reservedFolio: reserved.reservation.folio,
        reservationStatus: reserved.reservation.status,
        simulatedUsageStatus: used.reservation.status,
        availability: folioAvailability,
      },
      signature: {
        signatureId: signature.signatureId,
        signedAt: signature.signedAt,
        mode: signature.mode,
        xsdReference: signature.xsdReference,
        isProductionValid: signature.isProductionValid,
        warnings: signature.warnings,
      },
      warnings: [
        ...xmlResult.warnings,
        ...signature.warnings,
        "CAF y folios son dummy/lab; no consumen folios reales SII.",
        "No se escribió en base de datos, no se envió al SII y no se usaron secretos.",
      ],
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error generando XML DTE de laboratorio",
      },
      { status: 500 },
    );
  }
}