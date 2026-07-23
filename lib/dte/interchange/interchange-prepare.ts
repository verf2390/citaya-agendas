import {
  createHash,
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { DOMParser } from "@xmldom/xmldom";

import { validateRut } from "../rut";
import {
  getRealXmlSigningConfigFromEnv,
  signXmlInFinalContextControlled,
} from "../signing/sign-xml.real";
import { escapeXml } from "../xml/escape-xml";
import { encodeIso88591Strict } from "../certification/factura-set-dry-run";

const SII_NS = "http://www.sii.cl/SiiDte";
const XMLDSIG_NS = "http://www.w3.org/2000/09/xmldsig#";
export const INTERCHANGE_INPUT_PATH =
  "/home/verf/secure/dte-lab/intercambio/4970282/input/ENVIO_DTE_4970282.xml";
export const INTERCHANGE_OUTPUT_DIR =
  "/home/verf/secure/dte-lab/intercambio/4970282/output";
export const INTERCHANGE_INPUT_SHA256 =
  "43a3ad2248cbf76f6a74ae723e75502d1e0d41f41a8a402fe846ca6d77f09b6d";
export const INTERCHANGE_INPUT_BYTES = 12_562;
export const INTERCHANGE_CONFIRMATION =
  "PREPARE_INTERCHANGE_4970282_43a3ad2248cbf76f6a74ae723e75502d1e0d41f41a8a402fe846ca6d77f09b6d";
export const RECEIPT_DECLARATION =
  "El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la letra b) del Art. 4, y la letra c) del Art. 5 de la Ley 19.983, acredita que la entrega de mercaderias o servicio(s) prestado(s) ha(n) sido recibido(s).";

const RESPONSE_FILE = "respuesta-recepcion.xml";
const RECEIPT_FILE = "recibo-mercaderias-servicios.xml";
const COMMERCIAL_FILE = "resultado-comercial.xml";
const MANIFEST_FILE = "manifest-intercambio-4970282.json";
const OFFICIAL_RESPONSE_XSD = resolve(
  "docs/dte-sii/xsd/interchange/RespuestaEnvioDTE_v10.xsd",
);
const OFFICIAL_RECEIPT_XSD = resolve(
  "docs/dte-sii/xsd/receipts/EnvioRecibos_v10.xsd",
);
const OFFICIAL_ENVIO_DTE_XSD = resolve("docs/dte-sii/xsd/EnvioDTE_v10.xsd");

export type InterchangeDocument = {
  typeCode: 33;
  folio: number;
  issueDate: string;
  issuerRut: string;
  receiverRut: string;
  total: number;
  receiverMatchesEnvelope: boolean;
};

export type InterchangeModel = {
  inputFileName: string;
  setDteId: string;
  outerDigest: string;
  envelopeIssuerRut: string;
  envelopeReceiverRut: string;
  responseId: number;
  generatedAt: string;
  signerRut: string;
  recinto: string;
  documents: [InterchangeDocument, InterchangeDocument];
};

export type InterchangeGenerated = {
  receptionXml: string;
  receiptXml: string;
  commercialXml: string;
  ids: {
    reception: string;
    receiptSet: string;
    receipt: string;
    commercial: string;
  };
};

export type InterchangeValidation = {
  receptionDetails: number;
  receptionCorrectDocumentStatus: 0;
  receptionWrongReceiverStatus: 3;
  receptionXsd: "valid";
  receptionXmlsec1: "valid";
  receiptDetails: number;
  receiptContainsFolio52919: boolean;
  receiptContainsFolio52920: boolean;
  receiptIndividualXmlsec1: "1/1";
  receiptOuterXmlsec1: true;
  receiptXsd: "valid";
  commercialDetails: number;
  commercialAcceptedFolio52919: boolean;
  commercialRejectedFolio52920: boolean;
  commercialXsd: "valid";
  commercialXmlsec1: "valid";
  responseSectionsMutuallyExclusive: boolean;
  referencesValid: boolean;
  encoding: "ISO-8859-1";
  bom: "absent";
};

export type InterchangePrepareResult = InterchangeValidation & {
  inputSha256Match: true;
  inputBytesUnchanged: true;
  inputEnvioDteXsd: "valid";
  inputOuterXmlsecValid: true;
  inputDteXmlsecValid: "2/2";
  originalInputUnchanged: true;
  previousArtifactsUnchanged: true;
  previousRegistriesUnchanged: true;
  outputDir: string;
  files: Array<{ name: string; sha256: string }>;
  siiContacted: false;
  uploaded: false;
  listoParaCargaManual: true;
};

class InterchangeError extends Error {
  constructor(readonly field: string) {
    super(`INTERCHANGE_PREPARE_REJECTED:${field}`);
    this.name = "InterchangeError";
  }
}

function reject(field: string): never {
  throw new InterchangeError(/^[a-z0-9_.-]+$/i.test(field) ? field : "internal");
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) reject(name.toLowerCase());
  return value;
}

function assertExternalRegular600(path: string, repoRoot: string, field: string): string {
  const absolute = resolve(path);
  try {
    const stat = lstatSync(absolute);
    if (
      !isAbsolute(path) ||
      inside(repoRoot, absolute) ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      realpathSync(absolute) !== absolute ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600
    )
      reject(field);
  } catch (error) {
    if (error instanceof InterchangeError) throw error;
    reject(field);
  }
  return absolute;
}

function assertExternalDirectory700(path: string, repoRoot: string, field: string): string {
  const absolute = resolve(path);
  try {
    const stat = lstatSync(absolute);
    if (
      !isAbsolute(path) ||
      inside(repoRoot, absolute) ||
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(absolute) !== absolute ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700
    )
      reject(field);
  } catch (error) {
    if (error instanceof InterchangeError) throw error;
    reject(field);
  }
  return absolute;
}

function assertSigningPair(certPath: string, keyPath: string): void {
  try {
    const cert = createPublicKey(readFileSync(certPath, "utf8")).export({
      type: "spki",
      format: "der",
    });
    const key = createPublicKey(
      createPrivateKey(readFileSync(keyPath, "utf8")),
    ).export({ type: "spki", format: "der" });
    if (!Buffer.from(cert).equals(Buffer.from(key))) reject("signing_pair");
  } catch (error) {
    if (error instanceof InterchangeError) throw error;
    reject("signing_pair");
  }
}

function parseXml(xml: string): Document {
  const problems: string[] = [];
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") problems.push(message);
    },
  }).parseFromString(xml, "application/xml");
  if (problems.length || !document.documentElement) reject("xml_parse");
  return document;
}

function elements(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(SII_NS, name));
}

function one(parent: Document | Element, name: string): Element {
  const matches = elements(parent, name);
  if (matches.length !== 1) reject(`xml_${name.toLowerCase()}`);
  return matches[0];
}

function direct(parent: Element, name: string): Element {
  const matches = Array.from(parent.childNodes).filter(
    (node): node is Element =>
      node.nodeType === 1 &&
      (node as Element).namespaceURI === SII_NS &&
      (node as Element).localName === name,
  );
  if (matches.length !== 1) reject(`xml_${name.toLowerCase()}`);
  return matches[0];
}

function text(parent: Element, name: string): string {
  const value = direct(parent, name).textContent?.trim() ?? "";
  if (!value) reject(`xml_${name.toLowerCase()}`);
  return value;
}

function numeric(parent: Element, name: string): number {
  const raw = text(parent, name);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) reject(`xml_${name.toLowerCase()}`);
  return Number(raw);
}

function assertRut(value: string, field: string): string {
  if (!validateRut(value)) reject(field);
  return value;
}

function xmlsecAvailable(): boolean {
  return spawnSync("xmlsec1", ["--version"], { stdio: "ignore" }).status === 0;
}

function xmllintValidate(path: string, schema: string, field: string): void {
  const result = spawnSync("xmllint", ["--noout", "--schema", schema, path], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) reject(field);
}

function xmlsecVerify(input: {
  path: string;
  certificatePath: string;
  referenceId: string;
  idAttributes: Array<[string, string]>;
}): boolean {
  const args = ["--verify"];
  for (const [attribute, element] of input.idAttributes)
    args.push(`--id-attr:${attribute}`, element);
  args.push(
    "--pubkey-cert-pem",
    input.certificatePath,
    "--node-xpath",
    `//*[local-name()="Signature"][.//*[local-name()="Reference" and @URI="#${input.referenceId}"]]`,
    input.path,
  );
  return spawnSync("xmlsec1", args, { stdio: "ignore" }).status === 0;
}

function embeddedCertificateForReference(document: Document, referenceId: string): string {
  const signatures = Array.from(
    document.getElementsByTagNameNS(XMLDSIG_NS, "Signature"),
  );
  const signature = signatures.find((candidate) =>
    Array.from(candidate.getElementsByTagNameNS(XMLDSIG_NS, "Reference")).some(
      (reference) => reference.getAttribute("URI") === `#${referenceId}`,
    ),
  );
  if (!signature) reject("input_signature_reference");
  const certificates = signature.getElementsByTagNameNS(XMLDSIG_NS, "X509Certificate");
  if (certificates.length !== 1) reject("input_signature_certificate");
  const compact = (certificates[0].textContent ?? "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) reject("input_signature_certificate");
  try {
    new X509Certificate(Buffer.from(compact, "base64"));
  } catch {
    reject("input_signature_certificate");
  }
  return `-----BEGIN CERTIFICATE-----\n${compact.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END CERTIFICATE-----\n`;
}

function verifyInputSignatures(
  inputPath: string,
  inputBytes: Buffer,
  document: Document,
  documentIds: string[],
  setDteId: string,
): { individual: "2/2"; outer: true } {
  if (!xmlsecAvailable()) reject("xmlsec1_unavailable");
  const temp = mkdtempSync(join(tmpdir(), "citaya-interchange-input-cert-"));
  chmodSync(temp, 0o700);
  try {
    const source = inputBytes.toString("latin1");
    const literalDtes = [
      ...source.matchAll(/<DTE\b[^>]*>[\s\S]*?<\/DTE>/g),
    ].map((match) => match[0]);
    if (literalDtes.length !== documentIds.length) reject("input_dte_literal");
    for (const id of documentIds) {
      const certificatePath = join(temp, `${sha256(id).slice(0, 12)}.pem`);
      writeFileSync(certificatePath, embeddedCertificateForReference(document, id), {
        mode: 0o600,
      });
      chmodSync(certificatePath, 0o600);
      const literalDte = literalDtes.find((xml) => xml.includes(`ID="${id}"`));
      if (!literalDte) reject("input_dte_literal");
      const literalPath = join(temp, `${sha256(`dte:${id}`).slice(0, 12)}.xml`);
      writeFileSync(
        literalPath,
        encodeIso88591Strict(
          `<?xml version="1.0" encoding="ISO-8859-1"?>\n${literalDte}`,
        ),
        { mode: 0o600 },
      );
      chmodSync(literalPath, 0o600);
      if (
        !xmlsecVerify({
          path: literalPath,
          certificatePath,
          referenceId: id,
          idAttributes: [["ID", "Documento"]],
        })
      )
        reject("input_dte_xmlsec");
    }
    const outerCertificatePath = join(
      temp,
      `${sha256(setDteId).slice(0, 12)}.pem`,
    );
    writeFileSync(
      outerCertificatePath,
      embeddedCertificateForReference(document, setDteId),
      { mode: 0o600 },
    );
    chmodSync(outerCertificatePath, 0o600);
    if (
      !xmlsecVerify({
        path: inputPath,
        certificatePath: outerCertificatePath,
        referenceId: setDteId,
        idAttributes: [
          ["ID", "Documento"],
          ["ID", "SetDTE"],
        ],
      })
    )
      reject("input_outer_xmlsec");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return { individual: "2/2", outer: true };
}

function signatureDigest(document: Document, referenceId: string): string {
  const signatures = Array.from(
    document.getElementsByTagNameNS(XMLDSIG_NS, "Signature"),
  );
  const signature = signatures.find((candidate) =>
    Array.from(candidate.getElementsByTagNameNS(XMLDSIG_NS, "Reference")).some(
      (reference) => reference.getAttribute("URI") === `#${referenceId}`,
    ),
  );
  if (!signature) reject("input_outer_digest");
  const values = signature.getElementsByTagNameNS(XMLDSIG_NS, "DigestValue");
  if (values.length !== 1) reject("input_outer_digest");
  const value = (values[0].textContent ?? "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) reject("input_outer_digest");
  return value;
}

function parseInput(inputPath: string, bytes: Buffer): {
  modelBase: Omit<InterchangeModel, "generatedAt" | "signerRut" | "recinto">;
  document: Document;
  documentIds: string[];
} {
  if (bytes.length !== INTERCHANGE_INPUT_BYTES) reject("input_bytes");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) reject("input_bom");
  const xml = bytes.toString("latin1");
  if (!encodeIso88591Strict(xml).equals(bytes)) reject("input_encoding");
  if (!xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>'))
    reject("input_declaration");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) reject("input_doctype");
  const document = parseXml(xml);
  const root = document.documentElement;
  if (root.localName !== "EnvioDTE" || root.namespaceURI !== SII_NS)
    reject("input_root");
  const setDte = one(document, "SetDTE");
  const setDteId = setDte.getAttribute("ID");
  if (!setDteId || setDteId.length > 80) reject("input_set_id");
  const caratula = direct(setDte, "Caratula");
  const envelopeIssuerRut = assertRut(text(caratula, "RutEmisor"), "input_issuer_rut");
  const envelopeReceiverRut = assertRut(
    text(caratula, "RutReceptor"),
    "input_receiver_rut",
  );
  const dtes = Array.from(setDte.childNodes).filter(
    (node): node is Element =>
      node.nodeType === 1 &&
      (node as Element).namespaceURI === SII_NS &&
      (node as Element).localName === "DTE",
  );
  if (dtes.length !== 2) reject("input_dte_count");
  const documentIds: string[] = [];
  const parsed = dtes.map((dte): InterchangeDocument => {
    const documento = direct(dte, "Documento");
    const id = documento.getAttribute("ID");
    if (!id) reject("input_document_id");
    documentIds.push(id);
    const encabezado = direct(documento, "Encabezado");
    const idDoc = direct(encabezado, "IdDoc");
    const emisor = direct(encabezado, "Emisor");
    const receptor = direct(encabezado, "Receptor");
    const totales = direct(encabezado, "Totales");
    const typeCode = numeric(idDoc, "TipoDTE");
    if (typeCode !== 33) reject("input_dte_type");
    const issuerRut = assertRut(text(emisor, "RUTEmisor"), "input_document_issuer");
    const receiverRut = assertRut(
      text(receptor, "RUTRecep"),
      "input_document_receiver",
    );
    if (issuerRut !== envelopeIssuerRut) reject("input_document_issuer");
    return {
      typeCode: 33,
      folio: numeric(idDoc, "Folio"),
      issueDate: text(idDoc, "FchEmis"),
      issuerRut,
      receiverRut,
      total: numeric(totales, "MntTotal"),
      receiverMatchesEnvelope: receiverRut === envelopeReceiverRut,
    };
  });
  const byFolio = new Map(parsed.map((item) => [item.folio, item]));
  const correct = byFolio.get(52_919);
  const wrong = byFolio.get(52_920);
  if (
    !correct ||
    correct.issueDate !== "2026-07-23" ||
    !correct.receiverMatchesEnvelope ||
    !wrong ||
    wrong.issueDate !== "2013-06-21" ||
    wrong.receiverMatchesEnvelope
  )
    reject("input_semantics");
  return {
    modelBase: {
      inputFileName: basename(inputPath),
      setDteId,
      outerDigest: signatureDigest(document, setDteId),
      envelopeIssuerRut,
      envelopeReceiverRut,
      responseId: 4_970_282,
      documents: [correct, wrong],
    },
    document,
    documentIds,
  };
}

function caratula(model: InterchangeModel, details: number): string {
  return `<Caratula version="1.0"><RutResponde>${escapeXml(model.envelopeReceiverRut)}</RutResponde><RutRecibe>${escapeXml(model.envelopeIssuerRut)}</RutRecibe><IdRespuesta>${model.responseId}</IdRespuesta><NroDetalles>${details}</NroDetalles><TmstFirmaResp>${model.generatedAt}</TmstFirmaResp></Caratula>`;
}

function documentFields(document: InterchangeDocument): string {
  return `<TipoDTE>${document.typeCode}</TipoDTE><Folio>${document.folio}</Folio><FchEmis>${document.issueDate}</FchEmis><RUTEmisor>${escapeXml(document.issuerRut)}</RUTEmisor><RUTRecep>${escapeXml(document.receiverRut)}</RUTRecep><MntTotal>${document.total}</MntTotal>`;
}

function responseShell(id: string, body: string): string {
  return `<?xml version="1.0" encoding="ISO-8859-1"?>\n<RespuestaDTE xmlns="${SII_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${SII_NS} RespuestaEnvioDTE_v10.xsd" version="1.0"><Resultado ID="${id}">${body}</Resultado></RespuestaDTE>`;
}

export function buildInterchangeXmls(
  model: InterchangeModel,
  signing: { certificatePath: string; privateKeyPath: string },
): InterchangeGenerated {
  const correct = model.documents.find((item) => item.receiverMatchesEnvelope);
  const wrong = model.documents.find((item) => !item.receiverMatchesEnvelope);
  if (
    !correct ||
    !wrong ||
    correct.folio !== 52_919 ||
    wrong.folio !== 52_920 ||
    model.documents.length !== 2 ||
    !validateRut(model.signerRut) ||
    !model.recinto.trim() ||
    model.recinto.length > 80 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(model.generatedAt)
  )
    reject("model");
  const ids = {
    reception: `ResultadoRecepcion-${model.responseId}`,
    receiptSet: `SetRecibos-${model.responseId}`,
    receipt: `Recibo-T33-F${correct.folio}`,
    commercial: `ResultadoComercial-${model.responseId}`,
  };
  const signingConfig = (target: string) => ({
    ...getRealXmlSigningConfigFromEnv("interchange-4970282", target),
    mode: "certification" as const,
    certificatePath: signing.certificatePath,
    publicCertificatePath: signing.certificatePath,
    privateKeyPath: signing.privateKeyPath,
  });

  const receptionDetails = model.documents
    .map(
      (item) =>
        `<RecepcionDTE>${documentFields(item)}<EstadoRecepDTE>${item.receiverMatchesEnvelope ? 0 : 3}</EstadoRecepDTE><RecepDTEGlosa>${item.receiverMatchesEnvelope ? "DTE RECIBIDO OK" : "DTE NO RECIBIDO - RUT RECEPTOR NO CORRESPONDE"}</RecepDTEGlosa></RecepcionDTE>`,
    )
    .join("");
  const receptionUnsigned = responseShell(
    ids.reception,
    `${caratula(model, 1)}<RecepcionEnvio><NmbEnvio>${escapeXml(model.inputFileName)}</NmbEnvio><FchRecep>${model.generatedAt}</FchRecep><CodEnvio>${model.responseId}</CodEnvio><EnvioDTEID>${escapeXml(model.setDteId)}</EnvioDTEID><Digest>${model.outerDigest}</Digest><RutEmisor>${escapeXml(model.envelopeIssuerRut)}</RutEmisor><RutReceptor>${escapeXml(model.envelopeReceiverRut)}</RutReceptor><EstadoRecepEnv>0</EstadoRecepEnv><RecepEnvGlosa>ENVIO RECIBIDO CONFORME</RecepEnvGlosa><NroDTE>2</NroDTE>${receptionDetails}</RecepcionEnvio>`,
  );
  const receptionXml = signXmlInFinalContextControlled(
    {
      xml: receptionUnsigned,
      referenceId: ids.reception,
      insertAfterXPath: `//*[local-name()='Resultado' and @ID='${ids.reception}']`,
    },
    signingConfig(ids.reception),
  ).signedXml;

  const receiptUnsigned =
    `<?xml version="1.0" encoding="ISO-8859-1"?>\n<EnvioRecibos xmlns="${SII_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${SII_NS} EnvioRecibos_v10.xsd" version="1.0"><SetRecibos ID="${ids.receiptSet}"><Caratula version="1.0"><RutResponde>${escapeXml(model.envelopeReceiverRut)}</RutResponde><RutRecibe>${escapeXml(model.envelopeIssuerRut)}</RutRecibe><TmstFirmaEnv>${model.generatedAt}</TmstFirmaEnv></Caratula><Recibo version="1.0"><DocumentoRecibo ID="${ids.receipt}"><TipoDoc>${correct.typeCode}</TipoDoc><Folio>${correct.folio}</Folio><FchEmis>${correct.issueDate}</FchEmis><RUTEmisor>${escapeXml(correct.issuerRut)}</RUTEmisor><RUTRecep>${escapeXml(correct.receiverRut)}</RUTRecep><MntTotal>${correct.total}</MntTotal><Recinto>${escapeXml(model.recinto)}</Recinto><RutFirma>${escapeXml(model.signerRut)}</RutFirma><Declaracion>${escapeXml(RECEIPT_DECLARATION)}</Declaracion><TmstFirmaRecibo>${model.generatedAt}</TmstFirmaRecibo></DocumentoRecibo></Recibo></SetRecibos></EnvioRecibos>`;
  const receiptWithIndividual = signXmlInFinalContextControlled(
    {
      xml: receiptUnsigned,
      referenceId: ids.receipt,
      insertAfterXPath: `//*[local-name()='DocumentoRecibo' and @ID='${ids.receipt}']`,
    },
    signingConfig(ids.receipt),
  ).signedXml;
  const receiptXml = signXmlInFinalContextControlled(
    {
      xml: receiptWithIndividual,
      referenceId: ids.receiptSet,
      insertAfterXPath: `//*[local-name()='SetRecibos' and @ID='${ids.receiptSet}']`,
    },
    signingConfig(ids.receiptSet),
  ).signedXml;

  const commercialDetails = model.documents
    .map(
      (item) =>
        `<ResultadoDTE>${documentFields(item)}<CodEnvio>${model.responseId}</CodEnvio><EstadoDTE>${item.receiverMatchesEnvelope ? 0 : 2}</EstadoDTE><EstadoDTEGlosa>${item.receiverMatchesEnvelope ? "ACEPTADO OK" : "RECHAZADO - RUT RECEPTOR NO CORRESPONDE"}</EstadoDTEGlosa></ResultadoDTE>`,
    )
    .join("");
  const commercialUnsigned = responseShell(
    ids.commercial,
    `${caratula(model, 2)}${commercialDetails}`,
  );
  const commercialXml = signXmlInFinalContextControlled(
    {
      xml: commercialUnsigned,
      referenceId: ids.commercial,
      insertAfterXPath: `//*[local-name()='Resultado' and @ID='${ids.commercial}']`,
    },
    signingConfig(ids.commercial),
  ).signedXml;

  return { receptionXml, receiptXml, commercialXml, ids };
}

function persistXml(path: string, xml: string): Buffer {
  const bytes = encodeIso88591Strict(xml);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) reject("output_bom");
  writeFileSync(path, bytes, { mode: 0o600 });
  chmodSync(path, 0o600);
  return bytes;
}

function countIn(xml: string, name: string): number {
  return elements(parseXml(xml), name).length;
}

export function validateInterchangeArtifacts(input: {
  generated: InterchangeGenerated;
  directory: string;
  certificatePath: string;
}): InterchangeValidation {
  const receptionPath = join(input.directory, RESPONSE_FILE);
  const receiptPath = join(input.directory, RECEIPT_FILE);
  const commercialPath = join(input.directory, COMMERCIAL_FILE);
  const receptionBytes = persistXml(receptionPath, input.generated.receptionXml);
  const receiptBytes = persistXml(receiptPath, input.generated.receiptXml);
  const commercialBytes = persistXml(commercialPath, input.generated.commercialXml);
  xmllintValidate(receptionPath, OFFICIAL_RESPONSE_XSD, "reception_xsd");
  xmllintValidate(receiptPath, OFFICIAL_RECEIPT_XSD, "receipt_xsd");
  xmllintValidate(commercialPath, OFFICIAL_RESPONSE_XSD, "commercial_xsd");
  if (!xmlsecAvailable()) reject("xmlsec1_unavailable");
  const responseIds: Array<[string, string]> = [
    [input.generated.ids.reception, receptionPath],
    [input.generated.ids.commercial, commercialPath],
  ];
  for (const [id, path] of responseIds)
    if (
      !xmlsecVerify({
        path,
        certificatePath: input.certificatePath,
        referenceId: id,
        idAttributes: [["ID", "Resultado"]],
      })
    )
      reject("response_xmlsec");
  for (const id of [
    input.generated.ids.receipt,
    input.generated.ids.receiptSet,
  ])
    if (
      !xmlsecVerify({
        path: receiptPath,
        certificatePath: input.certificatePath,
        referenceId: id,
        idAttributes: [
          ["ID", "DocumentoRecibo"],
          ["ID", "SetRecibos"],
        ],
      })
    )
      reject("receipt_xmlsec");

  const reception = input.generated.receptionXml;
  const receipt = input.generated.receiptXml;
  const commercial = input.generated.commercialXml;
  const mutuallyExclusive =
    countIn(reception, "RecepcionEnvio") === 1 &&
    countIn(reception, "ResultadoDTE") === 0 &&
    countIn(commercial, "RecepcionEnvio") === 0 &&
    countIn(commercial, "ResultadoDTE") === 2;
  const referencesValid =
    [reception, receipt, commercial].every((xml) => {
      const document = parseXml(xml);
      const ids = new Set(
        Array.from(document.getElementsByTagName("*"))
          .map((element) => element.getAttribute("ID"))
          .filter(Boolean),
      );
      return Array.from(document.getElementsByTagNameNS(XMLDSIG_NS, "Reference")).every(
        (reference) => ids.has((reference.getAttribute("URI") ?? "").replace(/^#/, "")),
      );
    });
  const allBytes = [receptionBytes, receiptBytes, commercialBytes];
  const encoding = allBytes.every((bytes, index) =>
    encodeIso88591Strict([reception, receipt, commercial][index]).equals(bytes),
  );
  if (!mutuallyExclusive || !referencesValid || !encoding) reject("output_semantics");
  return {
    receptionDetails: countIn(reception, "RecepcionDTE"),
    receptionCorrectDocumentStatus: 0,
    receptionWrongReceiverStatus: 3,
    receptionXsd: "valid",
    receptionXmlsec1: "valid",
    receiptDetails: countIn(receipt, "Recibo"),
    receiptContainsFolio52919: /<Folio>52919<\/Folio>/.test(receipt),
    receiptContainsFolio52920: /<Folio>52920<\/Folio>/.test(receipt),
    receiptIndividualXmlsec1: "1/1",
    receiptOuterXmlsec1: true,
    receiptXsd: "valid",
    commercialDetails: countIn(commercial, "ResultadoDTE"),
    commercialAcceptedFolio52919:
      /<Folio>52919<\/Folio>[\s\S]*?<EstadoDTE>0<\/EstadoDTE>/.test(commercial),
    commercialRejectedFolio52920:
      /<Folio>52920<\/Folio>[\s\S]*?<EstadoDTE>2<\/EstadoDTE>/.test(commercial),
    commercialXsd: "valid",
    commercialXmlsec1: "valid",
    responseSectionsMutuallyExclusive: true,
    referencesValid: true,
    encoding: "ISO-8859-1",
    bom: "absent",
  };
}

type TreeSnapshot = {
  fingerprint: string;
  entries: Array<{ path: string; kind: "file" | "directory" | "symlink"; sha256?: string }>;
};

function snapshotTree(root: string, excluded: string): TreeSnapshot {
  const entries: TreeSnapshot["entries"] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (
        path === excluded ||
        inside(excluded, path) ||
        path.startsWith(excluded + ".tmp-")
      )
        continue;
      const stat = lstatSync(path);
      const relativePath = relative(root, path);
      if (stat.isSymbolicLink()) entries.push({ path: relativePath, kind: "symlink" });
      else if (stat.isDirectory()) {
        entries.push({ path: relativePath, kind: "directory" });
        walk(path);
      } else if (stat.isFile())
        entries.push({ path: relativePath, kind: "file", sha256: sha256(readFileSync(path)) });
    }
  };
  walk(root);
  return { fingerprint: sha256(JSON.stringify(entries)), entries };
}

function loadRecinto(path: string): string {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      issuer?: { direccionOrigen?: unknown };
    };
    const recinto = String(parsed.issuer?.direccionOrigen ?? "").trim();
    if (!recinto || recinto.length > 80) reject("recinto");
    return recinto;
  } catch (error) {
    if (error instanceof InterchangeError) throw error;
    reject("recinto");
  }
}

function validateEnv(env: NodeJS.ProcessEnv): void {
  const exact: Record<string, string> = {
    DTE_MODE: "certification",
    DTE_SII_ENV: "certification",
    DTE_SII_LIVE_AUTH: "false",
    DTE_SII_ENABLE_SUBMIT: "false",
    DTE_SII_ENABLE_STATUS: "false",
  };
  for (const [name, expected] of Object.entries(exact))
    if (String(env[name] ?? "").trim() !== expected) reject(name.toLowerCase());
  if (String(env.NODE_ENV ?? "").trim() === "production") reject("node_env");
  if (required(env, "DTE_INTERCHANGE_PREPARE_CONFIRM") !== INTERCHANGE_CONFIRMATION)
    reject("confirmation");
  if (resolve(required(env, "DTE_INTERCHANGE_INPUT_PATH")) !== INTERCHANGE_INPUT_PATH)
    reject("input_path");
  if (
    required(env, "DTE_INTERCHANGE_INPUT_SHA256").toLowerCase() !==
    INTERCHANGE_INPUT_SHA256
  )
    reject("input_sha256");
  if (resolve(required(env, "DTE_INTERCHANGE_OUTPUT_DIR")) !== INTERCHANGE_OUTPUT_DIR)
    reject("output_path");
}

export function prepareInterchange(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): InterchangePrepareResult {
  validateEnv(env);
  const inputPath = assertExternalRegular600(
    required(env, "DTE_INTERCHANGE_INPUT_PATH"),
    repoRoot,
    "input_file",
  );
  const certPath = assertExternalRegular600(
    required(env, "DTE_CERT_PATH"),
    repoRoot,
    "certificate",
  );
  const keyPath = assertExternalRegular600(
    required(env, "DTE_PRIVATE_KEY_PATH"),
    repoRoot,
    "private_key",
  );
  const configPath = assertExternalRegular600(
    required(env, "DTE_FACTURA_PRE_CAF_INPUT_PATH"),
    repoRoot,
    "external_config",
  );
  assertSigningPair(certPath, keyPath);
  const signerRut = assertRut(required(env, "SII_RUT_USUARIO"), "signer_rut");
  const generatedAt = required(env, "DTE_INTERCHANGE_GENERATED_AT");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(generatedAt))
    reject("generated_at");
  const output = resolve(required(env, "DTE_INTERCHANGE_OUTPUT_DIR"));
  const secureRoot = assertExternalDirectory700(
    dirname(dirname(dirname(output))),
    repoRoot,
    "secure_root",
  );
  const outputParent = assertExternalDirectory700(dirname(output), repoRoot, "output_parent");
  if (dirname(output) !== outputParent) reject("output_parent");
  try {
    lstatSync(output);
    reject("output_exists");
  } catch (error) {
    if (error instanceof InterchangeError) throw error;
  }
  const inputBefore = readFileSync(inputPath);
  if (sha256(inputBefore) !== INTERCHANGE_INPUT_SHA256) reject("input_sha256");
  const previous = snapshotTree(secureRoot, output);
  const parsed = parseInput(inputPath, inputBefore);
  xmllintValidate(inputPath, OFFICIAL_ENVIO_DTE_XSD, "input_xsd");
  const inputSignatures = verifyInputSignatures(
    inputPath,
    inputBefore,
    parsed.document,
    parsed.documentIds,
    parsed.modelBase.setDteId,
  );
  const staging = `${output}.tmp-${process.pid}`;
  mkdirSync(staging, { mode: 0o700 });
  chmodSync(staging, 0o700);
  try {
    const generated = buildInterchangeXmls(
      {
        ...parsed.modelBase,
        generatedAt,
        signerRut,
        recinto: loadRecinto(configPath),
      },
      { certificatePath: certPath, privateKeyPath: keyPath },
    );
    const validation = validateInterchangeArtifacts({
      generated,
      directory: staging,
      certificatePath: certPath,
    });
    if (
      validation.receptionDetails !== 2 ||
      validation.receiptDetails !== 1 ||
      !validation.receiptContainsFolio52919 ||
      validation.receiptContainsFolio52920 ||
      validation.commercialDetails !== 2 ||
      !validation.commercialAcceptedFolio52919 ||
      !validation.commercialRejectedFolio52920
    )
      reject("gate");
    const inputAfter = readFileSync(inputPath);
    if (!inputAfter.equals(inputBefore)) reject("input_changed");
    const current = snapshotTree(secureRoot, output);
    if (current.fingerprint !== previous.fingerprint) reject("previous_state_changed");
    const files = [RESPONSE_FILE, RECEIPT_FILE, COMMERCIAL_FILE].map((name) => ({
      name,
      sha256: sha256(readFileSync(join(staging, name))),
    }));
    const manifest = {
      schemaVersion: 1,
      artifactKind: "sii_interchange_information",
      exchangeNumber: 4_970_282,
      generatedAt,
      input: {
        name: basename(inputPath),
        sha256: INTERCHANGE_INPUT_SHA256,
        setDteId: parsed.modelBase.setDteId,
        documents: 2,
        xsd: "valid",
        outerXmlsec1: true,
        individualXmlsec1: "2/2",
      },
      responses: [
        {
          name: RESPONSE_FILE,
          sha256: files[0].sha256,
          type: "RespuestaDTE.RecepcionEnvio",
          id: generated.ids.reception,
          referencesSetDteId: parsed.modelBase.setDteId,
          details: 2,
          xsd: "valid",
          xmlsec1: "valid",
          encoding: "ISO-8859-1",
          bom: "absent",
        },
        {
          name: RECEIPT_FILE,
          sha256: files[1].sha256,
          type: "EnvioRecibos",
          id: generated.ids.receiptSet,
          receiptIds: [generated.ids.receipt],
          details: 1,
          xsd: "valid",
          individualXmlsec1: "1/1",
          outerXmlsec1: true,
          encoding: "ISO-8859-1",
          bom: "absent",
        },
        {
          name: COMMERCIAL_FILE,
          sha256: files[2].sha256,
          type: "RespuestaDTE.ResultadoDTE",
          id: generated.ids.commercial,
          details: 2,
          xsd: "valid",
          xmlsec1: "valid",
          encoding: "ISO-8859-1",
          bom: "absent",
        },
      ],
      responseSectionsMutuallyExclusive: true,
      referencesValid: true,
      previousStateSnapshotSha256: previous.fingerprint,
      previousArtifactsUnchanged: true,
      previousRegistriesUnchanged: true,
      siiContacted: false,
      uploaded: false,
    };
    writeFileSync(join(staging, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    chmodSync(join(staging, MANIFEST_FILE), 0o600);
    renameSync(staging, output);
    if (snapshotTree(secureRoot, output).fingerprint !== previous.fingerprint)
      reject("previous_state_changed");
    return {
      inputSha256Match: true,
      inputBytesUnchanged: true,
      inputEnvioDteXsd: "valid",
      inputOuterXmlsecValid: inputSignatures.outer,
      inputDteXmlsecValid: inputSignatures.individual,
      ...validation,
      originalInputUnchanged: true,
      previousArtifactsUnchanged: true,
      previousRegistriesUnchanged: true,
      outputDir: output,
      files,
      siiContacted: false,
      uploaded: false,
      listoParaCargaManual: true,
    };
  } catch (error) {
    try {
      const stat = lstatSync(staging);
      if (stat.isDirectory() && !stat.isSymbolicLink()) rmSync(staging, { recursive: true });
    } catch {
      // No hay staging recuperable.
    }
    throw error;
  }
}

export function formatInterchangePrepareResult(result: InterchangePrepareResult): string {
  return [
    `inputSha256Match=${result.inputSha256Match}`,
    `inputBytesUnchanged=${result.inputBytesUnchanged}`,
    `inputEnvioDteXsd=${result.inputEnvioDteXsd}`,
    `inputOuterXmlsecValid=${result.inputOuterXmlsecValid}`,
    `inputDteXmlsecValid=${result.inputDteXmlsecValid}`,
    `receptionDetails=${result.receptionDetails}`,
    `receptionCorrectDocumentStatus=${result.receptionCorrectDocumentStatus}`,
    `receptionWrongReceiverStatus=${result.receptionWrongReceiverStatus}`,
    `receptionXsd=${result.receptionXsd}`,
    `receptionXmlsec1=${result.receptionXmlsec1}`,
    `receiptDetails=${result.receiptDetails}`,
    `receiptContainsFolio52919=${result.receiptContainsFolio52919}`,
    `receiptContainsFolio52920=${result.receiptContainsFolio52920}`,
    `receiptIndividualXmlsec1=${result.receiptIndividualXmlsec1}`,
    `receiptOuterXmlsec1=${result.receiptOuterXmlsec1}`,
    `receiptXsd=${result.receiptXsd}`,
    `commercialDetails=${result.commercialDetails}`,
    `commercialAcceptedFolio52919=${result.commercialAcceptedFolio52919}`,
    `commercialRejectedFolio52920=${result.commercialRejectedFolio52920}`,
    `commercialXsd=${result.commercialXsd}`,
    `commercialXmlsec1=${result.commercialXmlsec1}`,
    `responseSectionsMutuallyExclusive=${result.responseSectionsMutuallyExclusive}`,
    `referencesValid=${result.referencesValid}`,
    `encoding=${result.encoding}`,
    `bom=${result.bom}`,
    `originalInputUnchanged=${result.originalInputUnchanged}`,
    `previousArtifactsUnchanged=${result.previousArtifactsUnchanged}`,
    `previousRegistriesUnchanged=${result.previousRegistriesUnchanged}`,
    ...result.files.map((file) => `file.${file.name}.sha256=${file.sha256}`),
    `outputDir=${result.outputDir}`,
    `siiContacted=${result.siiContacted}`,
    `uploaded=${result.uploaded}`,
    `listoParaCargaManual=${result.listoParaCargaManual}`,
  ].join("\n");
}
