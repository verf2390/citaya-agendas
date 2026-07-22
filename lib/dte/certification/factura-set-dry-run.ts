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

import { signFrmtControlled } from "../caf/frmt-signature";
import {
  parseCafRealControlledXml,
  validateCafForDraftOrThrow,
} from "../caf/parse-caf.real";
import { buildTedControlled } from "../caf/ted-builder";
import { getSiiDteTypeCode } from "../dte-types";
import { normalizeRut } from "../rut";
import {
  buildXmlDsigControlled,
  canonicalizeXmlControlled,
  verifyXmlSignatureControlled,
} from "../signing/sign-xml.real";
import type {
  RealXmlSigningConfig,
  TaxDocumentDraft,
  TaxDocumentReference,
} from "../types";
import {
  buildDteDocumentId,
  buildDteDocumentoXmlLab,
  buildDteSetDteXmlLab,
} from "../xml/build-dte-envelope";
import { escapeXml } from "../xml/escape-xml";
import {
  buildFacturaCertificationDocuments,
  type FacturaCertificationCaseId,
  type FacturaCertificationDocument,
  type FacturaCertificationReference,
} from "./factura-electronica-set";
import {
  loadFacturaPreCafInputFromPath,
  type FacturaPreCafInputFile,
} from "./pre-caf-input-loader";
import {
  PRE_CAF_REQUIRED_CASE_ORDER,
  validatePreCafExternalData,
} from "./pre-caf-external-contract";

export const SII_DTE_NAMESPACE = "http://www.sii.cl/SiiDte";
export const FACTURA_SET_FIXTURE_OUTPUT_DIR =
  "/home/verf/secure/dte-lab/factura-set-4959698-dry-run";
export const FACTURA_SET_FIXTURE_TIMESTAMP = "2026-07-19T12:00:00";
const FIXTURE_OUTPUT_DIR = FACTURA_SET_FIXTURE_OUTPUT_DIR;
const FIXTURE_TIMESTAMP = FACTURA_SET_FIXTURE_TIMESTAMP;
const FIXTURE_TENANT_ID = "citaya-rg-pre-caf-fixture";
const XML_DECLARATION_ISO_8859_1 =
  '<?xml version="1.0" encoding="ISO-8859-1"?>';

export type FacturaSetDryRunOptions = {
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  outputDir?: string;
  realCertification?: { privateKeyPath: string; certificatePath: string };
  overrides?: Partial<{
    cafIssuerRut: string;
    cafTypeByCase: Partial<Record<FacturaCertificationCaseId, number>>;
    cafRangeByCase: Partial<
      Record<FacturaCertificationCaseId, { from: number; to: number }>
    >;
    folioByCase: Partial<Record<FacturaCertificationCaseId, number>>;
    referenceSourceByCase: Partial<
      Record<FacturaCertificationCaseId, FacturaCertificationCaseId>
    >;
    caseOrder: FacturaCertificationCaseId[];
    tamperDocumentSignatureCase: FacturaCertificationCaseId;
    alterTotalCase: FacturaCertificationCaseId;
    mismatchedCertificateKey: boolean;
    realCafPath: string;
    importedCafByType: Partial<
      Record<
        33 | 56 | 61,
        { cafXml: string; privateKeyPem: string; publicKeyPem: string }
      >
    >;
  }>;
};

export type FacturaSetDryRunResult = {
  environment: "certification";
  fixtureMode: boolean;
  documents: 8;
  type33: 4;
  type61: 3;
  type56: 1;
  dteXsd: "8/8";
  envioDteXsd: "valid";
  tedFrmt: "8/8";
  dteSignatures: "8/8";
  envelopeSignature: "valid";
  references: "valid";
  totals: "valid";
  realCaf: boolean;
  realFolios: boolean;
  siiContacted: false;
  readyToDownloadCaf: false;
  outputDir: string;
  manifestPath: string;
};

type FixtureMaterial = {
  root: string;
  privateKeyPath: string;
  certPath: string;
  privateKeyPem: string;
  certificatePem: string;
};

type SignedDocument = {
  caseId: FacturaCertificationCaseId;
  draft: TaxDocumentDraft;
  unsignedDocumentoXml: string;
  signatureXml: string;
  dteXml: string;
  cafXml: string;
  tedXml: string;
  ddXml: string;
  frmtXml: string;
  cafPublicKeyPem: string;
};

const fixtureFolios: Record<FacturaCertificationCaseId, number> = {
  "4959698-1": 330001,
  "4959698-2": 330002,
  "4959698-3": 330003,
  "4959698-4": 330004,
  "4959698-5": 610001,
  "4959698-6": 610002,
  "4959698-7": 610003,
  "4959698-8": 560001,
};

const sourceByNote: Partial<
  Record<FacturaCertificationCaseId, FacturaCertificationCaseId>
> = {
  "4959698-5": "4959698-1",
  "4959698-6": "4959698-2",
  "4959698-7": "4959698-3",
  "4959698-8": "4959698-5",
};

function fail(message: string): never {
  throw new Error(message);
}

function assertCertificationEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.DTE_MODE !== "certification" || env.DTE_SII_ENV !== "certification") fail("DTE_MODE y DTE_SII_ENV deben ser certification para PRE-CAF 8");
  if (env.DTE_CAF_PATH || env.DTE_CAF_PRIVATE_KEY_PATH) fail("rutas CAF heredadas bloqueadas para PRE-CAF 8");
  if (env.DTE_SII_ENABLE_SUBMIT === "true" || env.DTE_SII_ENABLE_STATUS === "true" || env.DTE_SII_LIVE_AUTH === "true") fail("red SII bloqueada para PRE-CAF 8");
  if (env.DTE_TRACK_ID || env.DTE_SII_TOKEN) fail("track_id/token bloqueado para PRE-CAF 8");
}

function createSelfSignedFixture(prefix = "citaya-pre-caf-8", rsaBits = 2048): FixtureMaterial {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const privateKeyPath = join(root, "fixture-private-key.pem");
  const certPath = join(root, "fixture-cert.pem");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    `rsa:${rsaBits}`,
    "-keyout",
    privateKeyPath,
    "-out",
    certPath,
    "-nodes",
    "-days",
    "2",
    "-subj",
    "/CN=Citaya PRE CAF Fixture/serialNumber=11111111-1/C=CL",
  ], { stdio: "ignore" });
  chmodSync(privateKeyPath, 0o600);
  chmodSync(certPath, 0o600);
  return {
    root,
    privateKeyPath,
    certPath,
    privateKeyPem: readFileSync(privateKeyPath, "utf8"),
    certificatePem: readFileSync(certPath, "utf8"),
  };
}

function loadExternalSigningMaterial(paths: {
  privateKeyPath: string;
  certificatePath: string;
}): FixtureMaterial {
  const privateKeyPem = readFileSync(paths.privateKeyPath, "utf8");
  const certificatePem = readFileSync(paths.certificatePath, "utf8");
  const derived = createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: "spki",
    format: "der",
  });
  const supplied = createPublicKey(certificatePem).export({
    type: "spki",
    format: "der",
  });
  if (!Buffer.from(derived).equals(Buffer.from(supplied)))
    fail("certificado y llave externa no coinciden");
  return {
    root: "",
    privateKeyPath: paths.privateKeyPath,
    certPath: paths.certificatePath,
    privateKeyPem,
    certificatePem,
  };
}

function publicKeyPartsFromPrivateKey(privateKeyPem: string): {
  modulus: string;
  exponent: string;
} {
  const jwk = createPublicKey(createPrivateKey(privateKeyPem)).export({
    format: "jwk",
  }) as { kty?: string; n?: string; e?: string };
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e)
    fail("fixture private key no contiene RSA public key");
  return {
    modulus: Buffer.from(jwk.n, "base64url").toString("base64"),
    exponent: Buffer.from(jwk.e, "base64url").toString("base64"),
  };
}

function buildFixtureCafXml(input: {
  issuerRut: string;
  issuerName: string;
  typeCode: number;
  rangeFrom: number;
  rangeTo: number;
  cafPrivateKeyPem: string;
}): string {
  const rsa = publicKeyPartsFromPrivateKey(input.cafPrivateKeyPem);
  const daXml = [
    "<DA>",
    `  <RE>${normalizeRut(input.issuerRut)}</RE>`,
    `  <RS>${escapeXml(input.issuerName.trim().slice(0, 40))}</RS>`,
    `  <TD>${input.typeCode}</TD>`,
    "  <RNG>",
    `    <D>${input.rangeFrom}</D>`,
    `    <H>${input.rangeTo}</H>`,
    "  </RNG>",
    "  <FA>2026-07-19</FA>",
    "  <RSAPK>",
    `    <M>${rsa.modulus}</M>`,
    `    <E>${rsa.exponent}</E>`,
    "  </RSAPK>",
    "  <IDK>1</IDK>",
    "</DA>",
  ]
    .map((line) => line.trim())
    .join("");
  const signer = createSign("RSA-SHA1");
  signer.update(daXml, "utf8");
  const frma = signer.sign(input.cafPrivateKeyPem, "base64");
  return [
    '<CAF version="1.0">',
    daXml,
    `  <FRMA algoritmo="SHA1withRSA">${frma}</FRMA>`,
    "</CAF>",
  ]
    .map((line) => line.trim())
    .join("");
}

function fixtureRangeFor(typeCode: number): { from: number; to: number } {
  if (typeCode === 33) return { from: 330001, to: 330099 };
  if (typeCode === 61) return { from: 610001, to: 610099 };
  if (typeCode === 56) return { from: 560001, to: 560099 };
  fail(`tipo fixture no soportado ${typeCode}`);
}

function receiverKeyFor(
  caseId: FacturaCertificationCaseId,
): "receiver1" | "receiver2" | "receiver3" | "receiver4" {
  if (caseId === "4959698-1") return "receiver1";
  if (caseId === "4959698-2") return "receiver2";
  if (caseId === "4959698-3") return "receiver3";
  if (caseId === "4959698-4") return "receiver4";
  const source = sourceByNote[caseId] ?? fail(`nota sin origen ${caseId}`);
  return receiverKeyFor(source);
}

function normalizeReference(
  reference: FacturaCertificationReference,
  caseId: FacturaCertificationCaseId,
  sourceCaseId: FacturaCertificationCaseId | undefined,
  issueDate: string,
  folios: Record<FacturaCertificationCaseId, number>,
): TaxDocumentReference {
  if (reference.kind === "set") {
    return {
      documentType: "SET",
      folio: caseId,
      date: issueDate,
      code: "",
      reason: reference.razonRef,
      isGlobal: true,
    };
  }
  const source =
    sourceCaseId ?? fail(`referencia especifica sin origen ${caseId}`);
  return {
    documentType: reference.tpoDocRef,
    folio: String(folios[source]),
    date: reference.fchRef ?? issueDate,
    code: String(reference.codRef ?? ""),
    reason: reference.razonRef,
  };
}

function buildDrafts(
  input: FacturaPreCafInputFile,
  issueDate: string,
  taxPeriod: string,
  overrides: FacturaSetDryRunOptions["overrides"] = {},
): TaxDocumentDraft[] {
  const caseOrder = overrides.caseOrder ?? [...PRE_CAF_REQUIRED_CASE_ORDER];
  const docs = buildFacturaCertificationDocuments({
    issueDate,
    taxPeriod,
    caseOrder,
    textCorrection: {
      previousBusinessActivity: input.textCorrection?.giroAnterior,
      correctedBusinessActivity: input.textCorrection?.giroCorregido,
    },
  });
  const folios = { ...fixtureFolios, ...(overrides.folioByCase ?? {}) };
  const sourceMap = {
    ...sourceByNote,
    ...(overrides.referenceSourceByCase ?? {}),
  };
  const seen = new Map<string, Set<number>>();

  return docs.map((doc) => {
    const folio = folios[doc.caseId];
    if (!Number.isSafeInteger(folio) || folio <= 0)
      fail(`folio fixture invalido ${doc.caseId}`);
    const typeSet = seen.get(String(doc.documentTypeCode)) ?? new Set<number>();
    if (typeSet.has(folio)) fail("folio fixture repetido dentro del tipo DTE");
    typeSet.add(folio);
    seen.set(String(doc.documentTypeCode), typeSet);

    const receiver =
      input.receivers?.[receiverKeyFor(doc.caseId)] ??
      fail(`receiver faltante ${doc.caseId}`);
    const usePreviousGiro =
      doc.caseId === "4959698-1" && input.textCorrection?.giroAnterior;
    const lineDescription = doc.textCorrectionDetail?.lineDescription;
    const zeroAmountLineName = doc.references[1]?.razonRef ?? "ITEM MONTO CERO";
    const lines = doc.lines.map((line) => ({
      name: lineDescription
        ? "CORRIGE GIRO DEL RECEPTOR"
        : line.montoItem === 0
          ? zeroAmountLineName.slice(0, 80)
          : line.name,
      description: lineDescription ?? undefined,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.montoItem,
      exempt: line.exempt,
      discountPercent: line.discountPercent,
      discountAmount: line.discountAmount,
    }));
    const globalDiscount = doc.totals.globalDiscount
      ? ({
          discountType: doc.totals.globalDiscount.discountType,
          valueType: doc.totals.globalDiscount.valueType,
          value: doc.totals.globalDiscount.discountPercent,
          appliesTo: doc.totals.globalDiscount.appliesTo,
        } as const)
      : null;

    return {
      tenantId: FIXTURE_TENANT_ID,
      issueMode: "citaya_own_dte",
      documentType: doc.documentType,
      status: "pending_signature",
      folio,
      issueDate: doc.issueDate,
      issuer: {
        tenantId: FIXTURE_TENANT_ID,
        rut: input.issuer?.rutEmisor ?? "",
        legalName: input.issuer?.razonSocial ?? "",
        businessActivity: input.issuer?.giroEmisor ?? "",
        businessActivityCode: input.issuer?.acteco ?? "",
        address: input.issuer?.direccionOrigen ?? "",
        commune: input.issuer?.comunaOrigen ?? "",
        city: input.issuer?.ciudadOrigen ?? "",
        siiResolutionDate: input.issuer?.fechaResolucion ?? "",
        siiResolutionNumber: String(input.issuer?.numeroResolucion ?? ""),
        dteEnvironment: "certification",
      },
      recipient: {
        rut: receiver.rut ?? "",
        legalName: receiver.razonSocial ?? "",
        businessActivity: usePreviousGiro
          ? input.textCorrection?.giroAnterior
          : receiver.giro,
        address: receiver.direccion ?? "",
        commune: receiver.comuna ?? "",
        city: receiver.ciudad ?? "",
        email: "certificacion@example.invalid",
      },
      lines,
      references: doc.references.map((reference) =>
        normalizeReference(
          reference,
          doc.caseId,
          sourceMap[doc.caseId],
          issueDate,
          folios,
        ),
      ),
      globalDiscount,
      netAmount: doc.totals.netAmount,
      exemptAmount: doc.totals.exemptAmount,
      taxAmount: doc.totals.vatAmount,
      totalAmount: doc.totals.totalAmount,
    };
  });
}

function assertTotals(
  drafts: TaxDocumentDraft[],
  docs: FacturaCertificationDocument[],
): void {
  drafts.forEach((draft, index) => {
    if (!docs[index]) fail("documento tributario sin caso");
    if (
      draft.totalAmount !==
      (draft.netAmount ?? 0) +
        (draft.exemptAmount ?? 0) +
        (draft.taxAmount ?? 0)
    )
      fail("total DTE no cuadra");
  });
}

function assertReferences(
  drafts: TaxDocumentDraft[],
  folios: Record<FacturaCertificationCaseId, number>,
): void {
  const expectedOrder = [...PRE_CAF_REQUIRED_CASE_ORDER];
  const caseByFolio = new Map<number, FacturaCertificationCaseId>();
  for (const caseId of expectedOrder) caseByFolio.set(folios[caseId], caseId);
  drafts.forEach((draft, index) => {
    const caseId =
      caseByFolio.get(draft.folio) ?? fail("folio fixture sin caso");
    if (caseId !== expectedOrder[index])
      fail("orden de documentos del set invalido");
    const refs = draft.references ?? [];
    if (
      refs[0]?.documentType !== "SET" ||
      refs[0]?.reason !== `CASO ${caseId}` ||
      refs[0]?.isGlobal !== true
    )
      fail("referencia SET invalida");
    if (["nota_credito", "nota_debito"].includes(draft.documentType)) {
      const expectedSource =
        sourceByNote[caseId] ?? fail(`origen esperado faltante ${caseId}`);
      if (
        refs.length !== 2 ||
        !refs[1].folio ||
        refs[1].folio === "PENDING_REAL_FOLIO" ||
        refs[1].folio !== String(folios[expectedSource])
      )
        fail("referencia tributaria fixture invalida");
    }
  });
}

function withDteNamespace(dteXml: string): string {
  return dteXml.replace(
    "<DTE version=",
    `<DTE xmlns="${SII_DTE_NAMESPACE}" version=`,
  );
}

function extractDocumentoForSignature(dteXml: string): string {
  const match = dteXml.match(/<Documento ID="[^"]+">[\s\S]*<\/Documento>/);
  if (!match) fail("Documento no encontrado para firma");
  return match[0].replace(
    "<Documento ",
    `<Documento xmlns="${SII_DTE_NAMESPACE}" `,
  );
}

function redactXsdDiagnostic(value: string): string {
  return value
    .replace(/The value '[^']*'/g, "The value '[redacted]'")
    .replace(/Bytes: 0x[0-9A-Fa-f ]+/g, "Bytes: [redacted]")
    .replace(/>[^<]{8,}</g, ">[redacted]<");
}

function assertIso88591XmlText(xml: string): void {
  for (const char of xml) {
    const code = char.codePointAt(0) ?? 0;
    const validXmlChar =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd);
    if (!validXmlChar)
      fail("caracter de control XML invalido en artefacto fixture");
    if (code > 0xff) fail("caracter fuera de ISO-8859-1 en artefacto fixture");
  }
}

export function encodeIso88591Strict(xml: string): Buffer {
  assertIso88591XmlText(xml);
  const buffer = Buffer.from(xml, "latin1");
  if (buffer.toString("latin1") !== xml) fail("round-trip ISO-8859-1 fallo para artefacto fixture");
  return buffer;
}

function validateXsd(xml: string, schemaName: "DTE_v10.xsd" | "EnvioDTE_v10.xsd", label: string, outputDir: string): void {
  const file = join(outputDir, `${label}.xml`);
  writeFileSync(file, encodeIso88591Strict(xml));
  chmodSync(file, 0o600);
  const result = spawnSync("xmllint", ["--noout", "--schema", schemaName, file], {
    cwd: resolve("docs/dte-sii/xsd"),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    const message = redactXsdDiagnostic((result.stderr || result.stdout || "xmllint failed").trim().split(/\r?\n/).slice(0, 3).join(" | "));
    fail(`XSD ${label} invalido: ${message}`);
  }
}

function signingConfig(material: FixtureMaterial, target: string): RealXmlSigningConfig {
  return {
    tenantId: FIXTURE_TENANT_ID,
    mode: "certification",
    signatureTarget: target,
    privateKeyPath: material.privateKeyPath,
    certificatePath: material.certPath,
    publicCertificatePath: material.certPath,
  };
}

function signAndBuildDocuments(drafts: TaxDocumentDraft[], xmlMaterial: FixtureMaterial, cafMaterial: FixtureMaterial, outputDir: string, overrides: FacturaSetDryRunOptions["overrides"] = {}, timestamp = FIXTURE_TIMESTAMP): SignedDocument[] {
  return drafts.map((draft) => {
    const caseId = PRE_CAF_REQUIRED_CASE_ORDER[drafts.indexOf(draft)];
    const typeCode = getSiiDteTypeCode(draft.documentType);
    const cafTypeCode = overrides.cafTypeByCase?.[caseId] ?? typeCode;
    const range = overrides.cafRangeByCase?.[caseId] ?? fixtureRangeFor(typeCode);
    const imported = overrides.importedCafByType?.[typeCode as 33 | 56 | 61];
    const cafPrivateKeyPem = imported?.privateKeyPem ?? cafMaterial.privateKeyPem;
    const cafPublicKeyPem = imported?.publicKeyPem ?? cafMaterial.certificatePem;
    const cafXml = imported?.cafXml ?? buildFixtureCafXml({
      issuerRut: overrides.cafIssuerRut ?? draft.issuer.rut,
      issuerName: draft.issuer.legalName,
      typeCode: cafTypeCode,
      rangeFrom: range.from,
      rangeTo: range.to,
      cafPrivateKeyPem,
    });
    const caf = parseCafRealControlledXml(cafXml, FIXTURE_TENANT_ID);
    validateCafForDraftOrThrow(caf, draft);
    const tedWithoutFrmt = buildTedControlled({
      issuerRut: caf.issuerRut,
      documentTypeCode: typeCode,
      folio: draft.folio,
      issueDate: draft.issueDate.slice(0, 10),
      recipientRut: draft.recipient.rut,
      recipientLegalName: draft.recipient.legalName,
      totalAmount: draft.totalAmount,
      firstItemName: draft.lines[0]?.name ?? "ITEM",
      cafXml,
      timestamp,
      compact: true,
    });
    const frmt = signFrmtControlled({
      ddXml: tedWithoutFrmt.ddXml,
      inputEncoding: "latin1",
      privateKeyPem: cafPrivateKeyPem,
      mode: "certification",
    });
    if (!frmt.ok) fail("FRMT fixture no pudo firmarse");
    const ted = buildTedControlled({
      issuerRut: caf.issuerRut,
      documentTypeCode: typeCode,
      folio: draft.folio,
      issueDate: draft.issueDate.slice(0, 10),
      recipientRut: draft.recipient.rut,
      recipientLegalName: draft.recipient.legalName,
      totalAmount: draft.totalAmount,
      firstItemName: draft.lines[0]?.name ?? "ITEM",
      cafXml,
      timestamp,
      frmtXml: frmt.frmtXml,
      frmtStatus: "real_controlled",
      compact: true,
    });
    const unsignedDteXml = buildDteDocumentoXmlLab(draft, { tedXml: ted.tedXml, documentSignedAt: timestamp, mode: "certification", preserveTedWhitespace: true });
    const unsignedDocumentoXml = extractDocumentoForSignature(unsignedDteXml);
    const documentId = buildDteDocumentId(draft);
    const signature = buildXmlDsigControlled({ referenceUri: documentId, signedXmlFragment: unsignedDocumentoXml, mode: "certification" }, signingConfig(xmlMaterial, documentId));
    if (!signature.verification?.ok) fail(`firma XMLDSig DTE fixture no verifica localmente: ${signature.reason ?? signature.verification?.reason ?? "sin detalle"}`);
    const signatureXml = overrides.tamperDocumentSignatureCase === caseId
      ? signature.signatureXml.replace(/<SignatureValue>(.)/, "<SignatureValue>X")
      : signature.signatureXml;
    const dteXml = withDteNamespace(buildDteDocumentoXmlLab(draft, { tedXml: ted.tedXml, documentSignatureXml: signatureXml, documentSignedAt: timestamp, mode: "certification", preserveTedWhitespace: true }));
    const finalDteXml = `${XML_DECLARATION_ISO_8859_1}\n${dteXml}`;
    validateXsd(finalDteXml, "DTE_v10.xsd", `${caseId}-dte`, outputDir);
    return { caseId, draft, unsignedDocumentoXml, signatureXml, dteXml: finalDteXml, cafXml, tedXml: ted.tedXml, ddXml: ted.ddXml, frmtXml: frmt.frmtXml, cafPublicKeyPem };
  });
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1]?.trim() ?? fail(`tag ${tag} no encontrado`);
}

function verifyFrmt(ddXml: string, frmtXml: string, publicKeyPem: string): boolean {
  const verifier = createVerify("RSA-SHA1");
  verifier.update(Buffer.from(ddXml, "latin1"));
  return verifier.verify(publicKeyPem, extractTag(frmtXml, "FRMT"), "base64");
}

function verifyInsertedSignature(referenceXml: string, signatureXml: string, material: FixtureMaterial): boolean {
  const signedInfoMatch = signatureXml.match(/<SignedInfo[\s\S]*?<\/SignedInfo>/);
  if (!signedInfoMatch) return false;
  const digest = extractTag(signatureXml, "DigestValue");
  const signatureValue = extractTag(signatureXml, "SignatureValue");
  const canonicalReference = canonicalizeXmlControlled(referenceXml);
  if (!canonicalReference.ok) return false;
  const signedInfoXml = signedInfoMatch[0].startsWith('<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">')
    ? signedInfoMatch[0]
    : signedInfoMatch[0]
      .split("\n")
      .map((line) => line.replace(/^  /, ""))
      .join("\n")
      .replace(/^<SignedInfo>/, '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  const verification = verifyXmlSignatureControlled({
    signedInfoXml,
    signatureValue,
    certificatePem: material.certificatePem,
    expectedDigestValue: digest,
    canonicalizedReferenceXml: canonicalReference.canonicalXml,
  });
  return verification.ok;
}

function buildEnvioXml(
  drafts: TaxDocumentDraft[],
  signedDocuments: SignedDocument[],
  material: FixtureMaterial,
  rutEnvia: string,
  outputDir: string,
  realCertification = false,
  timestamp = FIXTURE_TIMESTAMP,
): string {
  const perDocumentXml = Object.fromEntries(
    signedDocuments.map((doc) => [
      doc.draft.folio,
      {
        tedXml: doc.tedXml,
        documentSignatureXml: doc.signatureXml,
        documentSignedAt: timestamp,
        preserveTedWhitespace: true,
      },
    ]),
  );
  const setDteId = realCertification
    ? `CitayaSetDTE-4959698-CERT`
    : `CitayaSetDTE-4959698-FIXTURE`;
  const setDteXml = buildDteSetDteXmlLab(drafts, {
    setDteId,
    rutEnvia,
    perDocumentXml,
    mode: "certification",
  }).replace("<SetDTE ", `<SetDTE xmlns="${SII_DTE_NAMESPACE}" `);
  const envelopeSignature = buildXmlDsigControlled(
    {
      referenceUri: setDteId,
      signedXmlFragment: setDteXml,
      mode: "certification",
    },
    signingConfig(material, setDteId),
  );
  if (!envelopeSignature.verification?.ok)
    fail("firma XMLDSig SetDTE fixture no verifica localmente");
  const warning = realCertification
    ? ""
    : "<!-- FIXTURE SIN VALIDEZ TRIBUTARIA - NO ENVIAR AL SII -->\n";
  const envioXml = `${XML_DECLARATION_ISO_8859_1}\n${warning}<EnvioDTE xmlns="${SII_DTE_NAMESPACE}" version="1.0">\n${setDteXml.replace(` xmlns="${SII_DTE_NAMESPACE}"`, "")}\n${envelopeSignature.signatureXml}\n</EnvioDTE>`;
  validateXsd(
    envioXml,
    "EnvioDTE_v10.xsd",
    realCertification
      ? "envio-dte-4959698-certification"
      : "envio-dte-4959698-fixture",
    outputDir,
  );
  if (
    !verifyInsertedSignature(
      setDteXml,
      envelopeSignature.signatureXml,
      material,
    )
  )
    fail("firma de sobre fixture no verifica despues de insertar");
  return envioXml;
}

function assertNoPendingFolios(xml: string): void {
  if (xml.includes("PENDING_REAL_FOLIO"))
    fail("PENDING_REAL_FOLIO presente en XML fixture");
}

function ensureOutputDir(path: string): string {
  const outputDir = resolve(path);
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  chmodSync(outputDir, 0o700);
  return outputDir;
}

function writeSafeXml(path: string, xml: string): void {
  writeFileSync(path, encodeIso88591Strict(xml));
  chmodSync(path, 0o600);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeSetManifest(
  outputDir: string,
  paths: string[],
  signedDocuments: SignedDocument[],
  realCertification: boolean,
  generatedAt: string,
): string {
  const manifestPath = join(
    outputDir,
    realCertification
      ? "manifest-4959698-CERTIFICATION.json"
      : "manifest-4959698-FIXTURE-SIN-VALIDEZ.json",
  );
  const manifest = {
    fixtureMode: !realCertification,
    legalValidity: realCertification
      ? "CERTIFICATION_OFFLINE_NOT_SUBMITTED"
      : "SIN_VALIDEZ_TRIBUTARIA",
    encoding: "ISO-8859-1",
    generatedAt,
    files: paths.map((path) => ({
      file: path.split("/").pop(),
      sha256: sha256File(path),
    })),
    cafHashes: signedDocuments.map((doc) => ({
      caseId: doc.caseId,
      sha256: createHash("sha256").update(doc.cafXml).digest("hex"),
    })),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  chmodSync(manifestPath, 0o600);
  return manifestPath;
}

function countTypes(drafts: TaxDocumentDraft[]): {
  type33: 4;
  type61: 3;
  type56: 1;
} {
  const type33 = drafts.filter(
    (draft) => getSiiDteTypeCode(draft.documentType) === 33,
  ).length;
  const type61 = drafts.filter(
    (draft) => getSiiDteTypeCode(draft.documentType) === 61,
  ).length;
  const type56 = drafts.filter(
    (draft) => getSiiDteTypeCode(draft.documentType) === 56,
  ).length;
  if (type33 !== 4 || type61 !== 3 || type56 !== 1 || drafts.length !== 8)
    fail("cantidad de documentos del set invalida");
  return { type33: 4, type61: 3, type56: 1 };
}

export function runFacturaSetDryRun(
  options: FacturaSetDryRunOptions = {},
): FacturaSetDryRunResult {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? process.cwd();
  assertCertificationEnvironment(env);
  if (options.overrides?.realCafPath)
    fail("rutas CAF reales bloqueadas para PRE-CAF 8");
  const realCertification = Boolean(options.realCertification);
  if (
    realCertification &&
    [33, 61, 56].some(
      (type) => !options.overrides?.importedCafByType?.[type as 33 | 61 | 56],
    )
  )
    fail("CAF auditado faltante para tipo requerido");

  const loadEnv = {
    ...env,
    DTE_FACTURA_PRE_CAF_ISSUE_DATE:
      env.DTE_FACTURA_PRE_CAF_ISSUE_DATE ?? env.DTE_CERTIFICATION_ISSUE_DATE,
  };
  const loaded = loadFacturaPreCafInputFromPath({
    inputPath: env.DTE_FACTURA_PRE_CAF_INPUT_PATH,
    repoRoot,
    env: loadEnv,
  });
  if (!loaded.ok)
    fail(
      `input PRE-CAF invalido missing=${loaded.missingFields.join(",")} invalid=${loaded.invalidFields.join(",")}`,
    );
  const validation = validatePreCafExternalData(loaded.input);
  if (!validation.ok)
    fail(
      `contrato PRE-CAF invalido missing=${validation.missingFields.join(",")} invalid=${validation.invalidFields.join(",")}`,
    );

  const outputDir = ensureOutputDir(
    options.outputDir ??
      env.DTE_FACTURA_SET_DRY_RUN_OUTPUT_DIR ??
      FIXTURE_OUTPUT_DIR,
  );
  const docs = buildFacturaCertificationDocuments({
    issueDate: loaded.issueDate,
    taxPeriod: loaded.taxPeriod,
    textCorrection: {
      previousBusinessActivity: loaded.input.textCorrection?.giroAnterior,
      correctedBusinessActivity: loaded.input.textCorrection?.giroCorregido,
    },
  });
  const drafts = buildDrafts(
    loaded.input,
    loaded.issueDate,
    loaded.taxPeriod,
    options.overrides,
  );
  if (options.overrides?.alterTotalCase) {
    const target =
      drafts[
        PRE_CAF_REQUIRED_CASE_ORDER.indexOf(options.overrides.alterTotalCase)
      ];
    target.totalAmount += 1;
  }
  assertTotals(drafts, docs);
  const selectedFolios = {
    ...fixtureFolios,
    ...(options.overrides?.folioByCase ?? {}),
  };
  assertReferences(drafts, selectedFolios);
  const typeCounts = countTypes(drafts);

  const xmlMaterial = options.realCertification
    ? loadExternalSigningMaterial(options.realCertification)
    : createSelfSignedFixture("citaya-pre-caf-8-xml");
  const cafMaterial = createSelfSignedFixture("citaya-pre-caf-8-caf", 768);
  const documentSigningMaterial = options.overrides?.mismatchedCertificateKey
    ? cafMaterial
    : xmlMaterial;
  const generationTimestamp = realCertification
    ? `${loaded.issueDate}T12:00:00`
    : FIXTURE_TIMESTAMP;
  try {
    const signed = signAndBuildDocuments(
      drafts,
      documentSigningMaterial,
      cafMaterial,
      outputDir,
      options.overrides,
      generationTimestamp,
    );
    const dteSignatureOk = signed.filter((doc) =>
      verifyInsertedSignature(
        doc.unsignedDocumentoXml,
        doc.signatureXml,
        xmlMaterial,
      ),
    ).length;
    if (dteSignatureOk !== 8)
      fail(`firmas DTE fixture no verifican ${dteSignatureOk}/8`);
    const frmtOk = signed.filter((doc) =>
      verifyFrmt(doc.ddXml, doc.frmtXml, doc.cafPublicKeyPem),
    ).length;
    if (frmtOk !== 8) fail("FRMT fixture no verifica 8/8");
    const envioXml = buildEnvioXml(
      drafts,
      signed,
      xmlMaterial,
      loaded.input.issuer?.rutEnvia ?? "",
      outputDir,
      realCertification,
      generationTimestamp,
    );
    assertNoPendingFolios(envioXml);
    const writtenPaths: string[] = [];
    signed.forEach((doc) => {
      const path = join(
        outputDir,
        realCertification
          ? `${doc.caseId}-DTE-CERTIFICATION.xml`
          : `${doc.caseId}-DTE-FIXTURE-SIN-VALIDEZ.xml`,
      );
      writeSafeXml(path, doc.dteXml);
      writtenPaths.push(path);
    });
    const envioPath = join(
      outputDir,
      realCertification
        ? "EnvioDTE-4959698-CERTIFICATION.xml"
        : "EnvioDTE-4959698-FIXTURE-SIN-VALIDEZ.xml",
    );
    writeSafeXml(envioPath, envioXml);
    writtenPaths.push(envioPath);
    const manifestPath = writeSetManifest(
      outputDir,
      writtenPaths,
      signed,
      realCertification,
      generationTimestamp,
    );
    return {
      environment: "certification",
      fixtureMode: !realCertification,
      documents: 8,
      ...typeCounts,
      dteXsd: "8/8",
      envioDteXsd: "valid",
      tedFrmt: "8/8",
      dteSignatures: "8/8",
      envelopeSignature: "valid",
      references: "valid",
      totals: "valid",
      realCaf: realCertification,
      realFolios: realCertification,
      siiContacted: false,
      readyToDownloadCaf: false,
      outputDir,
      manifestPath,
    };
  } finally {
    if (xmlMaterial.root) rmSync(xmlMaterial.root, { recursive: true, force: true });
    if (cafMaterial.root !== xmlMaterial.root) rmSync(cafMaterial.root, { recursive: true, force: true });
  }
}

export function formatFacturaSetDryRunResult(result: FacturaSetDryRunResult): string {
  return [
    `environment=${result.environment}`,
    `fixtureMode=${result.fixtureMode}`,
    `documents=${result.documents}`,
    `type33=${result.type33}`,
    `type61=${result.type61}`,
    `type56=${result.type56}`,
    `dteXsd=${result.dteXsd}`,
    `envioDteXsd=${result.envioDteXsd}`,
    `tedFrmt=${result.tedFrmt}`,
    `dteSignatures=${result.dteSignatures}`,
    `envelopeSignature=${result.envelopeSignature}`,
    `references=${result.references}`,
    `totals=${result.totals}`,
    `realCaf=${result.realCaf}`,
    `realFolios=${result.realFolios}`,
    `siiContacted=${result.siiContacted}`,
    `readyToDownloadCaf=${result.readyToDownloadCaf}`,
  ].join("\n");
}

export function safeDryRunFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
