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
        `        <NmbItem>${escapeXml(line.name)}</NmbItem>`,
        line.description
          ? `        <DscItem>${escapeXml(line.description)}</DscItem>`
          : null,
        `        <QtyItem>${line.quantity}</QtyItem>`,
        `        <PrcItem>${line.unitPrice}</PrcItem>`,
        `        <MontoItem>${line.amount}</MontoItem>`,
        "      </Detalle>",
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

// LAB / NO PRODUCTIVO: genera un sobre SII-like, no certificado ante SII.
export function buildDteEnvelopeXmlLab(
  draft: TaxDocumentDraft,
  options: DteEnvelopeBuildOptions = {},
): DteGenerationResult | DteGenerationError {
  try {
    validateDteDraftForXmlLab(draft);

    const issuerRut = normalizeRut(draft.issuer.rut);
    const recipientRut = normalizeRut(draft.recipient.rut);
    const documentTypeCode = getSiiDteTypeCode(draft.documentType);
    const issueDate = formatDate(draft.issueDate);
    const documentId = `CitayaDocLab-${documentTypeCode}-${draft.folio}`;
    const setDteId = `CitayaDteLab-${escapeXml(draft.tenantId)}-${draft.folio}`;
    const documentSignedAt = formatDateTime(
      options.documentSignedAt ?? draft.issueDate,
    );
    const tedXml = options.tedXml
      ? `\n${indentXml(options.tedXml, 8)}\n        <TmstFirma>${documentSignedAt}</TmstFirma>`
      : "";
    const documentSignatureXml = options.documentSignatureXml
      ? `\n${indentXml(options.documentSignatureXml, 6)}`
      : "";
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
    <Caratula version="1.0">
      <RutEmisor>${escapeXml(issuerRut)}</RutEmisor>
      <RutEnvia>${escapeXml(issuerRut)}</RutEnvia>
      <RutReceptor>60803000-K</RutReceptor>
      <FchResol>${escapeXml(draft.issuer.siiResolutionDate ?? "2006-01-01")}</FchResol>
      <NroResol>${escapeXml(draft.issuer.siiResolutionNumber ?? "0")}</NroResol>
      <TmstFirmaEnv>${formatDateTime(draft.issueDate)}</TmstFirmaEnv>
      <SubTotDTE>
        <TpoDTE>${documentTypeCode}</TpoDTE>
        <NroDTE>1</NroDTE>
      </SubTotDTE>
    </Caratula>
    <DTE version="1.0">
      <Documento ID="${documentId}">
        <Encabezado>
          <IdDoc>
            <TipoDTE>${documentTypeCode}</TipoDTE>
            <Folio>${draft.folio}</Folio>
            <FchEmis>${escapeXml(issueDate)}</FchEmis>
          </IdDoc>
          <Emisor>
            <RUTEmisor>${escapeXml(issuerRut)}</RUTEmisor>
            <RznSoc>${escapeXml(draft.issuer.legalName)}</RznSoc>
            <GiroEmis>${escapeXml(draft.issuer.businessActivity)}</GiroEmis>
            <Acteco>${escapeXml(draft.issuer.businessActivityCode ?? "")}</Acteco>
            <DirOrigen>${escapeXml(draft.issuer.address)}</DirOrigen>
            <CmnaOrigen>${escapeXml(draft.issuer.commune)}</CmnaOrigen>
            <CiudadOrigen>${escapeXml(draft.issuer.city)}</CiudadOrigen>
          </Emisor>
          <Receptor>
            <RUTRecep>${escapeXml(recipientRut)}</RUTRecep>
            <RznSocRecep>${escapeXml(draft.recipient.legalName)}</RznSocRecep>
            <GiroRecep>${escapeXml(draft.recipient.businessActivity)}</GiroRecep>
            <CorreoRecep>${escapeXml(draft.recipient.email)}</CorreoRecep>
            <DirRecep>${escapeXml(draft.recipient.address)}</DirRecep>
            <CmnaRecep>${escapeXml(draft.recipient.commune)}</CmnaRecep>
            <CiudadRecep>${escapeXml(draft.recipient.city)}</CiudadRecep>
          </Receptor>
          <Totales>
            <MntNeto>${draft.netAmount ?? 0}</MntNeto>
            <MntExe>${draft.exemptAmount ?? 0}</MntExe>
            <IVA>${draft.taxAmount ?? 0}</IVA>
            <MntTotal>${draft.totalAmount}</MntTotal>
          </Totales>
        </Encabezado>
${buildDetailXml(draft)}
${tedXml}
      </Documento>
${documentSignatureXml}
    </DTE>
  </SetDTE>
${envioSignatureXml}
</EnvioDTE>`;

    return {
      ok: true,
      documentType: draft.documentType,
      folio: draft.folio,
      status: "pending_signature",
      xml,
      warnings: [
        options.mode === "certification"
          ? "XML certification controlado: LAB / PENDIENTE / NO PRODUCTIVO hasta aprobacion SII."
          : "XML experimental no productivo.",
        options.mode === "certification"
          ? "XML certification debe validarse contra XSD oficial antes de submit."
          : "SII-like XML laboratory format, no validado contra XSD oficial.",
        options.mode === "certification"
          ? "Modo certification: puede incluir CAF/TED/XMLDSig externos controlados, sin validez legal aun."
          : options.mode === "xsd-structure"
            ? "Modo xsd-structure: puede incluir TED/Signature sinteticos LAB sin validez criptografica."
            : "No incluye CAF real, TED final ni firma XML real.",
      ],
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "DTE XML generation failed",
    };
  }
}

export function buildDteEnvelope(
  draft: TaxDocumentDraft,
  options: DteEnvelopeBuildOptions = {},
): DteGenerationResult | DteGenerationError {
  return buildDteEnvelopeXmlLab(draft, options);
}
