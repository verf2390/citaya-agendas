import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
} from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { jsPDF } from "jspdf";

import {
  calculateBoletaGrossTotals,
  sumBoletaRvdTotals,
  type BoletaGrossLineInput,
  type BoletaTotals,
} from "../boleta-money";
import { signFrmtControlled } from "../caf/frmt-signature";
import { buildOfficialFrmtDd, buildTedControlled } from "../caf/ted-builder";
import { normalizeRut } from "../rut";
import { signXmlInFinalContextControlled } from "../signing/sign-xml.real";
import type { RealXmlSigningConfig } from "../types";
import { escapeXml } from "../xml/escape-xml";

export const BOLETA_XSD_PATH =
  "docs/dte-sii/xsd/boleta-v11/EnvioBOLETA_v11.xsd";
export const RVD_XSD_PATH =
  "docs/dte-sii/xsd/rvd-v10/ConsumoFolio_v10.xsd";
export const BOLETA_FORMAT_VERSION = "4.2";
export const BOLETA_FORMAT_DATE = "2025-09-08";
export const BOLETA_SCHEMA_VERSION = "EnvioBOLETA_v11";
export const RVD_FORMAT_VERSION = "2.0";
export const RVD_FORMAT_DATE = "2020-08-03";

export type BoletaCertificationCaseId =
  | "CASO-1"
  | "CASO-2"
  | "CASO-3"
  | "CASO-4"
  | "CASO-5";

export type BoletaCertificationCase = {
  id: BoletaCertificationCaseId;
  lines: readonly BoletaGrossLineInput[];
  expected: Pick<
    BoletaTotals,
    "netAmount" | "exemptAmount" | "taxAmount" | "totalAmount"
  >;
};

export const BOLETA_39_CERTIFICATION_CASES: readonly BoletaCertificationCase[] =
  [
    {
      id: "CASO-1",
      lines: [
        { description: "Cambio de aceite", quantity: 1, unitGrossAmount: 19_900 },
        {
          description: "Alineacion y balanceo",
          quantity: 1,
          unitGrossAmount: 9_900,
        },
      ],
      expected: {
        netAmount: 25_042,
        taxAmount: 4_758,
        exemptAmount: 0,
        totalAmount: 29_800,
      },
    },
    {
      id: "CASO-2",
      lines: [
        { description: "Papel de regalo", quantity: 17, unitGrossAmount: 120 },
      ],
      expected: {
        netAmount: 1_714,
        taxAmount: 326,
        exemptAmount: 0,
        totalAmount: 2_040,
      },
    },
    {
      id: "CASO-3",
      lines: [
        { description: "Sandwic", quantity: 2, unitGrossAmount: 1_500 },
        { description: "Bebida", quantity: 2, unitGrossAmount: 550 },
      ],
      expected: {
        netAmount: 3_445,
        taxAmount: 655,
        exemptAmount: 0,
        totalAmount: 4_100,
      },
    },
    {
      id: "CASO-4",
      lines: [
        { description: "item afecto 1", quantity: 8, unitGrossAmount: 1_590 },
        {
          description: "item exento 2",
          quantity: 2,
          unitGrossAmount: 1_000,
          exempt: true,
        },
      ],
      expected: {
        netAmount: 10_689,
        taxAmount: 2_031,
        exemptAmount: 2_000,
        totalAmount: 14_720,
      },
    },
    {
      id: "CASO-5",
      lines: [
        {
          description: "Arroz",
          quantity: 5,
          unitGrossAmount: 700,
          unitOfMeasure: "Kg",
        },
      ],
      expected: {
        netAmount: 2_941,
        taxAmount: 559,
        exemptAmount: 0,
        totalAmount: 3_500,
      },
    },
  ] as const;

export type BoletaPreCafIssuer = {
  rut: string;
  legalName: string;
  businessActivity: string;
  address: string;
  commune: string;
  city: string;
  resolutionDate: string;
  resolutionNumber: string;
  senderRut: string;
};

export type BoletaPreCafOptions = {
  issueDate: string;
  firstFolio: number;
  outputDir: string;
  issuer?: Partial<BoletaPreCafIssuer>;
  publicVerificationUrl?: string;
};

export type PreparedBoleta = {
  caseId: BoletaCertificationCaseId;
  folio: number;
  totals: BoletaTotals;
  dteXml: string;
  tedXml: string;
  pdfBytes: Buffer;
};

export type BoletaPreCafResult = {
  status: "PRE_CAF_READY";
  environment: "certification";
  fixtureMode: true;
  siiContacted: false;
  officialCafPresent: false;
  productionFoliosUsed: false;
  documents: PreparedBoleta[];
  envelopeXml: string;
  rvdXml: string;
  rvdTotals: ReturnType<typeof sumBoletaRvdTotals>;
  hashes: Record<string, string>;
  outputDir: string;
};

type FixtureMaterial = {
  root: string;
  privateKeyPath: string;
  certificatePath: string;
  privateKeyPem: string;
  cafPrivateKeyPem: string;
};

const XML_DECLARATION = '<?xml version="1.0" encoding="ISO-8859-1"?>';
const SII_NAMESPACE = "http://www.sii.cl/SiiDte";
const GENERIC_RECEIVER_RUT = "66666666-6";
const SII_RECEIVER_RUT = "60803000-K";
const FIXTURE_TIMESTAMP = "2026-07-29T12:00:00";

function fail(message: string): never {
  throw new Error(message);
}

function defaultIssuer(
  partial: Partial<BoletaPreCafIssuer> = {},
): BoletaPreCafIssuer {
  const rut = normalizeRut(partial.rut ?? "11111111-1");
  return {
    rut,
    legalName: partial.legalName ?? "Citaya PRE-CAF Fixture",
    businessActivity:
      partial.businessActivity ?? "Servicios de prueba sin validez tributaria",
    address: partial.address ?? "Direccion PRE-CAF",
    commune: partial.commune ?? "Coquimbo",
    city: partial.city ?? "Coquimbo",
    resolutionDate: partial.resolutionDate ?? "2026-07-29",
    resolutionNumber: partial.resolutionNumber ?? "0",
    senderRut: normalizeRut(partial.senderRut ?? rut),
  };
}

function assertPreCafEnvironment(env: NodeJS.ProcessEnv): void {
  if (
    env.DTE_MODE === "production" ||
    env.DTE_SII_ENV === "production" ||
    env.DTE_SII_ENABLE_SUBMIT === "true" ||
    env.DTE_SII_ENABLE_STATUS === "true" ||
    env.DTE_SII_LIVE_AUTH === "true" ||
    env.DTE_CAF_PATH ||
    env.DTE_CAF_PRIVATE_KEY_PATH ||
    env.DTE_SII_TOKEN ||
    env.DTE_TRACK_ID
  ) {
    fail("PRE_CAF_PRODUCTION_OR_SII_ACCESS_BLOCKED");
  }
}

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("PRE_CAF_DATE_INVALID");
  return value;
}

function createFixtureMaterial(): FixtureMaterial {
  const root = mkdtempSync(join(tmpdir(), "citaya-boleta-pre-caf-"));
  const privateKeyPath = join(root, "fixture-private-key.pem");
  const certificatePath = join(root, "fixture-certificate.pem");
  const cafPrivateKeyPath = join(root, "fixture-caf-private-key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      privateKeyPath,
      "-out",
      certificatePath,
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=Citaya Boleta PRE CAF Fixture/serialNumber=11111111-1/C=CL",
    ],
    { stdio: "ignore" },
  );
  execFileSync("openssl", ["genrsa", "-out", cafPrivateKeyPath, "1024"], {
    stdio: "ignore",
  });
  chmodSync(privateKeyPath, 0o600);
  chmodSync(certificatePath, 0o600);
  chmodSync(cafPrivateKeyPath, 0o600);
  return {
    root,
    privateKeyPath,
    certificatePath,
    privateKeyPem: readFileSync(privateKeyPath, "utf8"),
    cafPrivateKeyPem: readFileSync(cafPrivateKeyPath, "utf8"),
  };
}

function signingConfig(
  material: FixtureMaterial,
  referenceId: string,
): RealXmlSigningConfig {
  return {
    tenantId: "citaya-boleta-pre-caf-fixture",
    mode: "certification",
    signatureTarget: referenceId,
    privateKeyPath: material.privateKeyPath,
    certificatePath: material.certificatePath,
    publicCertificatePath: material.certificatePath,
  };
}

function publicKeyParts(privateKeyPem: string) {
  const publicKey = createPublicKey(createPrivateKey(privateKeyPem)).export({
    format: "jwk",
  }) as { kty?: string; n?: string; e?: string };
  if (publicKey.kty !== "RSA" || !publicKey.n || !publicKey.e) {
    fail("PRE_CAF_FIXTURE_RSA_REQUIRED");
  }
  return {
    modulus: Buffer.from(publicKey.n, "base64url").toString("base64"),
    exponent: Buffer.from(publicKey.e, "base64url").toString("base64"),
  };
}

function syntheticCafXml(
  issuer: BoletaPreCafIssuer,
  firstFolio: number,
  material: FixtureMaterial,
): string {
  const rsa = publicKeyParts(material.cafPrivateKeyPem);
  const da = [
    "<DA>",
    `<RE>${escapeXml(issuer.rut)}</RE>`,
    `<RS>${escapeXml(issuer.legalName.slice(0, 40))}</RS>`,
    "<TD>39</TD>",
    `<RNG><D>${firstFolio}</D><H>${firstFolio + 4}</H></RNG>`,
    `<FA>${escapeXml(issuer.resolutionDate)}</FA>`,
    `<RSAPK><M>${rsa.modulus}</M><E>${rsa.exponent}</E></RSAPK>`,
    "<IDK>1</IDK>",
    "</DA>",
  ].join("");
  const signer = createSign("RSA-SHA1");
  signer.update(da, "latin1");
  const signature = signer.sign(material.cafPrivateKeyPem, "base64");
  return `<CAF version="1.0">${da}<FRMA algoritmo="SHA1withRSA">${signature}</FRMA></CAF>`;
}

function assertExpectedTotals(
  certificationCase: BoletaCertificationCase,
  totals: BoletaTotals,
): void {
  for (const key of [
    "netAmount",
    "taxAmount",
    "exemptAmount",
    "totalAmount",
  ] as const) {
    if (totals[key] !== certificationCase.expected[key]) {
      fail(`${certificationCase.id}_${key}_INVALID`);
    }
  }
}

function detailsXml(totals: BoletaTotals): string {
  return totals.lines
    .map(
      (line) => `      <Detalle>
        <NroLinDet>${line.position}</NroLinDet>
${line.exempt ? "        <IndExe>1</IndExe>\n" : ""}        <NmbItem>${escapeXml(line.description)}</NmbItem>
        <QtyItem>${line.quantity}</QtyItem>
${line.unitOfMeasure ? `        <UnmdItem>${escapeXml(line.unitOfMeasure)}</UnmdItem>\n` : ""}        <PrcItem>${line.unitGrossAmount}</PrcItem>
        <MontoItem>${line.grossAmount}</MontoItem>
      </Detalle>`,
    )
    .join("\n");
}

function unsignedBoletaDte(input: {
  certificationCase: BoletaCertificationCase;
  totals: BoletaTotals;
  issuer: BoletaPreCafIssuer;
  issueDate: string;
  folio: number;
  tedXml: string;
  timestamp?: string;
}): { xml: string; documentId: string } {
  const documentId = `CitayaBoleta39-${input.folio}`;
  const totals = input.totals;
  const totalTags = [
    totals.netAmount > 0 ? `<MntNeto>${totals.netAmount}</MntNeto>` : "",
    totals.exemptAmount > 0
      ? `<MntExe>${totals.exemptAmount}</MntExe>`
      : "",
    totals.taxAmount > 0 ? `<IVA>${totals.taxAmount}</IVA>` : "",
    `<MntTotal>${totals.totalAmount}</MntTotal>`,
  ]
    .filter(Boolean)
    .join("");
  return {
    documentId,
    xml: `<DTE xmlns="${SII_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1.0">
  <Documento ID="${documentId}">
    <Encabezado>
      <IdDoc>
        <TipoDTE>39</TipoDTE>
        <Folio>${input.folio}</Folio>
        <FchEmis>${input.issueDate}</FchEmis>
        <IndServicio>3</IndServicio>
      </IdDoc>
      <Emisor>
        <RUTEmisor>${escapeXml(input.issuer.rut)}</RUTEmisor>
        <RznSocEmisor>${escapeXml(input.issuer.legalName)}</RznSocEmisor>
        <GiroEmisor>${escapeXml(input.issuer.businessActivity)}</GiroEmisor>
        <DirOrigen>${escapeXml(input.issuer.address)}</DirOrigen>
        <CmnaOrigen>${escapeXml(input.issuer.commune)}</CmnaOrigen>
        <CiudadOrigen>${escapeXml(input.issuer.city)}</CiudadOrigen>
      </Emisor>
      <Receptor>
        <RUTRecep>${GENERIC_RECEIVER_RUT}</RUTRecep>
        <RznSocRecep>Consumidor final</RznSocRecep>
      </Receptor>
      <RutProvSW>${escapeXml(input.issuer.rut)}</RutProvSW>
      <Totales>${totalTags}</Totales>
    </Encabezado>
${detailsXml(totals)}
    <Referencia>
      <NroLinRef>1</NroLinRef>
      <CodRef>SET</CodRef>
      <RazonRef>${input.certificationCase.id}</RazonRef>
    </Referencia>
    ${input.tedXml}
    <TmstFirma>${input.timestamp ?? FIXTURE_TIMESTAMP}</TmstFirma>
  </Documento>
</DTE>`,
  };
}

function boletaEnvelopeUnsigned(input: {
  documents: PreparedBoleta[];
  issuer: BoletaPreCafIssuer;
  timestamp?: string;
}): { xml: string; setId: string } {
  const setId = `CitayaBoleta39Set-${input.documents[0].folio}-${input.documents.at(-1)!.folio}`;
  return {
    setId,
    xml: `${XML_DECLARATION}
<EnvioBOLETA xmlns="${SII_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioBOLETA_v11.xsd" version="1.0">
  <SetDTE ID="${setId}">
    <Caratula version="1.0">
      <RutEmisor>${escapeXml(input.issuer.rut)}</RutEmisor>
      <RutEnvia>${escapeXml(input.issuer.senderRut)}</RutEnvia>
      <RutReceptor>${SII_RECEIVER_RUT}</RutReceptor>
      <FchResol>${escapeXml(input.issuer.resolutionDate)}</FchResol>
      <NroResol>${escapeXml(input.issuer.resolutionNumber)}</NroResol>
      <TmstFirmaEnv>${input.timestamp ?? FIXTURE_TIMESTAMP}</TmstFirmaEnv>
      <SubTotDTE><TpoDTE>39</TpoDTE><NroDTE>5</NroDTE></SubTotDTE>
    </Caratula>
${input.documents.map((document) => document.dteXml).join("\n")}
  </SetDTE>
</EnvioBOLETA>`,
  };
}

function rvdUnsigned(input: {
  documents: PreparedBoleta[];
  issuer: BoletaPreCafIssuer;
  issueDate: string;
  totals: ReturnType<typeof sumBoletaRvdTotals>;
  timestamp?: string;
}): { xml: string; documentId: string } {
  const first = input.documents[0].folio;
  const last = input.documents.at(-1)!.folio;
  const documentId = `CitayaRvd39-${input.issueDate}-${first}-${last}`;
  return {
    documentId,
    xml: `${XML_DECLARATION}
<ConsumoFolios xmlns="${SII_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sii.cl/SiiDte ConsumoFolio_v10.xsd" version="1.0">
  <DocumentoConsumoFolios ID="${documentId}">
    <Caratula version="1.0">
      <RutEmisor>${escapeXml(input.issuer.rut)}</RutEmisor>
      <RutEnvia>${escapeXml(input.issuer.senderRut)}</RutEnvia>
      <FchResol>${escapeXml(input.issuer.resolutionDate)}</FchResol>
      <NroResol>${escapeXml(input.issuer.resolutionNumber)}</NroResol>
      <FchInicio>${input.issueDate}</FchInicio>
      <FchFinal>${input.issueDate}</FchFinal>
      <SecEnvio>1</SecEnvio>
      <TmstFirmaEnv>${input.timestamp ?? FIXTURE_TIMESTAMP}</TmstFirmaEnv>
    </Caratula>
    <Resumen>
      <TipoDocumento>39</TipoDocumento>
      <MntNeto>${input.totals.netAmount}</MntNeto>
      <MntIva>${input.totals.taxAmount}</MntIva>
      <TasaIVA>19</TasaIVA>
      <MntExento>${input.totals.exemptAmount}</MntExento>
      <MntTotal>${input.totals.totalAmount}</MntTotal>
      <FoliosEmitidos>5</FoliosEmitidos>
      <FoliosAnulados>0</FoliosAnulados>
      <FoliosUtilizados>5</FoliosUtilizados>
      <RangoUtilizados><Inicial>${first}</Inicial><Final>${last}</Final></RangoUtilizados>
    </Resumen>
  </DocumentoConsumoFolios>
</ConsumoFolios>`,
  };
}

function encodeIso88591(xml: string): Buffer {
  if ([...xml].some((character) => (character.codePointAt(0) ?? 0) > 0xff)) {
    fail("PRE_CAF_XML_OUTSIDE_ISO_8859_1");
  }
  return Buffer.from(xml, "latin1");
}

function validateXsd(
  xml: string,
  schemaPath: string,
  label: string,
  outputDir: string,
): void {
  const xmlPath = join(outputDir, `.${label}-xsd.xml`);
  writeFileSync(xmlPath, encodeIso88591(xml), { mode: 0o600 });
  try {
    const result = spawnSync(
      "xmllint",
      ["--noout", "--schema", resolve(schemaPath), xmlPath],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    if (result.status !== 0) {
      const diagnostic = (result.stderr || result.stdout || "xmllint failed")
        .trim()
        .split(/\r?\n/)
        .slice(0, 3)
        .join(" | ")
        .replace(/The value '[^']*'/g, "The value '[redacted]'");
      fail(`PRE_CAF_XSD_${label}_INVALID: ${diagnostic}`);
    }
  } finally {
    rmSync(xmlPath, { force: true });
  }
}

function verifySignature(
  xmlPath: string,
  referenceId: string,
  certificatePath: string,
): void {
  const result = spawnSync(
    "xmlsec1",
    [
      "--verify",
      "--id-attr:ID",
      "Documento",
      "--id-attr:ID",
      "SetDTE",
      "--id-attr:ID",
      "DocumentoConsumoFolios",
      "--pubkey-cert-pem",
      certificatePath,
      "--node-xpath",
      `//*[local-name()='Signature'][.//*[local-name()='Reference' and @URI='#${referenceId}']]`,
      xmlPath,
    ],
    { stdio: "ignore" },
  );
  if (result.status !== 0) fail(`PRE_CAF_SIGNATURE_${referenceId}_INVALID`);
}

async function renderBoletaPdf(input: {
  certificationCase: BoletaCertificationCase;
  totals: BoletaTotals;
  issuer: BoletaPreCafIssuer;
  issueDate: string;
  folio: number;
  tedXml: string;
  verificationUrl: string;
}): Promise<Buffer> {
  const { writeBarcode } = await import("zxing-wasm/writer");
  const barcode = await writeBarcode(input.tedXml, {
    format: "PDF417",
    scale: 3,
    options: "ecLevel=2,columns=5",
  });
  if (barcode.error || !barcode.image) {
    fail(`PRE_CAF_PDF417_FAILED:${String(barcode.error || "image_missing")}`);
  }
  const png = Buffer.from(await barcode.image.arrayBuffer());
  const pdf = new jsPDF({ unit: "pt", format: "letter", compress: false });
  pdf.setProperties({
    title: `Boleta Electrónica ${input.folio}`,
    subject: "PRE-CAF fixture sin validez tributaria",
  });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text(input.issuer.legalName, 36, 38);
  pdf.setFontSize(9);
  pdf.text(`RUT ${input.issuer.rut}`, 36, 54);
  pdf.text(input.issuer.businessActivity, 36, 68, { maxWidth: 330 });
  pdf.setDrawColor(185, 28, 28);
  pdf.rect(405, 25, 170, 82);
  pdf.setTextColor(160, 0, 0);
  pdf.text("BOLETA ELECTRÓNICA", 420, 50);
  pdf.text(`FOLIO ${input.folio}`, 420, 72);
  pdf.text(`FECHA ${input.issueDate}`, 420, 94);
  pdf.setTextColor(0, 0, 0);
  let y = 140;
  for (const line of input.totals.lines) {
    pdf.setFont("helvetica", "normal");
    pdf.text(line.description, 36, y);
    pdf.text(String(line.quantity), 330, y);
    pdf.text(`$${line.unitGrossAmount.toLocaleString("es-CL")}`, 390, y);
    pdf.text(`$${line.totalAmount.toLocaleString("es-CL")}`, 490, y);
    y += 18;
  }
  y = Math.max(y + 25, 260);
  pdf.text(`Neto: $${input.totals.netAmount.toLocaleString("es-CL")}`, 390, y);
  pdf.text(`IVA: $${input.totals.taxAmount.toLocaleString("es-CL")}`, 390, y + 16);
  pdf.setFont("helvetica", "bold");
  pdf.text(
    `Total: $${input.totals.totalAmount.toLocaleString("es-CL")}`,
    390,
    y + 34,
  );
  pdf.addImage(png, "PNG", 80, 500, 250, 80);
  pdf.setFontSize(8);
  pdf.text("Timbre Electrónico SII — fixture criptográfica PRE-CAF", 80, 594);
  pdf.text("Verifique en www.sii.cl", 80, 608);
  pdf.text(`Consulta Citaya: ${input.verificationUrl}`, 80, 622);
  pdf.setFont("helvetica", "bold");
  pdf.text("MUESTRA PRE-CAF — SIN VALIDEZ TRIBUTARIA", 330, 650);
  return Buffer.from(pdf.output("arraybuffer"));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function prepareBoletaPreCaf(
  options: BoletaPreCafOptions,
): Promise<BoletaPreCafResult> {
  assertPreCafEnvironment(process.env);
  const issueDate = assertDate(options.issueDate);
  if (!Number.isSafeInteger(options.firstFolio) || options.firstFolio < 1) {
    fail("PRE_CAF_FIRST_FOLIO_INVALID");
  }
  const issuer = defaultIssuer(options.issuer);
  const outputDir = resolve(options.outputDir);
  const verificationUrl =
    options.publicVerificationUrl ??
    "https://app.citaya.online/verificar/boleta";
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  chmodSync(outputDir, 0o700);
  const material = createFixtureMaterial();
  const cafXml = syntheticCafXml(issuer, options.firstFolio, material);

  try {
    const documents: PreparedBoleta[] = [];
    for (const [index, certificationCase] of BOLETA_39_CERTIFICATION_CASES.entries()) {
      const folio = options.firstFolio + index;
      const totals = calculateBoletaGrossTotals(certificationCase.lines);
      assertExpectedTotals(certificationCase, totals);
      const pendingTed = buildTedControlled({
        issuerRut: issuer.rut,
        documentTypeCode: 39,
        folio,
        issueDate,
        recipientRut: GENERIC_RECEIVER_RUT,
        recipientLegalName: "Consumidor final",
        totalAmount: totals.totalAmount,
        firstItemName: totals.lines[0].description,
        cafXml,
        timestamp: FIXTURE_TIMESTAMP,
        compact: true,
      });
      const frmt = signFrmtControlled({
        ddXml: pendingTed.ddXml,
        privateKeyPem: material.cafPrivateKeyPem,
        mode: "certification",
      });
      if (!frmt.ok) fail(`PRE_CAF_FRMT_${certificationCase.id}_FAILED`);
      const ted = buildTedControlled({
        issuerRut: issuer.rut,
        documentTypeCode: 39,
        folio,
        issueDate,
        recipientRut: GENERIC_RECEIVER_RUT,
        recipientLegalName: "Consumidor final",
        totalAmount: totals.totalAmount,
        firstItemName: totals.lines[0].description,
        cafXml,
        timestamp: FIXTURE_TIMESTAMP,
        compact: true,
        frmtXml: frmt.frmtXml,
        frmtStatus: "synthetic_lab",
      });
      const unsigned = unsignedBoletaDte({
        certificationCase,
        totals,
        issuer,
        issueDate,
        folio,
        tedXml: ted.tedXml,
      });
      const signed = signXmlInFinalContextControlled(
        {
          xml: unsigned.xml,
          referenceId: unsigned.documentId,
          insertAfterXPath: "//*[local-name()='Documento']",
        },
        signingConfig(material, unsigned.documentId),
      );
      const pdfBytes = await renderBoletaPdf({
        certificationCase,
        totals,
        issuer,
        issueDate,
        folio,
        tedXml: ted.tedXml,
        verificationUrl,
      });
      documents.push({
        caseId: certificationCase.id,
        folio,
        totals,
        dteXml: signed.signedXml,
        tedXml: ted.tedXml,
        pdfBytes,
      });
    }

    const envelope = boletaEnvelopeUnsigned({ documents, issuer });
    const signedEnvelope = signXmlInFinalContextControlled(
      {
        xml: envelope.xml,
        referenceId: envelope.setId,
        insertAfterXPath: "//*[local-name()='SetDTE']",
      },
      signingConfig(material, envelope.setId),
    ).signedXml;
    const rvdTotals = sumBoletaRvdTotals(documents.map((item) => item.totals));
    if (
      rvdTotals.netAmount !== 43_831 ||
      rvdTotals.taxAmount !== 8_329 ||
      rvdTotals.exemptAmount !== 2_000 ||
      rvdTotals.totalAmount !== 54_160 ||
      Math.round((rvdTotals.netAmount * 19) / 100) !== 8_328
    ) {
      fail("PRE_CAF_RVD_TOTALS_INVALID");
    }
    const rvd = rvdUnsigned({
      documents,
      issuer,
      issueDate,
      totals: rvdTotals,
    });
    const signedRvd = signXmlInFinalContextControlled(
      {
        xml: rvd.xml,
        referenceId: rvd.documentId,
        insertAfterXPath: "//*[local-name()='DocumentoConsumoFolios']",
      },
      signingConfig(material, rvd.documentId),
    ).signedXml;

    validateXsd(signedEnvelope, BOLETA_XSD_PATH, "envio-boleta", outputDir);
    validateXsd(signedRvd, RVD_XSD_PATH, "rvd", outputDir);

    const envelopePath = join(outputDir, "EnvioBOLETA-PRE-CAF-FIXTURE.xml");
    const rvdPath = join(outputDir, "RVD-PRE-CAF-FIXTURE.xml");
    const fixtureCertificatePath = join(
      outputDir,
      "PRE-CAF-FIXTURE-PUBLIC-CERTIFICATE.pem",
    );
    writeFileSync(envelopePath, encodeIso88591(signedEnvelope), { mode: 0o600 });
    writeFileSync(rvdPath, encodeIso88591(signedRvd), { mode: 0o600 });
    writeFileSync(
      fixtureCertificatePath,
      readFileSync(material.certificatePath),
      { mode: 0o600 },
    );
    for (const document of documents) {
      const dtePath = join(
        outputDir,
        `${document.caseId}-BOLETA-39-PRE-CAF-FIXTURE.xml`,
      );
      writeFileSync(dtePath, encodeIso88591(document.dteXml), { mode: 0o600 });
      writeFileSync(
        join(outputDir, `${document.caseId}-BOLETA-39-PRE-CAF-FIXTURE.pdf`),
        document.pdfBytes,
        { mode: 0o600 },
      );
      verifySignature(dtePath, `CitayaBoleta39-${document.folio}`, material.certificatePath);
    }
    verifySignature(envelopePath, envelope.setId, material.certificatePath);
    verifySignature(rvdPath, rvd.documentId, material.certificatePath);

    const hashes = {
      envelope: sha256(signedEnvelope),
      rvd: sha256(signedRvd),
      ...Object.fromEntries(
        documents.flatMap((document) => [
          [`${document.caseId}.xml`, sha256(document.dteXml)],
          [`${document.caseId}.pdf`, sha256(document.pdfBytes)],
        ]),
      ),
    };
    const manifest = {
      status: "PRE_CAF_READY",
      environment: "certification",
      fixtureMode: true,
      legalValidity: "SIN_VALIDEZ_TRIBUTARIA",
      siiContacted: false,
      officialCafPresent: false,
      productionFoliosUsed: false,
      submitCommandPresent: false,
      documentType: 39,
      issueDate,
      firstFolio: options.firstFolio,
      lastFolio: options.firstFolio + 4,
      format: {
        boletaVersion: BOLETA_FORMAT_VERSION,
        boletaDate: BOLETA_FORMAT_DATE,
        schema: BOLETA_SCHEMA_VERSION,
        rvdVersion: RVD_FORMAT_VERSION,
        rvdDate: RVD_FORMAT_DATE,
      },
      totals: rvdTotals,
      hashes,
    };
    writeFileSync(
      join(outputDir, "manifest-pre-caf.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    return {
      status: "PRE_CAF_READY",
      environment: "certification",
      fixtureMode: true,
      siiContacted: false,
      officialCafPresent: false,
      productionFoliosUsed: false,
      documents,
      envelopeXml: signedEnvelope,
      rvdXml: signedRvd,
      rvdTotals,
      hashes,
      outputDir,
    };
  } finally {
    rmSync(material.root, { recursive: true, force: true });
  }
}

export type RealBoleta39CertificationArtifact = {
  kind: "boleta_xml" | "envelope_xml" | "rcof_xml";
  caseId?: BoletaCertificationCaseId;
  path: string;
  sha256: string;
  byteLength: number;
};

export type RealBoleta39CertificationResult = {
  status: "CERTIFICATION_ARTIFACTS_VALIDATED";
  environment: "certification";
  fixtureMode: false;
  siiContacted: false;
  productionFoliosUsed: false;
  documents: PreparedBoleta[];
  envelopeXml: string;
  rvdXml: string;
  rvdTotals: ReturnType<typeof sumBoletaRvdTotals>;
  artifacts: RealBoleta39CertificationArtifact[];
  hashes: Record<string, string>;
  xsd: { boletas: "5/5"; envelope: "valid"; rcof: "valid" };
  signatures: { tedFrmt: "5/5"; boletas: "5/5"; envelope: "valid"; rcof: "valid" };
  outputDir: string;
};

function assertRealCertificationEnvironment(env: NodeJS.ProcessEnv): void {
  if (
    env.DTE_MODE !== "certification" ||
    env.DTE_SII_ENV !== "certification" ||
    env.DTE_SII_ENABLE_SUBMIT === "true" ||
    env.DTE_SII_ENABLE_STATUS === "true" ||
    env.DTE_SII_LIVE_AUTH === "true" ||
    env.DTE_PRODUCTION_ENABLED === "true" ||
    env.DTE_AUTOMATIC_ISSUANCE_ENABLED === "true" ||
    env.DTE_SII_TOKEN ||
    env.DTE_TRACK_ID
  )
    fail("DTE_CERTIFICATION_OFFLINE_BOUNDARY_FAILED");
}

function verifyFrmt(ddXml: string, frmtXml: string, publicKeyPem: string): boolean {
  const value = frmtXml.match(/<FRMT algoritmo="SHA1withRSA">([\s\S]*?)<\/FRMT>/)?.[1]
    .replace(/\s+/g, "");
  if (!value) return false;
  const verifier = createVerify("RSA-SHA1");
  verifier.update(Buffer.from(buildOfficialFrmtDd(ddXml), "latin1"));
  return verifier.verify(publicKeyPem, value, "base64");
}

export async function prepareRealBoleta39Certification(input: {
  tenantId: string;
  issueDate: string;
  firstFolio: number;
  outputDir: string;
  issuer: BoletaPreCafIssuer;
  cafXml: string;
  cafPrivateKeyPem: string;
  cafPublicKeyPem: string;
  certificatePath: string;
  privateKeyPath: string;
  generationTimestamp: string;
}): Promise<RealBoleta39CertificationResult> {
  assertRealCertificationEnvironment(process.env);
  if (!input.tenantId.trim() || !Number.isSafeInteger(input.firstFolio) || input.firstFolio < 1)
    fail("DTE_CERTIFICATION_SCOPE_INVALID");
  const issueDate = assertDate(input.issueDate);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(input.generationTimestamp))
    fail("DTE_CERTIFICATION_TIMESTAMP_INVALID");
  const outputDir = resolve(input.outputDir);
  const repoRoot = resolve(process.cwd());
  if (outputDir === repoRoot || outputDir.startsWith(`${repoRoot}/`))
    fail("DTE_CERTIFICATION_OUTPUT_INSIDE_REPO");
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  chmodSync(outputDir, 0o700);
  const signing = (referenceId: string): RealXmlSigningConfig => ({
    tenantId: input.tenantId,
    mode: "certification",
    signatureTarget: referenceId,
    privateKeyPath: input.privateKeyPath,
    certificatePath: input.certificatePath,
    publicCertificatePath: input.certificatePath,
  });
  const documents: PreparedBoleta[] = [];
  const frmtChecks: boolean[] = [];
  for (const [index, certificationCase] of BOLETA_39_CERTIFICATION_CASES.entries()) {
    const folio = input.firstFolio + index;
    const totals = calculateBoletaGrossTotals(certificationCase.lines);
    assertExpectedTotals(certificationCase, totals);
    const pendingTed = buildTedControlled({
      issuerRut: input.issuer.rut,
      documentTypeCode: 39,
      folio,
      issueDate,
      recipientRut: GENERIC_RECEIVER_RUT,
      recipientLegalName: "Consumidor final",
      totalAmount: totals.totalAmount,
      firstItemName: totals.lines[0].description,
      cafXml: input.cafXml,
      timestamp: input.generationTimestamp,
      compact: true,
    });
    const frmt = signFrmtControlled({
      ddXml: pendingTed.ddXml,
      privateKeyPem: input.cafPrivateKeyPem,
      mode: "certification",
    });
    if (!frmt.ok) fail(`DTE_CERTIFICATION_FRMT_${certificationCase.id}_FAILED`);
    frmtChecks.push(verifyFrmt(pendingTed.ddXml, frmt.frmtXml, input.cafPublicKeyPem));
    const ted = buildTedControlled({
      issuerRut: input.issuer.rut,
      documentTypeCode: 39,
      folio,
      issueDate,
      recipientRut: GENERIC_RECEIVER_RUT,
      recipientLegalName: "Consumidor final",
      totalAmount: totals.totalAmount,
      firstItemName: totals.lines[0].description,
      cafXml: input.cafXml,
      timestamp: input.generationTimestamp,
      compact: true,
      frmtXml: frmt.frmtXml,
      frmtStatus: "real_controlled",
    });
    const unsigned = unsignedBoletaDte({
      certificationCase,
      totals,
      issuer: input.issuer,
      issueDate,
      folio,
      tedXml: ted.tedXml,
      timestamp: input.generationTimestamp,
    });
    const signed = signXmlInFinalContextControlled(
      {
        xml: unsigned.xml,
        referenceId: unsigned.documentId,
        insertAfterXPath: "//*[local-name()='Documento']",
      },
      signing(unsigned.documentId),
    );
    if (/<RSASK\b|<AUTORIZACION\b/.test(signed.signedXml))
      fail("DTE_CERTIFICATION_PRIVATE_CAF_MATERIAL_LEAK");
    documents.push({
      caseId: certificationCase.id,
      folio,
      totals,
      dteXml: signed.signedXml,
      tedXml: ted.tedXml,
      pdfBytes: Buffer.alloc(0),
    });
  }
  if (frmtChecks.some((ok) => !ok)) fail("DTE_CERTIFICATION_FRMT_VERIFY_FAILED");
  const envelope = boletaEnvelopeUnsigned({
    documents,
    issuer: input.issuer,
    timestamp: input.generationTimestamp,
  });
  const signedEnvelope = signXmlInFinalContextControlled(
    {
      xml: envelope.xml,
      referenceId: envelope.setId,
      insertAfterXPath: "//*[local-name()='SetDTE']",
    },
    signing(envelope.setId),
  ).signedXml;
  const rvdTotals = sumBoletaRvdTotals(documents.map((item) => item.totals));
  if (
    rvdTotals.netAmount !== 43_831 ||
    rvdTotals.taxAmount !== 8_329 ||
    rvdTotals.exemptAmount !== 2_000 ||
    rvdTotals.totalAmount !== 54_160
  )
    fail("DTE_CERTIFICATION_RCOF_TOTALS_INVALID");
  const rvd = rvdUnsigned({
    documents,
    issuer: input.issuer,
    issueDate,
    totals: rvdTotals,
    timestamp: input.generationTimestamp,
  });
  const signedRvd = signXmlInFinalContextControlled(
    {
      xml: rvd.xml,
      referenceId: rvd.documentId,
      insertAfterXPath: "//*[local-name()='DocumentoConsumoFolios']",
    },
    signing(rvd.documentId),
  ).signedXml;
  validateXsd(signedEnvelope, BOLETA_XSD_PATH, "envio-boleta-real", outputDir);
  validateXsd(signedRvd, RVD_XSD_PATH, "rcof-real", outputDir);
  const artifacts: RealBoleta39CertificationArtifact[] = [];
  for (const document of documents) {
    const path = join(outputDir, `${document.caseId}-BOLETA-39-CERTIFICATION.xml`);
    const bytes = encodeIso88591(`${XML_DECLARATION}\n${document.dteXml}`);
    writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
    chmodSync(path, 0o600);
    verifySignature(path, `CitayaBoleta39-${document.folio}`, input.certificatePath);
    artifacts.push({
      kind: "boleta_xml",
      caseId: document.caseId,
      path,
      sha256: sha256(bytes),
      byteLength: bytes.length,
    });
  }
  const lastFolio = input.firstFolio + documents.length - 1;
  const envelopeFilename = `EnvioBOLETA-39-CASO-${input.firstFolio}-${lastFolio}-CERTIFICATION.xml`;
  const rcofFilename = `RCOF-39-FOLIOS-${input.firstFolio}-${lastFolio}-CERTIFICATION.xml`;
  const envelopePath = join(outputDir, envelopeFilename);
  const rcofPath = join(outputDir, rcofFilename);
  const envelopeBytes = encodeIso88591(signedEnvelope);
  const rcofBytes = encodeIso88591(signedRvd);
  writeFileSync(envelopePath, envelopeBytes, { mode: 0o600, flag: "wx" });
  writeFileSync(rcofPath, rcofBytes, { mode: 0o600, flag: "wx" });
  chmodSync(envelopePath, 0o600);
  chmodSync(rcofPath, 0o600);
  verifySignature(envelopePath, envelope.setId, input.certificatePath);
  verifySignature(rcofPath, rvd.documentId, input.certificatePath);
  artifacts.push(
    {
      kind: "envelope_xml",
      path: envelopePath,
      sha256: sha256(envelopeBytes),
      byteLength: envelopeBytes.length,
    },
    {
      kind: "rcof_xml",
      path: rcofPath,
      sha256: sha256(rcofBytes),
      byteLength: rcofBytes.length,
    },
  );
  const hashes = Object.fromEntries(
    artifacts.map((artifact) => [artifact.caseId ?? artifact.kind, artifact.sha256]),
  );
  return {
    status: "CERTIFICATION_ARTIFACTS_VALIDATED",
    environment: "certification",
    fixtureMode: false,
    siiContacted: false,
    productionFoliosUsed: false,
    documents,
    envelopeXml: signedEnvelope,
    rvdXml: signedRvd,
    rvdTotals,
    artifacts,
    hashes,
    xsd: { boletas: "5/5", envelope: "valid", rcof: "valid" },
    signatures: {
      tedFrmt: "5/5",
      boletas: "5/5",
      envelope: "valid",
      rcof: "valid",
    },
    outputDir,
  };
}
