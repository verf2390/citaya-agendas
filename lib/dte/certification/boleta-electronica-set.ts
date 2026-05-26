import { createHash } from "node:crypto";

import { buildDteSetEnvelopeXmlLab } from "../xml/build-dte-envelope";
import { escapeXml } from "../xml/escape-xml";
import type {
  DteGenerationError,
  DteGenerationResult,
  TaxDocumentDraft,
  TenantTaxProfile,
} from "../types";

export type BoletaCertificationCaseId =
  | "CASO-1"
  | "CASO-2"
  | "CASO-3"
  | "CASO-4"
  | "CASO-5";

export type BoletaCertificationCase = {
  id: BoletaCertificationCaseId;
  source: "docs/dte-sii/certification-sets/set-prueba-boleta-electronica.txt";
  observation?: string;
  lines: Array<{
    name: string;
    quantity: number;
    unitPriceWithVat: number;
    exempt?: boolean;
    unitOfMeasure?: string;
  }>;
};

export type BoletaCertificationIssuerData = Partial<TenantTaxProfile> & {
  region?: string | null;
  software?: string | null;
  url?: string | null;
  representativeName?: string | null;
  representativeRut?: string | null;
  certificationEmail?: string | null;
};

export type BoletaCertificationSetBuildInput = {
  tenantId?: string;
  issuer?: BoletaCertificationIssuerData;
  issueDate?: string;
  firstFolio?: number;
};

export type BoletaPreCafCheckInput = {
  setXml: string;
  rcofXml: string;
  metadata?: Record<string, unknown> | null;
  cafPresent: boolean;
  cafKeyPresent: boolean;
};

export type BoletaPreCafCheckResult = {
  ok: boolean;
  status: "OK PARA BAJAR CAF" | "NO BAJAR CAF";
  checks: Array<{ key: string; ok: boolean; message: string }>;
  issuerDataReady: boolean;
  preCafReady: boolean;
};

const VAT_RATE = 0.19;

const EXPECTED_REAL_ISSUER = {
  rut: "78195645-7",
  rutWithDots: "78.195.645-7",
  legalName: "R&G SpA",
  commune: "Coquimbo",
  city: "Coquimbo",
  region: "Coquimbo",
  software: "CITAYA",
  url: "https://www.citaya.online",
} as const;

const DEMO_OR_PLACEHOLDER_PATTERNS = [
  /76123456-0/i,
  /76\.123\.456-0/i,
  /Empresa Demo Citaya/i,
  /\bDemo\b/i,
  /pendiente/i,
  /Direccion certification/i,
  /Giro certification/i,
];

function normalizeRutForXml(value: string): string {
  return value.replace(/\./g, "").toUpperCase();
}

function isBlank(value: string | null | undefined): boolean {
  return !String(value ?? "").trim();
}

function containsAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function unescapeXmlValue(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTagValues(xml: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, "g");
  return Array.from(xml.matchAll(pattern), (match) => unescapeXmlValue(match[1].trim()));
}

function hasTagValue(xml: string, tagName: string, expected: string): boolean {
  return extractTagValues(xml, tagName).includes(expected);
}

function sumTagValues(xml: string, tagName: string): number {
  return extractTagValues(xml, tagName).reduce((total, value) => total + Number(value), 0);
}

export function getExpectedRealBoletaIssuer(): typeof EXPECTED_REAL_ISSUER {
  return EXPECTED_REAL_ISSUER;
}

export function isBoletaIssuerDataReady(issuer: BoletaCertificationIssuerData): boolean {
  const searchable = [
    issuer.rut,
    issuer.legalName,
    issuer.businessActivity,
    issuer.address,
    issuer.commune,
    issuer.city,
    issuer.region,
    issuer.software,
    issuer.url,
  ].join(" ");

  return Boolean(
    normalizeRutForXml(String(issuer.rut ?? "")) === EXPECTED_REAL_ISSUER.rut &&
      issuer.legalName === EXPECTED_REAL_ISSUER.legalName &&
      !isBlank(issuer.businessActivity) &&
      !isBlank(issuer.address) &&
      issuer.commune === EXPECTED_REAL_ISSUER.commune &&
      issuer.city === EXPECTED_REAL_ISSUER.city &&
      issuer.region === EXPECTED_REAL_ISSUER.region &&
      issuer.software === EXPECTED_REAL_ISSUER.software &&
      issuer.url === EXPECTED_REAL_ISSUER.url &&
      !containsAny(searchable, DEMO_OR_PLACEHOLDER_PATTERNS) &&
      !/DIVIR|Providencia|Santiago/i.test(searchable),
  );
}


export const BOLETA_ELECTRONICA_CERTIFICATION_CASES: BoletaCertificationCase[] = [
  {
    id: "CASO-1",
    source: "docs/dte-sii/certification-sets/set-prueba-boleta-electronica.txt",
    lines: [
      { name: "Cambio de aceite", quantity: 1, unitPriceWithVat: 19900 },
      { name: "Alineacion y balanceo", quantity: 1, unitPriceWithVat: 9900 },
    ],
  },
  {
    id: "CASO-2",
    source: "docs/dte-sii/certification-sets/set-prueba-boleta-electronica.txt",
    lines: [{ name: "Papel de regalo", quantity: 17, unitPriceWithVat: 120 }],
  },
  {
    id: "CASO-3",
    source: "docs/dte-sii/certification-sets/set-prueba-boleta-electronica.txt",
    lines: [
      { name: "Sandwic", quantity: 2, unitPriceWithVat: 1500 },
      { name: "Bebida", quantity: 2, unitPriceWithVat: 550 },
    ],
  },
  {
    id: "CASO-4",
    source: "docs/dte-sii/certification-sets/set-prueba-boleta-electronica.txt",
    observation: "El item 1 es un servicio afecto. El item 2 es un servicio exento.",
    lines: [
      { name: "item afecto 1", quantity: 8, unitPriceWithVat: 1590 },
      { name: "item exento 2", quantity: 2, unitPriceWithVat: 1000, exempt: true },
    ],
  },
  {
    id: "CASO-5",
    source: "docs/dte-sii/certification-sets/set-prueba-boleta-electronica.txt",
    observation: "Se debe informar en el XML Unidad de medida en Kg.",
    lines: [{ name: "Arroz", quantity: 5, unitPriceWithVat: 700, unitOfMeasure: "Kg" }],
  },
];

function roundPeso(value: number): number {
  return Math.round(value);
}

function defaultIssuer(input: BoletaCertificationSetBuildInput): TenantTaxProfile {
  const tenantId = input.tenantId ?? input.issuer?.tenantId ?? "tenant-lab-citaya";

  return {
    tenantId,
    rut: input.issuer?.rut ?? "00000000-0",
    legalName: input.issuer?.legalName ?? "EMISOR_NO_CONFIGURADO",
    businessActivity: input.issuer?.businessActivity ?? "EMISOR_NO_CONFIGURADO",
    businessActivityCode: input.issuer?.businessActivityCode ?? null,
    address: input.issuer?.address ?? "EMISOR_NO_CONFIGURADO",
    commune: input.issuer?.commune ?? "EMISOR_NO_CONFIGURADO",
    city: input.issuer?.city ?? "EMISOR_NO_CONFIGURADO",
    siiResolutionDate: input.issuer?.siiResolutionDate ?? "2006-01-01",
    siiResolutionNumber: input.issuer?.siiResolutionNumber ?? "0",
    dteEnvironment: "certification",
  };
}

function totalsForCase(certificationCase: BoletaCertificationCase): {
  netAmount: number;
  exemptAmount: number;
  taxAmount: number;
  totalAmount: number;
} {
  const exemptAmount = certificationCase.lines
    .filter((line) => line.exempt)
    .reduce((total, line) => total + line.quantity * line.unitPriceWithVat, 0);
  const affectedTotal = certificationCase.lines
    .filter((line) => !line.exempt)
    .reduce((total, line) => total + line.quantity * line.unitPriceWithVat, 0);
  const netAmount = roundPeso(affectedTotal / (1 + VAT_RATE));
  const taxAmount = affectedTotal - netAmount;

  return {
    netAmount,
    exemptAmount,
    taxAmount,
    totalAmount: affectedTotal + exemptAmount,
  };
}

export function buildBoletaCertificationDrafts(
  input: BoletaCertificationSetBuildInput = {},
): TaxDocumentDraft[] {
  const issuer = defaultIssuer(input);
  const issueDate = input.issueDate ?? "2026-05-25";
  const firstFolio = input.firstFolio ?? 1;

  return BOLETA_ELECTRONICA_CERTIFICATION_CASES.map((certificationCase, index) => {
    const totals = totalsForCase(certificationCase);

    return {
      tenantId: issuer.tenantId,
      issueMode: "citaya_own_dte",
      documentType: "boleta_afecta",
      status: "draft",
      folio: firstFolio + index,
      issueDate,
      issuer,
      recipient: {
        rut: "11.111.111-1",
        legalName: "Cliente Certification Boleta",
        businessActivity: "Persona natural",
        address: "Direccion receptor certification",
        commune: "Comuna receptor certification",
        city: "Ciudad receptor certification",
        email: "cliente.certification@example.test",
      },
      lines: certificationCase.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPriceWithVat,
        amount: line.quantity * line.unitPriceWithVat,
        exempt: line.exempt,
        unitOfMeasure: line.unitOfMeasure,
      })),
      references: [
        {
          code: "SET",
          reason: certificationCase.id,
        },
      ],
      ...totals,
    } satisfies TaxDocumentDraft;
  });
}

export function buildBoletaCertificationSetEnvelopeXmlLab(
  drafts: TaxDocumentDraft[],
): DteGenerationResult | DteGenerationError {
  return buildDteSetEnvelopeXmlLab(drafts, {
    mode: "lab",
    setDteId: `CitayaBoletaSet39Lab-${drafts[0]?.tenantId ?? "sin-tenant"}`,
  });
}

export function buildRcofXmlLab(drafts: TaxDocumentDraft[]): string {
  if (drafts.length === 0) {
    throw new Error("At least one boleta draft is required for RCOF");
  }

  const firstDraft = drafts[0];
  const issuer = firstDraft.issuer;
  const netAmount = drafts.reduce((total, draft) => total + (draft.netAmount ?? 0), 0);
  const exemptAmount = drafts.reduce((total, draft) => total + (draft.exemptAmount ?? 0), 0);
  const taxAmount = drafts.reduce((total, draft) => total + (draft.taxAmount ?? 0), 0);
  const totalAmount = drafts.reduce((total, draft) => total + draft.totalAmount, 0);
  const minFolio = Math.min(...drafts.map((draft) => draft.folio));
  const maxFolio = Math.max(...drafts.map((draft) => draft.folio));
  const issuedAt = `${firstDraft.issueDate}T00:00:00`;
  const summaryId = `CitayaRcofLab-39-${minFolio}-${maxFolio}`;

  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<!--
  Citaya RCOF Lab XML - NO PRODUCTIVO.
  Resumen previo para set de boletas electronicas tipo 39.
  No esta firmado, no consume CAF real y no debe enviarse al SII.
-->
<ConsumoFolios xmlns="http://www.sii.cl/SiiDte" version="1.0">
  <DocumentoConsumoFolios ID="${summaryId}">
    <Caratula version="1.0">
      <RutEmisor>${escapeXml(issuer.rut.replace(/\./g, ""))}</RutEmisor>
      <FchResol>${escapeXml(issuer.siiResolutionDate ?? "2006-01-01")}</FchResol>
      <NroResol>${escapeXml(issuer.siiResolutionNumber ?? "0")}</NroResol>
      <FchInicio>${escapeXml(firstDraft.issueDate)}</FchInicio>
      <FchFinal>${escapeXml(firstDraft.issueDate)}</FchFinal>
      <SecEnvio>1</SecEnvio>
      <TmstFirmaEnv>${issuedAt}</TmstFirmaEnv>
    </Caratula>
    <Resumen>
      <TipoDocumento>39</TipoDocumento>
      <MntNeto>${netAmount}</MntNeto>
      <MntIva>${taxAmount}</MntIva>
      <TasaIVA>19</TasaIVA>
      <MntExento>${exemptAmount}</MntExento>
      <MntTotal>${totalAmount}</MntTotal>
      <FoliosEmitidos>${drafts.length}</FoliosEmitidos>
      <FoliosAnulados>0</FoliosAnulados>
      <FoliosUtilizados>${drafts.length}</FoliosUtilizados>
      <RangoUtilizados>
        <Inicial>${minFolio}</Inicial>
        <Final>${maxFolio}</Final>
      </RangoUtilizados>
    </Resumen>
  </DocumentoConsumoFolios>
</ConsumoFolios>`;
}

export function buildBoletaCertificationMetadata(
  drafts: TaxDocumentDraft[],
  issuerData: BoletaCertificationIssuerData = {},
): Record<string, unknown> {
  const issuerDataReady = isBoletaIssuerDataReady(issuerData);

  return {
    globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
    setName: "SII SET DE PRUEBA DE BOLETA ELECTRONICA DE VENTAS Y SERVICIOS",
    documentType: "boleta_afecta",
    siiDocumentTypeCode: 39,
    caseCount: drafts.length,
    issuerDataReady,
    preCafReady: false,
    cases: drafts.map((draft, index) => ({
      id: BOLETA_ELECTRONICA_CERTIFICATION_CASES[index].id,
      folio: draft.folio,
      totalAmount: draft.totalAmount,
      reference: draft.references?.[0] ?? null,
      hasExemptLine: draft.lines.some((line) => line.exempt),
      unitOfMeasure: draft.lines.find((line) => line.unitOfMeasure)?.unitOfMeasure ?? null,
    })),
    canGenerateNowWithoutCaf: [
      "TaxDocumentDraft fixtures for CASO-1..CASO-5",
      "SII-like boleta XML structure with CodRef=SET and RazonRef=CASO-X",
      "Single SetDTE envelope dry-run with 5 boletas type 39",
      "RCOF lab structure associated to the same folio range",
      "SHA-256 hashes and metadata",
    ],
    blockedUntilCaf: [
      "Real CAF parse/validation for type 39 folio range",
      "TED real and FRMT signing with CAF private key",
      "XMLDSig controlled certification signatures",
      "XSD-valid final certification XML",
      "Any SII seed/token/submit/status call",
    ],
    siiContact: false,
    trackIdSimulated: false,
    production: false,
  };
}

function check(key: string, ok: boolean, message: string): { key: string; ok: boolean; message: string } {
  return { key, ok, message };
}

export function checkBoletaPreCafReadiness(input: BoletaPreCafCheckInput): BoletaPreCafCheckResult {
  const setXml = input.setXml;
  const rcofXml = input.rcofXml;
  const metadata = input.metadata ?? {};
  const expectedCaseIds = BOLETA_ELECTRONICA_CERTIFICATION_CASES.map((certificationCase) => certificationCase.id);
  const checks: BoletaPreCafCheckResult["checks"] = [];
  const folioValues = extractTagValues(setXml, "Folio").map(Number);
  const boletaTotals = extractTagValues(setXml, "MntTotal").map(Number);
  const rcofTotal = Number(extractTagValues(rcofXml, "MntTotal")[0] ?? NaN);
  const issuerSearch = [
    ...extractTagValues(setXml, "RUTEmisor"),
    ...extractTagValues(setXml, "RznSoc"),
    ...extractTagValues(setXml, "GiroEmis"),
    ...extractTagValues(setXml, "DirOrigen"),
    ...extractTagValues(setXml, "CmnaOrigen"),
    ...extractTagValues(setXml, "CiudadOrigen"),
    ...extractTagValues(rcofXml, "RutEmisor"),
  ].join(" ");
  const issuerDataReady = Boolean(metadata.issuerDataReady) &&
    hasTagValue(setXml, "RUTEmisor", EXPECTED_REAL_ISSUER.rut) &&
    hasTagValue(setXml, "RznSoc", EXPECTED_REAL_ISSUER.legalName) &&
    hasTagValue(setXml, "CmnaOrigen", EXPECTED_REAL_ISSUER.commune) &&
    hasTagValue(setXml, "CiudadOrigen", EXPECTED_REAL_ISSUER.city) &&
    hasTagValue(rcofXml, "RutEmisor", EXPECTED_REAL_ISSUER.rut);

  checks.push(check("set_case_count", (setXml.match(/<DTE version="1.0">/g) ?? []).length === 5, "SetDTE debe contener 5 boletas."));
  checks.push(check("rcof_exists", rcofXml.includes("<ConsumoFolios"), "RCOF debe existir."));
  checks.push(check("folios_1_5", JSON.stringify(folioValues) === JSON.stringify([1, 2, 3, 4, 5]), "Folios del set deben ser 1..5."));

  for (const caseId of expectedCaseIds) {
    checks.push(check(`case_${caseId}`, setXml.includes(`<RazonRef>${caseId}</RazonRef>`), `${caseId} debe estar referenciado.`));
  }

  checks.push(check("codref_set_count", (setXml.match(/<CodRef>SET<\/CodRef>/g) ?? []).length === 5, "Cada boleta debe incluir CodRef=SET."));
  checks.push(check("rcof_type_39", hasTagValue(rcofXml, "TipoDocumento", "39"), "RCOF debe ser TipoDocumento=39."));
  checks.push(check("rcof_range", hasTagValue(rcofXml, "Inicial", "1") && hasTagValue(rcofXml, "Final", "5"), "RCOF debe usar rango 1..5."));
  checks.push(check("rcof_folios_emitidos", hasTagValue(rcofXml, "FoliosEmitidos", "5"), "RCOF debe declarar 5 folios emitidos."));
  checks.push(check("rcof_total_matches", sumTagValues(setXml, "MntTotal") === rcofTotal && boletaTotals.length === 5, "MntTotal RCOF debe coincidir con suma de boletas."));
  checks.push(check("issuer_real", issuerDataReady, "Emisor debe ser R&G SpA / 78195645-7 con comuna y ciudad Coquimbo."));
  checks.push(check("no_demo_issuer", !containsAny(issuerSearch, DEMO_OR_PLACEHOLDER_PATTERNS), "Emisor no debe contener datos demo ni pendientes."));
  checks.push(check("no_wrong_city", !/Providencia|Santiago/i.test(issuerSearch), "Emisor no debe mezclar Providencia ni Santiago."));
  checks.push(check("no_divir_as_issuer", !/DIVIR/i.test(issuerSearch), "DIVIR SpA no debe aparecer como emisor DTE."));
  checks.push(check("caf_absent", !input.cafPresent && !input.cafKeyPresent, "CAF y llave CAF deben seguir ausentes antes de bajar CAF."));
  checks.push(check("submit_blocked", metadata.submitBlocked === true, "Submit debe estar bloqueado."));
  checks.push(check("production_false", metadata.production === false, "production debe ser false."));
  checks.push(check("track_id_not_simulated", metadata.trackIdSimulated === false, "trackIdSimulated debe ser false."));

  const preCafReady = checks.every((item) => item.ok);

  return {
    ok: preCafReady,
    status: preCafReady ? "OK PARA BAJAR CAF" : "NO BAJAR CAF",
    checks,
    issuerDataReady,
    preCafReady,
  };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
