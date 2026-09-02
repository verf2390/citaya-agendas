import assert from "node:assert/strict";
import {
  createPrivateKey,
  createPublicKey,
  createSign,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildProductionBoleta39Document,
  encodeBoleta39Iso88591,
  verifyBoleta39Ted,
  verifyBoleta39XmlReference,
} from "../production-boleta39";
import { InMemoryPrivateDteArtifactStore } from "../production/artifact-store";

const TENANT_ID = "21884d8b-1975-4e5c-8887-06eb62401428";
const FOLIO = 40014;
const DOCUMENT_ID = `CitayaBoleta39-${FOLIO}`;
const SET_ID = `CitayaBoleta39Set-${FOLIO}-${FOLIO}`;

function fixture(root: string) {
  const privateKeyPath = join(root, "certificate-key.pem");
  const certificatePath = join(root, "certificate.pem");
  const cafKeyPath = join(root, "caf-key.pem");
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
      "/CN=Boleta Crypto Fixture/serialNumber=78195645-7/C=CL",
    ],
    { stdio: "ignore" },
  );
  execFileSync("openssl", ["genrsa", "-out", cafKeyPath, "1024"], {
    stdio: "ignore",
  });
  for (const path of [privateKeyPath, certificatePath, cafKeyPath]) {
    chmodSync(path, 0o600);
  }
  const cafPrivateKeyPem = readFileSync(cafKeyPath, "utf8");
  const cafKey = createPublicKey(createPrivateKey(cafPrivateKeyPem));
  const jwk = cafKey.export({ format: "jwk" }) as { n: string; e: string };
  const cafPublicKeyPem = cafKey
    .export({ format: "pem", type: "spki" })
    .toString();
  const da =
    `<DA><RE>78195645-7</RE><RS>R&amp;G SPA</RS><TD>39</TD>` +
    `<RNG><D>${FOLIO}</D><H>${FOLIO}</H></RNG><FA>2026-08-04</FA>` +
    `<RSAPK><M>${Buffer.from(jwk.n, "base64url").toString("base64")}</M>` +
    `<E>${Buffer.from(jwk.e, "base64url").toString("base64")}</E></RSAPK>` +
    `<IDK>300</IDK></DA>`;
  const signer = createSign("RSA-SHA1");
  signer.update(da, "latin1");
  const cafXml =
    `<CAF version="1.0">${da}` +
    `<FRMA algoritmo="SHA1withRSA">${signer.sign(cafPrivateKeyPem, "base64")}</FRMA>` +
    `</CAF>`;
  return {
    privateKeyPath,
    certificatePath,
    cafPrivateKeyPem,
    cafPublicKeyPem,
    cafXml,
  };
}

test("Boleta 39 keeps Documento and SetDTE immutable after signing and survives persist/load", async () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-boleta39-crypto-"));
  try {
    const material = fixture(root);
    const result = await buildProductionBoleta39Document({
      tenantId: TENANT_ID,
      folio: FOLIO,
      issueDate: "2026-08-05",
      issuer: {
        rut: "78195645-7",
        legalName: "R&G SPA",
        businessActivity: "Servicios digitales",
        address: "Colón Nro. 352, Of. 318",
        commune: "La Serena",
        city: "La Serena",
        resolutionDate: "2014-08-22",
        resolutionNumber: "80",
      },
      recipient: { rut: "26706221-8", legalName: "Victor Rodriguez" },
      lines: [
        { description: "SERVICIOS", quantity: 1, unitGrossAmount: 3000 },
        { description: "WEB", quantity: 1, unitGrossAmount: 2000 },
      ],
      cafXml: material.cafXml,
      cafPrivateKeyPem: material.cafPrivateKeyPem,
      cafPublicKeyPem: material.cafPublicKeyPem,
      privateKeyPath: material.privateKeyPath,
      certificatePath: material.certificatePath,
      generationTimestamp: "2026-08-10T12:00:00",
    });
    const dteBytes = encodeBoleta39Iso88591(result.dteXml);
    const envioBytes = encodeBoleta39Iso88591(result.envioXml);
    assert.equal(
      verifyBoleta39XmlReference({
        xmlBytes: dteBytes,
        referenceId: DOCUMENT_ID,
        certificatePath: material.certificatePath,
      }),
      true,
    );
    assert.equal(
      verifyBoleta39XmlReference({
        xmlBytes: envioBytes,
        referenceId: DOCUMENT_ID,
        certificatePath: material.certificatePath,
      }),
      true,
    );
    assert.equal(
      verifyBoleta39XmlReference({
        xmlBytes: envioBytes,
        referenceId: SET_ID,
        certificatePath: material.certificatePath,
      }),
      true,
    );
    assert.equal(
      verifyBoleta39Ted({
        dteXml: envioBytes.toString("latin1"),
        cafXml: material.cafXml,
        cafPublicKeyPem: material.cafPublicKeyPem,
        issuerRut: "78195645-7",
        folio: FOLIO,
        issueDate: "2026-08-05",
        totalAmount: 5000,
      }),
      true,
    );

    const documentMutation = Buffer.from(
      envioBytes.toString("latin1").replace("<NmbItem>WEB</NmbItem>", "<NmbItem>WEC</NmbItem>"),
      "latin1",
    );
    assert.equal(
      verifyBoleta39XmlReference({
        xmlBytes: documentMutation,
        referenceId: DOCUMENT_ID,
        certificatePath: material.certificatePath,
      }),
      false,
    );

    const setMutation = Buffer.from(
      envioBytes.toString("latin1").replace("<NroDTE>1</NroDTE>", "<NroDTE>2</NroDTE>"),
      "latin1",
    );
    assert.equal(
      verifyBoleta39XmlReference({
        xmlBytes: setMutation,
        referenceId: SET_ID,
        certificatePath: material.certificatePath,
      }),
      false,
    );

    const storage = new InMemoryPrivateDteArtifactStore();
    const stored = await storage.putImmutable({
      tenantId: TENANT_ID,
      documentId: "26df33ba-a823-45a8-983a-cbc369bfc9d8",
      fileName: "39-40014-envio-v2.xml",
      contentType: "text/xml; charset=ISO-8859-1",
      bytes: envioBytes,
    });
    const loaded = await storage.getPrivate(TENANT_ID, stored.storageKey);
    assert.deepEqual(loaded.bytes, envioBytes);
    assert.equal(
      verifyBoleta39XmlReference({
        xmlBytes: loaded.bytes,
        referenceId: DOCUMENT_ID,
        certificatePath: material.certificatePath,
      }),
      true,
    );
    assert.equal(
      verifyBoleta39XmlReference({
        xmlBytes: loaded.bytes,
        referenceId: SET_ID,
        certificatePath: material.certificatePath,
      }),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
