import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
  createSign,
  generateKeyPairSync,
} from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runControlledCertificationSet } from "../certification/factura-set-dry-run";
import { verifyPersistedXmlsecSignatures } from "../certification/factura-certification-set-submit";
import type { TaxDocumentDraft } from "../types";
import { buildDteDocumentoXmlLab } from "../xml/build-dte-envelope";

const ISSUER_RUT = "76086428-5";

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureCaf() {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const jwk = createPublicKey(keys.publicKey).export({ format: "jwk" }) as {
    n?: string;
    e?: string;
  };
  const modulus = Buffer.from(jwk.n ?? "", "base64url").toString("base64");
  const exponent = Buffer.from(jwk.e ?? "", "base64url").toString("base64");
  const da = `<DA><RE>${ISSUER_RUT}</RE><RS>EMISOR ANONIMIZADO</RS><TD>33</TD><RNG><D>1</D><H>20</H></RNG><FA>2026-07-20</FA><RSAPK><M>${modulus}</M><E>${exponent}</E></RSAPK><IDK>100</IDK></DA>`;
  const signer = createSign("RSA-SHA1");
  signer.update(Buffer.from(da, "latin1"));
  const cafXml = `<CAF version="1.0">${da}<FRMA algoritmo="SHA1withRSA">${signer.sign(keys.privateKey, "base64")}</FRMA></CAF>`;
  return {
    typeCode: 33 as const,
    rangeFrom: 1,
    rangeTo: 20,
    cafXml,
    privateKeyPem: keys.privateKey,
    publicKeyPem: keys.publicKey,
    sha256: sha256(cafXml),
  };
}

test("net and MntBruto type 33 candidates require Acteco and pass every offline gate", () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-folio8-regression-"));
  const cert = join(root, "certificate.pem");
  const key = join(root, "private-key.pem");
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-keyout", key,
      "-out", cert, "-nodes", "-days", "2",
      "-subj", `/CN=Anonymized DTE/serialNumber=${ISSUER_RUT}/C=CL`,
    ], { stdio: "ignore" });
    chmodSync(cert, 0o600);
    chmodSync(key, 0o600);

    const draft: TaxDocumentDraft = {
      tenantId: "anonymous-production-regression",
      issueMode: "citaya_own_dte",
      documentType: "factura_afecta",
      status: "draft",
      folio: 8,
      issueDate: "2026-07-29",
      issuer: {
        tenantId: "anonymous-production-regression",
        rut: ISSUER_RUT,
        legalName: "EMISOR ANONIMIZADO SPA",
        businessActivity: "SERVICIOS DIGITALES",
        businessActivityCode: "620900",
        address: "DIRECCION ANONIMIZADA 100",
        commune: "COQUIMBO",
        city: "COQUIMBO",
        siiResolutionDate: "2014-08-22",
        siiResolutionNumber: "80",
        dteEnvironment: "certification",
      },
      recipient: {
        rut: "60803000-K",
        legalName: "RECEPTOR ANONIMIZADO SPA",
        businessActivity: "SERVICIOS",
        address: "DIRECCION ANONIMIZADA 200",
        commune: "LA SERENA",
        city: "LA SERENA",
      },
      lines: [{
        name: "SERVICIO ANONIMIZADO",
        quantity: 1,
        unitPrice: 4202,
        amount: 4202,
        exempt: false,
      }],
      netAmount: 4202,
      exemptAmount: 0,
      taxAmount: 798,
      totalAmount: 5000,
    };
    assert.throws(
      () => buildDteDocumentoXmlLab({
        ...draft,
        issuer: { ...draft.issuer, businessActivityCode: null },
      }),
      /DTE_ISSUER_ACTIVITY_CODE_REQUIRED/,
    );
    const grossDraft: TaxDocumentDraft = {
      ...draft,
      folio: 9,
      lines: [{
        name: "SERVICIO CATALOGO BRUTO",
        quantity: 1,
        unitPrice: 59_440,
        amount: 59_440,
        exempt: false,
      }],
      amountsAreGross: true,
      netAmount: 49_950,
      exemptAmount: 0,
      taxAmount: 9_490,
      totalAmount: 59_440,
    };
    const caseId = "anonymous-folio8";
    const grossCaseId = "anonymous-gross-folio9";
    const result = runControlledCertificationSet({
      env: {
        NODE_ENV: "test",
        DTE_MODE: "certification",
        DTE_SII_ENV: "certification",
        DTE_SII_LIVE_AUTH: "false",
        DTE_SII_ENABLE_SUBMIT: "false",
        DTE_SII_ENABLE_STATUS: "false",
      },
      outputDir: root,
      signingMaterial: { privateKeyPath: key, certificatePath: cert },
      drafts: [draft, grossDraft],
      caseIds: [caseId, grossCaseId],
      rutEnvia: ISSUER_RUT,
      importedCafs: [fixtureCaf()],
      setDteId: "CitayaAnonymousFolio8",
      envelopeFileName: "anonymous-folio8-envio.xml",
      manifestFileName: "anonymous-folio8-manifest.json",
      generationTimestamp: "2026-07-29T00:00:00",
    });
    const dtePath = join(root, `${caseId}-DTE-CERTIFICATION.xml`);
    const grossDtePath = join(root, `${grossCaseId}-DTE-CERTIFICATION.xml`);
    const dte = readFileSync(dtePath);
    const grossDte = readFileSync(grossDtePath);
    const envio = readFileSync(result.envelopePath);
    const dteText = dte.toString("latin1");
    const grossDteText = grossDte.toString("latin1");
    const envioText = envio.toString("latin1");
    assert.equal(result.dteXsd, "2/2");
    assert.equal(result.envioDteXsd, "valid");
    assert.equal(result.tedFrmt, "2/2");
    assert.equal(result.dteSignatures, "2/2");
    assert.equal(result.envelopeSignature, "valid");
    assert.match(dteText, /<Acteco>620900<\/Acteco>/);
    for (const expected of ["<Folio>8</Folio>", "<MntNeto>4202</MntNeto>", "<IVA>798</IVA>", "<MntTotal>5000</MntTotal>"])
      assert.match(dteText, new RegExp(expected));
    for (const expected of ["<Folio>9</Folio>", "<MntBruto>1</MntBruto>", "<MntNeto>49950</MntNeto>", "<IVA>9490</IVA>", "<MntTotal>59440</MntTotal>", "<PrcItem>59440</PrcItem>", "<MontoItem>59440</MontoItem>"])
      assert.match(grossDteText, new RegExp(expected));
    assert.match(envioText, /<FchResol>2014-08-22<\/FchResol>/);
    assert.match(envioText, /<NroResol>80<\/NroResol>/);
    assert.equal(dte.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
    assert.equal(Buffer.from(dteText, "latin1").equals(dte), true);
    assert.equal(Buffer.from(grossDteText, "latin1").equals(grossDte), true);
    assert.equal(spawnSync("xmlsec1", ["--verify", "--id-attr:ID", "Documento", "--pubkey-cert-pem", cert, dtePath]).status, 0);
    assert.equal(spawnSync("xmlsec1", ["--verify", "--id-attr:ID", "Documento", "--pubkey-cert-pem", cert, grossDtePath]).status, 0);
    const xmlsec = verifyPersistedXmlsecSignatures({
      envelopePath: result.envelopePath,
      bytes: envio,
      expectedSha256: result.envelopeSha256,
      certificatePath: cert,
    });
    assert.equal(xmlsec.individualValid, 2);
    assert.equal(xmlsec.outerValid, true);
    assert.equal(xmlsec.persistedBytesValid, true);
    assert.equal(result.siiContacted, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
