import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  X509Certificate,
  createVerify,
} from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
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
  signXmlInFinalContextControlled,
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
  dteTypeFolioKey,
} from "../xml/build-dte-envelope";
import { escapeXml } from "../xml/escape-xml";
import {
  SII_ENVIO_DTE_ROOT_OPENING,
  SII_ENVIO_DTE_XML_DECLARATION,
} from "../xml/sii-envio-dte-header";
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
const XML_DECLARATION_ISO_8859_1 = SII_ENVIO_DTE_XML_DECLARATION;

export type FacturaSetDryRunOptions = {
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  outputDir?: string;
  realCertification?: { privateKeyPath: string; certificatePath: string };
  onStage?: (stage: FacturaSetDryRunStage) => void;
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
    importedCafs: ReadonlyArray<{
      typeCode: 33 | 56 | 61;
      rangeFrom: number;
      rangeTo: number;
      cafXml: string;
      privateKeyPem: string;
      publicKeyPem: string;
      sha256?: string;
    }>;
    manifestMetadata: Record<string, unknown>;
  }>;
};

export type FacturaSetDryRunStage =
  | "generation_config"
  | "certificate_material"
  | "caf_material_load"
  | "output_preflight"
  | "document_model"
  | "document_build"
  | "ted_frmt"
  | "dte_signature"
  | "document_signing"
  | "envelope_build"
  | "xsd_validation"
  | "output_write"
  | "manifest_build";

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
  cafCoverageUnique: "8/8";
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
  caseId: string;
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
  if (env.DTE_MODE === "production" || env.DTE_SII_ENV === "production")
    fail("stage=environment field=production");
  if (env.DTE_MODE !== "certification" || env.DTE_SII_ENV !== "certification") fail("DTE_MODE y DTE_SII_ENV deben ser certification para PRE-CAF 8");
  if (env.DTE_CAF_PATH) fail("stage=environment field=DTE_CAF_PATH");
  if (env.DTE_CAF_PRIVATE_KEY_PATH) fail("stage=environment field=DTE_CAF_PRIVATE_KEY_PATH");
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

export function assertCertificationFolioOrder(
  actualFolios: readonly number[],
  folios: Record<FacturaCertificationCaseId, number>,
): void {
  PRE_CAF_REQUIRED_CASE_ORDER.forEach((caseId, index) => {
    if (actualFolios[index] !== folios[caseId])
      fail("folio del caso no coincide con el plan");
  });
}

function assertReferences(
  drafts: TaxDocumentDraft[],
  folios: Record<FacturaCertificationCaseId, number>,
): void {
  const expectedOrder = [...PRE_CAF_REQUIRED_CASE_ORDER];
  assertCertificationFolioOrder(
    drafts.map((draft) => draft.folio),
    folios,
  );
  drafts.forEach((draft, index) => {
    const caseId = expectedOrder[index] ?? fail("documento sin caso esperado");
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
    "<DTE ",
    `<DTE xmlns="${SII_DTE_NAMESPACE}" `,
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

function mutateSignatureValueForReference(xml: string, referenceId: string): string {
  const signatures = [...xml.matchAll(/<Signature\b[^>]*>[\s\S]*?<\/Signature>/g)];
  const target = signatures.find((match) =>
    match[0].includes("URI=\"#" + referenceId + "\""),
  );
  if (!target || target.index === undefined)
    fail("firma objetivo no encontrada para Reference URI");
  const mutated = target[0].replace(
    /(<SignatureValue>\s*)([A-Za-z0-9+/])/,
    (_match, prefix: string, first: string) => prefix + (first === "A" ? "B" : "A"),
  );
  if (mutated === target[0]) fail("SignatureValue objetivo no pudo alterarse");
  return xml.slice(0, target.index) + mutated + xml.slice(target.index + target[0].length);
}

function verifyXmlsecReferences(
  xml: string,
  referenceIds: string[],
  certificatePath: string,
  outputDir: string,
  label: string,
): number {
  if (spawnSync("xmlsec1", ["--version"], { stdio: "ignore" }).status !== 0)
    fail("xmlsec1 no disponible para validar firmas fixture");
  const expectedCertificate = new X509Certificate(readFileSync(certificatePath))
    .raw.toString("base64");
  const path = join(outputDir, `.${label}-xmlsec.xml`);
  const persistedXml = xml.startsWith("<?xml")
    ? xml
    : `${XML_DECLARATION_ISO_8859_1}\n${xml}`;
  writeFileSync(path, encodeIso88591Strict(persistedXml));
  chmodSync(path, 0o600);
  try {
    return referenceIds.filter((referenceId) => {
      const signature = [...xml.matchAll(/<Signature\b[^>]*>[\s\S]*?<\/Signature>/g)]
        .find((match) => match[0].includes("URI=\"#" + referenceId + "\""));
      const embeddedCertificate = signature?.[0]
        .match(/<X509Certificate>([\s\S]*?)<\/X509Certificate>/)?.[1]
        .replace(/\s+/g, "");
      if (embeddedCertificate !== expectedCertificate) return false;
      const xpath = "//*[local-name()=\"Signature\"][.//*[local-name()=\"Reference\" and " +
        String.fromCharCode(64) + "URI=\"#" + referenceId + "\"]]";
      return spawnSync("xmlsec1", [
        "--verify",
        "--id-attr:ID",
        "Documento",
        "--id-attr:ID",
        "SetDTE",
        "--pubkey-cert-pem",
        certificatePath,
        "--node-xpath",
        xpath,
        path,
      ], { stdio: "ignore" }).status === 0;
    }).length;
  } finally {
    unlinkSync(path);
  }
}

function signingConfig(material: FixtureMaterial, target: string, mode: "certification" | "production" = "certification", tenantId = FIXTURE_TENANT_ID): RealXmlSigningConfig {
  return {
    tenantId,
    mode,
    signatureTarget: target,
    privateKeyPath: material.privateKeyPath,
    certificatePath: material.certPath,
    publicCertificatePath: material.certPath,
  };
}

function signAndBuildDocuments(drafts: TaxDocumentDraft[], xmlMaterial: FixtureMaterial, cafMaterial: FixtureMaterial, outputDir: string, overrides: FacturaSetDryRunOptions["overrides"] = {}, timestamp = FIXTURE_TIMESTAMP, onStage?: (stage: FacturaSetDryRunStage) => void, caseIds: readonly string[] = PRE_CAF_REQUIRED_CASE_ORDER, executionEnvironment: "certification" | "production" = "certification", tenantId = FIXTURE_TENANT_ID): SignedDocument[] {
  if (caseIds.length !== drafts.length || new Set(caseIds).size !== drafts.length) fail("case_ids_invalid");
  return drafts.map((draft, index) => {
    const caseId = caseIds[index] ?? fail("case_id_missing");
    const typeCode = getSiiDteTypeCode(draft.documentType);
    const legacyCaseId = caseId as FacturaCertificationCaseId;
    const cafTypeCode = overrides.cafTypeByCase?.[legacyCaseId] ?? typeCode;
    const range = overrides.cafRangeByCase?.[legacyCaseId] ?? fixtureRangeFor(typeCode);
    const coverage = (overrides.importedCafs ?? []).filter(
      (candidate) =>
        candidate.typeCode === typeCode &&
        candidate.rangeFrom <= draft.folio &&
        candidate.rangeTo >= draft.folio,
    );
    if (overrides.importedCafs && coverage.length !== 1)
      fail(`CAF coverage debe ser unica para ${typeCode}:${draft.folio}`);
    const imported =
      coverage[0] ??
      overrides.importedCafByType?.[typeCode as 33 | 56 | 61];
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
    onStage?.("document_build");
    const caf = parseCafRealControlledXml(cafXml, tenantId);
    validateCafForDraftOrThrow(caf, draft);
    onStage?.("ted_frmt");
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
      mode: executionEnvironment,
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
    const unsignedDteXml = withDteNamespace(buildDteDocumentoXmlLab(draft, { tedXml: ted.tedXml, documentSignedAt: timestamp, mode: executionEnvironment, preserveTedWhitespace: true }));
    const unsignedDocumentoXml = extractDocumentoForSignature(unsignedDteXml);
    onStage?.("dte_signature");
    const finalDteXml = `${XML_DECLARATION_ISO_8859_1}\n${unsignedDteXml}`;
    return { caseId, draft, unsignedDocumentoXml, signatureXml: "", dteXml: finalDteXml, cafXml, tedXml: ted.tedXml, ddXml: ted.ddXml, frmtXml: frmt.frmtXml, cafPublicKeyPem };
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

function buildEnvioXml(
  drafts: TaxDocumentDraft[],
  signedDocuments: SignedDocument[],
  material: FixtureMaterial,
  documentMaterial: FixtureMaterial,
  rutEnvia: string,
  outputDir: string,
  realCertification = false,
  tamperDocumentSignatureCase?: string,
  onStage?: (stage: FacturaSetDryRunStage) => void,
  setDteIdOverride?: string,
  validationLabel?: string,
  executionEnvironment: "certification" | "production" = "certification",
  tenantId = FIXTURE_TENANT_ID,
): string {
  const documentCount = signedDocuments.length;
  const documentKeys = signedDocuments.map((doc) => dteTypeFolioKey(doc.draft));
  const expectedKeys = new Set(documentKeys);
  if (
    documentKeys.length !== documentCount ||
    new Set(documentKeys).size !== documentCount ||
    documentKeys.some((key) => !expectedKeys.has(key))
  )
    fail("dte_type_folio_association");
  const perDocumentXml = Object.fromEntries(
    signedDocuments.map((doc) => [
      dteTypeFolioKey(doc.draft),
      {
        fullDteXml: doc.dteXml.replace(/^<\?xml[^>]*>\n/, ""),
      },
    ]),
  );
  if (
    Object.keys(perDocumentXml).length !== documentCount ||
    Object.keys(perDocumentXml).some((key) => !expectedKeys.has(key))
  )
    fail("dte_type_folio_association");
  const setDteId = setDteIdOverride ?? (realCertification
    ? `CitayaSetDTE-4959698-CERT`
    : `CitayaSetDTE-4959698-FIXTURE`);
  const setDteXml = buildDteSetDteXmlLab(drafts, {
    setDteId,
    rutEnvia,
    perDocumentXml,
    mode: executionEnvironment,
  }).replace("<SetDTE ", `<SetDTE xmlns="${SII_DTE_NAMESPACE}" `);
  const warning = realCertification
    ? ""
    : "<!-- FIXTURE SIN VALIDEZ TRIBUTARIA - NO ENVIAR AL SII -->\n";
  let unsignedEnvioXml = `${SII_ENVIO_DTE_ROOT_OPENING}\n${warning}${setDteXml}\n</EnvioDTE>`;
  for (const doc of signedDocuments) {
    const documentId = buildDteDocumentId(doc.draft);
    const signedContext = signXmlInFinalContextControlled({ xml: unsignedEnvioXml, referenceId: documentId, insertAfterXPath: `//*[local-name()='Documento' and @ID='${documentId}']` }, signingConfig(documentMaterial, documentId, executionEnvironment, tenantId));
    unsignedEnvioXml = signedContext.signedXml;
    doc.signatureXml = signedContext.signatureXml;
    const dteMatch = [...unsignedEnvioXml.matchAll(/<DTE\b[^>]*>[\s\S]*?<\/DTE>/g)].find((match) => match[0].includes("<Documento") && match[0].includes(`ID="${documentId}"`));
    if (!dteMatch) fail("dte_final_context_not_found");
    doc.dteXml = `${XML_DECLARATION_ISO_8859_1}\n${dteMatch[0]}`;
    validateXsd(doc.dteXml, "DTE_v10.xsd", `${doc.caseId}-dte-final-context`, outputDir);
  }
  const documentIds = signedDocuments.map((doc) => buildDteDocumentId(doc.draft));
  if (tamperDocumentSignatureCase) {
    const target = signedDocuments.find((doc) => doc.caseId === tamperDocumentSignatureCase);
    if (!target) fail("caso objetivo de firma no encontrado");
    unsignedEnvioXml = mutateSignatureValueForReference(
      unsignedEnvioXml,
      buildDteDocumentId(target.draft),
    );
  }
  for (const doc of signedDocuments) {
    const documentId = buildDteDocumentId(doc.draft);
    const dteMatch = [...unsignedEnvioXml.matchAll(/<DTE\b[^>]*>[\s\S]*?<\/DTE>/g)]
      .find((match) => match[0].includes(`ID="${documentId}"`));
    if (!dteMatch) fail("dte_final_context_not_found");
    doc.dteXml = `${XML_DECLARATION_ISO_8859_1}\n${dteMatch[0]}`;
  }
  const dteSignatureOk = verifyXmlsecReferences(
    unsignedEnvioXml,
    documentIds,
    material.certPath,
    outputDir,
    "dte-signatures",
  );
  if (dteSignatureOk !== documentCount)
    fail("firmas DTE fixture no verifican " + dteSignatureOk + "/" + documentCount);
  const signedEnvelope = signXmlInFinalContextControlled({ xml: unsignedEnvioXml, referenceId: setDteId, insertAfterXPath: `//*[local-name()='SetDTE' and @ID='${setDteId}']` }, signingConfig(material, setDteId, executionEnvironment, tenantId));
  const envioXml = `${XML_DECLARATION_ISO_8859_1}\n${signedEnvelope.signedXml}`;
  onStage?.("xsd_validation");
  validateXsd(
    envioXml,
    "EnvioDTE_v10.xsd",
    validationLabel ?? (realCertification
      ? "envio-dte-4959698-certification"
      : "envio-dte-4959698-fixture"),
    outputDir,
  );

  if (verifyXmlsecReferences(
    envioXml,
    [setDteId],
    material.certPath,
    outputDir,
    "setdte-signature",
  ) !== 1)
    fail("firma XMLDSig SetDTE fixture no verifica con xmlsec1");
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
  metadata: Record<string, unknown> = {},
  manifestFileName?: string,
): string {
  const documentCount = signedDocuments.length;
  const manifestPath = join(
    outputDir,
    manifestFileName ?? (realCertification
      ? "manifest-4959698-CERTIFICATION.json"
      : "manifest-4959698-FIXTURE-SIN-VALIDEZ.json"),
  );
  const cafAssignments = signedDocuments.map((doc) => {
    const type = getSiiDteTypeCode(doc.draft.documentType);
    const parsed = parseCafRealControlledXml(doc.cafXml, FIXTURE_TENANT_ID);
    return {
      dteTypeFolio: `${type}:${doc.draft.folio}`,
      type,
      folio: doc.draft.folio,
      range: `${parsed.rangeFrom}-${parsed.rangeTo}`,
      sha256: createHash("sha256").update(doc.cafXml).digest("hex"),
    };
  });
  if (new Set(cafAssignments.map((item) => item.dteTypeFolio)).size !== documentCount)
    fail("CAF assignments no cubren " + documentCount + " DTE unicos");
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
    ...(realCertification
      ? {
          cafCoverageUnique: String(documentCount) + "/" + documentCount,
          cafAssignments,
          cafHashes: Array.from(
            new Map(
              cafAssignments.map((item) => [
                `${item.type}:${item.range}:${item.sha256}`,
                { type: item.type, range: item.range, sha256: item.sha256 },
              ]),
            ).values(),
          ),
        }
      : {
          cafFixtures: signedDocuments.map((doc) => ({
            caseId: doc.caseId,
            sha256: createHash("sha256").update(doc.cafXml).digest("hex"),
          })),
        }),
    ...metadata,
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
  options.onStage?.("generation_config");
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? process.cwd();
  assertCertificationEnvironment(env);
  if (options.overrides?.realCafPath)
    fail("rutas CAF reales bloqueadas para PRE-CAF 8");
  const realCertification = Boolean(options.realCertification);
  if (
    realCertification &&
    !options.overrides?.importedCafs &&
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

  options.onStage?.("output_preflight");
  const outputDir = ensureOutputDir(
    options.outputDir ??
      env.DTE_FACTURA_SET_DRY_RUN_OUTPUT_DIR ??
      FIXTURE_OUTPUT_DIR,
  );
  options.onStage?.("document_model");
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

  options.onStage?.("caf_material_load");
  const xmlMaterial = options.realCertification
    ? loadExternalSigningMaterial(options.realCertification)
    : createSelfSignedFixture("citaya-pre-caf-8-xml");
  const cafMaterial = realCertification
    ? xmlMaterial
    : createSelfSignedFixture("citaya-pre-caf-8-caf", 768);
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
      options.onStage,
    );
    options.onStage?.("document_signing");
    const frmtOk = signed.filter((doc) =>
      verifyFrmt(doc.ddXml, doc.frmtXml, doc.cafPublicKeyPem),
    ).length;
    if (frmtOk !== 8) fail("FRMT fixture no verifica 8/8");
    options.onStage?.("envelope_build");
    const envioXml = buildEnvioXml(
      drafts,
      signed,
      xmlMaterial,
      documentSigningMaterial,
      loaded.input.issuer?.rutEnvia ?? "",
      outputDir,
      realCertification,
      options.overrides?.tamperDocumentSignatureCase,
      options.onStage,
    );
    assertNoPendingFolios(envioXml);
    const writtenPaths: string[] = [];
    options.onStage?.("output_write");
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
    options.onStage?.("manifest_build");
    const manifestPath = writeSetManifest(
      outputDir,
      writtenPaths,
      signed,
      realCertification,
      generationTimestamp,
      options.overrides?.manifestMetadata,
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
      cafCoverageUnique: "8/8",
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


export type ControlledCertificationSetOptions = {
  executionEnvironment?: "certification" | "production";
  tenantId?: string;
  env?: NodeJS.ProcessEnv;
  outputDir: string;
  signingMaterial: { privateKeyPath: string; certificatePath: string };
  drafts: TaxDocumentDraft[];
  caseIds: string[];
  rutEnvia: string;
  importedCafs: NonNullable<NonNullable<FacturaSetDryRunOptions["overrides"]>["importedCafs"]>;
  setDteId: string;
  envelopeFileName: string;
  manifestFileName: string;
  generationTimestamp: string;
  manifestMetadata: Record<string, unknown>;
  onStage?: (stage: FacturaSetDryRunStage) => void;
};

export type ControlledCertificationSetResult = {
  environment: "certification" | "production";
  documents: number;
  type33: number;
  type56: number;
  type61: number;
  dteXsd: string;
  envioDteXsd: "valid";
  tedFrmt: string;
  dteSignatures: string;
  envelopeSignature: "valid";
  references: "valid";
  totals: "valid";
  cafCoverageUnique: string;
  encoding: "ISO-8859-1";
  bom: "absent";
  outputDir: string;
  envelopePath: string;
  envelopeSha256: string;
  manifestPath: string;
  siiContacted: false;
};

export function runControlledCertificationSet(
  options: ControlledCertificationSetOptions,
): ControlledCertificationSetResult {
  const env = options.env ?? process.env;
  const executionEnvironment = options.executionEnvironment ?? "certification";
  if (executionEnvironment === "certification") assertCertificationEnvironment(env);
  else if (env.DTE_MODE !== "production" || env.DTE_SII_ENV !== "production" || env.DTE_SIGNING_MODE !== "production" || env.DTE_PRODUCTION_ENABLED !== "true") fail("production_environment_blocked");
  const count = options.drafts.length;
  if (
    count < 1 ||
    options.caseIds.length !== count ||
    new Set(options.caseIds).size !== count ||
    new Set(options.drafts.map((draft) => dteTypeFolioKey(draft))).size !== count ||
    !/^[A-Za-z][A-Za-z0-9._-]{7,79}$/.test(options.setDteId) ||
    !/^[A-Za-z0-9._-]+\.xml$/.test(options.envelopeFileName) ||
    !/^[A-Za-z0-9._-]+\.json$/.test(options.manifestFileName)
  ) fail("controlled_set_contract");
  for (const draft of options.drafts) {
    if (
      draft.totalAmount !==
      (draft.netAmount ?? 0) + (draft.exemptAmount ?? 0) + (draft.taxAmount ?? 0)
    ) fail("total DTE no cuadra");
    if (draft.lines.length < 1 || draft.lines.some((line) => line.amount < 0))
      fail("detalle DTE invalido");
  }
  const type33 = options.drafts.filter((draft) => getSiiDteTypeCode(draft.documentType) === 33).length;
  const type56 = options.drafts.filter((draft) => getSiiDteTypeCode(draft.documentType) === 56).length;
  const type61 = options.drafts.filter((draft) => getSiiDteTypeCode(draft.documentType) === 61).length;
  if (type33 + type56 + type61 !== count) fail("tipo DTE no soportado");
  const outputDir = ensureOutputDir(options.outputDir);
  const xmlMaterial = loadExternalSigningMaterial(options.signingMaterial);
  const overrides: FacturaSetDryRunOptions["overrides"] = {
    importedCafs: options.importedCafs,
    manifestMetadata: options.manifestMetadata,
  };
  try {
    const signed = signAndBuildDocuments(
      options.drafts,
      xmlMaterial,
      xmlMaterial,
      outputDir,
      overrides,
      options.generationTimestamp,
      options.onStage,
      options.caseIds,
      executionEnvironment,
      options.tenantId ?? options.drafts[0]?.tenantId ?? FIXTURE_TENANT_ID,
    );
    const frmtOk = signed.filter((doc) => verifyFrmt(doc.ddXml, doc.frmtXml, doc.cafPublicKeyPem)).length;
    if (frmtOk !== count) fail("FRMT no verifica " + frmtOk + "/" + count);
    const envioXml = buildEnvioXml(
      options.drafts,
      signed,
      xmlMaterial,
      xmlMaterial,
      options.rutEnvia,
      outputDir,
      true,
      undefined,
      options.onStage,
      options.setDteId,
      executionEnvironment === "production" ? "envio-dte-controlled-production" : "envio-dte-controlled-certification",
      executionEnvironment,
      options.tenantId ?? options.drafts[0]?.tenantId ?? FIXTURE_TENANT_ID,
    );
    assertNoPendingFolios(envioXml);
    const writtenPaths: string[] = [];
    signed.forEach((doc) => {
      const path = join(outputDir, doc.caseId + "-DTE-CERTIFICATION.xml");
      writeSafeXml(path, doc.dteXml);
      writtenPaths.push(path);
    });
    const envelopePath = join(outputDir, options.envelopeFileName);
    writeSafeXml(envelopePath, envioXml);
    writtenPaths.push(envelopePath);
    const manifestPath = writeSetManifest(
      outputDir,
      writtenPaths,
      signed,
      true,
      options.generationTimestamp,
      options.manifestMetadata,
      options.manifestFileName,
    );
    return {
      environment: executionEnvironment,
      documents: count,
      type33,
      type56,
      type61,
      dteXsd: count + "/" + count,
      envioDteXsd: "valid",
      tedFrmt: count + "/" + count,
      dteSignatures: count + "/" + count,
      envelopeSignature: "valid",
      references: "valid",
      totals: "valid",
      cafCoverageUnique: count + "/" + count,
      encoding: "ISO-8859-1",
      bom: "absent",
      outputDir,
      envelopePath,
      envelopeSha256: sha256File(envelopePath),
      manifestPath,
      siiContacted: false,
    };
  } finally {
    if (xmlMaterial.root) rmSync(xmlMaterial.root, { recursive: true, force: true });
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
    `cafCoverageUnique=${result.cafCoverageUnique}`,
    `realCaf=${result.realCaf}`,
    `realFolios=${result.realFolios}`,
    `siiContacted=${result.siiContacted}`,
    `readyToDownloadCaf=${result.readyToDownloadCaf}`,
  ].join("\n");
}

export function safeDryRunFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
