import { getSiiDteTypeCode } from "../dte-types";
import { normalizeRut } from "../rut";
import type {
  DteEnvelopeBuildOptions,
  DteGenerationError,
  DteGenerationResult,
  TaxDocumentDraft,
} from "../types";
import { escapeXml } from "./escape-xml";
import { validateDteDraftForXmlLab } from "./validate-dte-draft";

export type DteSetEnvelopeBuildOptions = DteEnvelopeBuildOptions & {
  setDteId?: string;
};

export const dteTypeFolioKey = (draft: TaxDocumentDraft) => `${getSiiDteTypeCode(draft.documentType)}:${draft.folio}`;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().slice(0, 19);
}

function buildDetailXml(draft: TaxDocumentDraft): string {
  return draft.lines
    .map((line, index) => {
      return [
        "      <Detalle>",
        `        <NroLinDet>${index + 1}</NroLinDet>`,
        line.exempt ? "        <IndExe>1</IndExe>" : null,
        `        <NmbItem>${escapeXml(line.name)}</NmbItem>`,
        line.description
          ? `        <DscItem>${escapeXml(line.description)}</DscItem>`
          : null,
        line.amount > 0 ? `        <QtyItem>${line.quantity}</QtyItem>` : null,
        line.amount > 0 && line.unitOfMeasure
          ? `        <UnmdItem>${escapeXml(line.unitOfMeasure)}</UnmdItem>`
          : null,
        line.amount > 0 ? `        <PrcItem>${line.unitPrice}</PrcItem>` : null,
        line.discountPercent != null && line.discountPercent > 0 ? `        <DescuentoPct>${line.discountPercent}</DescuentoPct>` : null,
        line.discountAmount != null && line.discountAmount > 0 ? `        <DescuentoMonto>${line.discountAmount}</DescuentoMonto>` : null,
        `        <MontoItem>${line.amount}</MontoItem>`,
        "      </Detalle>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function buildGlobalDiscountXml(draft: TaxDocumentDraft): string {
  const discount = draft.globalDiscount;
  if (!discount) return "";
  return [
    "      <DscRcgGlobal>",
    "        <NroLinDR>1</NroLinDR>",
    `        <TpoMov>${discount.discountType}</TpoMov>`,
    "        <GlosaDR>DESCUENTO GLOBAL AFECTO</GlosaDR>",
    `        <TpoValor>${discount.valueType}</TpoValor>`,
    `        <ValorDR>${discount.value}</ValorDR>`,
    discount.appliesTo === "exempt" ? "        <IndExeDR>1</IndExeDR>" : null,
    "      </DscRcgGlobal>",
  ].filter(Boolean).join("\n");
}

function buildReferenceXml(draft: TaxDocumentDraft): string {
  return (draft.references ?? [])
    .map((reference, index) => {
      return [
        "      <Referencia>",
        `        <NroLinRef>${index + 1}</NroLinRef>`,
        reference.documentType
          ? `        <TpoDocRef>${escapeXml(reference.documentType)}</TpoDocRef>`
          : null,
        reference.isGlobal ? "        <IndGlobal>1</IndGlobal>" : null,
        reference.folio
          ? `        <FolioRef>${escapeXml(reference.folio)}</FolioRef>`
          : null,
        reference.date ? `        <FchRef>${escapeXml(formatDate(reference.date))}</FchRef>` : null,
        reference.code ? `        <CodRef>${escapeXml(reference.code)}</CodRef>` : null,
        `        <RazonRef>${escapeXml(reference.reason)}</RazonRef>`,
        "      </Referencia>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function indentXml(xml: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return xml
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function buildDteDocumentId(draft: TaxDocumentDraft): string {
  return `CitayaDocLab-${getSiiDteTypeCode(draft.documentType)}-${draft.folio}`;
}

function buildDocumentoXml(
  draft: TaxDocumentDraft,
  options: DteEnvelopeBuildOptions = {},
): string {
  const issuerRut = normalizeRut(draft.issuer.rut);
  const recipientRut = normalizeRut(draft.recipient.rut);
  const documentTypeCode = getSiiDteTypeCode(draft.documentType);
  const issueDate = formatDate(draft.issueDate);
  const documentId = buildDteDocumentId(draft);
  const documentSignedAt = formatDateTime(
    options.documentSignedAt ?? draft.issueDate,
  );
  const tedXml = options.tedXml
    ? options.preserveTedWhitespace
      ? `\n${options.tedXml}\n        <TmstFirma>${documentSignedAt}</TmstFirma>`
      : `\n${indentXml(options.tedXml, 8)}\n        <TmstFirma>${documentSignedAt}</TmstFirma>`
    : "";
  const documentSignatureXml = options.documentSignatureXml
    ? options.preserveTedWhitespace
      ? `\n${options.documentSignatureXml}`
      : `\n${indentXml(options.documentSignatureXml, 6)}`
    : "";
  const referencesXml = buildReferenceXml(draft);
  const issuerActivityCode = String(
    draft.issuer.businessActivityCode ?? "",
  ).trim();

  return `    <DTE xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1.0">
      <Documento ID="${documentId}">
        <Encabezado>
          <IdDoc>
            <TipoDTE>${documentTypeCode}</TipoDTE>
            <Folio>${draft.folio}</Folio>
            <FchEmis>${escapeXml(issueDate)}</FchEmis>
            ${draft.amountsAreGross ? "<MntBruto>1</MntBruto>" : ""}
          </IdDoc>
          <Emisor>
            <RUTEmisor>${escapeXml(issuerRut)}</RUTEmisor>
            <RznSoc>${escapeXml(draft.issuer.legalName)}</RznSoc>
            <GiroEmis>${escapeXml(draft.issuer.businessActivity)}</GiroEmis>
            <Acteco>${escapeXml(issuerActivityCode)}</Acteco>
            <DirOrigen>${escapeXml(draft.issuer.address)}</DirOrigen>
            <CmnaOrigen>${escapeXml(draft.issuer.commune)}</CmnaOrigen>
            <CiudadOrigen>${escapeXml(draft.issuer.city)}</CiudadOrigen>
          </Emisor>
          <Receptor>
            <RUTRecep>${escapeXml(recipientRut)}</RUTRecep>
            <RznSocRecep>${escapeXml(draft.recipient.legalName)}</RznSocRecep>
            <GiroRecep>${escapeXml(String(draft.recipient.businessActivity ?? "").slice(0, 40))}</GiroRecep>
            ${draft.recipient.email ? `<CorreoRecep>${escapeXml(draft.recipient.email)}</CorreoRecep>` : ""}
            <DirRecep>${escapeXml(draft.recipient.address)}</DirRecep>
            <CmnaRecep>${escapeXml(draft.recipient.commune)}</CmnaRecep>
            <CiudadRecep>${escapeXml(draft.recipient.city)}</CiudadRecep>
          </Receptor>
          <Totales>
            <MntNeto>${draft.netAmount ?? 0}</MntNeto>
            <MntExe>${draft.exemptAmount ?? 0}</MntExe>
            <TasaIVA>19</TasaIVA>
            <IVA>${draft.taxAmount ?? 0}</IVA>
            <MntTotal>${draft.totalAmount}</MntTotal>
          </Totales>
        </Encabezado>
${buildDetailXml(draft)}${buildGlobalDiscountXml(draft) ? `\n${buildGlobalDiscountXml(draft)}` : ""}${referencesXml ? `\n${referencesXml}` : ""}
${tedXml}
      </Documento>${documentSignatureXml}
    </DTE>`;
}

function buildCaratulaXml(drafts: TaxDocumentDraft[], options: DteEnvelopeBuildOptions = {}): string {
  const firstDraft = drafts[0];
  const issuerRut = normalizeRut(firstDraft.issuer.rut);
  const subtotals = new Map<number, number>();

  for (const draft of drafts) {
    const typeCode = getSiiDteTypeCode(draft.documentType);
    subtotals.set(typeCode, (subtotals.get(typeCode) ?? 0) + 1);
  }

  const subtotalsXml = Array.from(subtotals.entries())
    .map(
      ([typeCode, count]) => `      <SubTotDTE>
        <TpoDTE>${typeCode}</TpoDTE>
        <NroDTE>${count}</NroDTE>
      </SubTotDTE>`,
    )
    .join("\n");

  return `    <Caratula version="1.0">
      <RutEmisor>${escapeXml(issuerRut)}</RutEmisor>
      <RutEnvia>${escapeXml(normalizeRut(options.rutEnvia ?? issuerRut))}</RutEnvia>
      <RutReceptor>60803000-K</RutReceptor>
      <FchResol>${escapeXml(firstDraft.issuer.siiResolutionDate ?? "2006-01-01")}</FchResol>
      <NroResol>${escapeXml(firstDraft.issuer.siiResolutionNumber ?? "0")}</NroResol>
      <TmstFirmaEnv>${formatDateTime(firstDraft.issueDate)}</TmstFirmaEnv>
${subtotalsXml}
    </Caratula>`;
}

export function buildDteDocumentoXmlLab(
  draft: TaxDocumentDraft,
  options: DteEnvelopeBuildOptions = {},
): string {
  validateDteDraftForXmlLab(draft);
  return buildDocumentoXml(draft, options);
}

export function buildDteSetDteXmlLab(
  drafts: TaxDocumentDraft[],
  options: DteSetEnvelopeBuildOptions = {},
): string {
  if (drafts.length === 0) throw new Error("At least one DTE draft is required for SetDTE");
  drafts.forEach(validateDteDraftForXmlLab);
  const firstDraft = drafts[0];
  const setDteId =
    options.setDteId ??
    `CitayaDteLab-${escapeXml(firstDraft.tenantId)}-set-${formatDate(firstDraft.issueDate)}`;
  return `  <SetDTE ID="${setDteId}">
${buildCaratulaXml(drafts, options)}
${drafts.map((draft) => options.perDocumentXml?.[dteTypeFolioKey(draft)]?.fullDteXml ?? buildDocumentoXml(draft, {
  ...options,
  ...(options.perDocumentXml?.[dteTypeFolioKey(draft)] ?? {}),
})).join("\n")}
  </SetDTE>`;
}

function warningsForMode(mode: DteEnvelopeBuildOptions["mode"]): string[] {
  return [
    mode === "certification"
      ? "XML certification controlado: LAB / PENDIENTE / NO PRODUCTIVO hasta aprobacion SII."
      : "XML experimental no productivo.",
    mode === "certification"
      ? "XML certification debe validarse contra XSD oficial antes de submit."
      : "SII-like XML laboratory format, no validado contra XSD oficial.",
    mode === "certification"
      ? "Modo certification: puede incluir CAF/TED/XMLDSig externos controlados, sin validez legal aun."
      : mode === "xsd-structure"
        ? "Modo xsd-structure: puede incluir TED/Signature sinteticos LAB sin validez criptografica."
        : "No incluye CAF real, TED final ni firma XML real.",
  ];
}

// LAB / NO PRODUCTIVO: genera un sobre SII-like, no certificado ante SII.
export function buildDteEnvelopeXmlLab(
  draft: TaxDocumentDraft,
  options: DteEnvelopeBuildOptions = {},
): DteGenerationResult | DteGenerationError {
  try {
    validateDteDraftForXmlLab(draft);

    const setDteId = `CitayaDteLab-${escapeXml(draft.tenantId)}-${draft.folio}`;
    const envioSignatureXml = options.envioSignatureXml
      ? `\n${indentXml(options.envioSignatureXml, 2)}`
      : "";

    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<!--
  Citaya DTE Lab XML - SII-like XML laboratory format - NO PRODUCTIVO.
  Este XML es experimental: no es XML certificado/final ante SII.
  No esta firmado, no consume CAF real,
  no incluye timbre TED final real y no debe enviarse al SII.
-->
<EnvioDTE xmlns="http://www.sii.cl/SiiDte" version="1.0">
  <SetDTE ID="${setDteId}">
${buildCaratulaXml([draft], options)}
${buildDocumentoXml(draft, options)}
  </SetDTE>${envioSignatureXml}
</EnvioDTE>`;

    return {
      ok: true,
      documentType: draft.documentType,
      folio: draft.folio,
      status: "pending_signature",
      xml,
      warnings: warningsForMode(options.mode),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "DTE XML generation failed",
    };
  }
}

export function buildDteSetEnvelopeXmlLab(
  drafts: TaxDocumentDraft[],
  options: DteSetEnvelopeBuildOptions = {},
): DteGenerationResult | DteGenerationError {
  try {
    if (drafts.length === 0) {
      throw new Error("At least one DTE draft is required for SetDTE");
    }

    drafts.forEach(validateDteDraftForXmlLab);

    const firstDraft = drafts[0];
    const setDteId =
      options.setDteId ??
      `CitayaDteLab-${escapeXml(firstDraft.tenantId)}-set-${formatDate(firstDraft.issueDate)}`;
    const envioSignatureXml = options.envioSignatureXml
      ? `\n${indentXml(options.envioSignatureXml, 2)}`
      : "";

    const setDteXml = buildDteSetDteXmlLab(drafts, { ...options, setDteId });
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<!--
  Citaya DTE Lab XML - sobre unico SetDTE - NO PRODUCTIVO.
  Estructura previa para certificacion: no contiene CAF real, TED real ni firmas reales.
  No contactar SII con este archivo.
-->
<EnvioDTE xmlns="http://www.sii.cl/SiiDte" version="1.0">
${setDteXml}${envioSignatureXml}
</EnvioDTE>`;

    return {
      ok: true,
      documentType: firstDraft.documentType,
      folio: firstDraft.folio,
      status: "pending_signature",
      xml,
      warnings: [
        ...warningsForMode(options.mode),
        "Sobre unico de boletas preparado para dry-run; firma/TED real bloqueados hasta CAF real externo.",
      ],
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "DTE SetDTE generation failed",
    };
  }
}

export function buildDteEnvelope(
  draft: TaxDocumentDraft,
  options: DteEnvelopeBuildOptions = {},
): DteGenerationResult | DteGenerationError {
  return buildDteEnvelopeXmlLab(draft, options);
}
