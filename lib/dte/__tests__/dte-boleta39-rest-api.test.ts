import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BOLETA_CERTIFICATION_SEED_URL,
  BOLETA_CERTIFICATION_SUBMIT_URL,
  BOLETA_CERTIFICATION_TOKEN_URL,
  buildBoletaRestStatusUrl,
  buildBoletaRestUnsignedTokenXml,
  parseBoletaRestSeedResponse,
  parseBoletaRestSubmitResponse,
  parseBoletaRestTokenResponse,
  parseBoletaRetryAfter,
  signBoletaRestSeed,
} from "../certification/boleta39-rest-api";

function createCertificateFixture(root: string): {
  certPath: string;
  keyPath: string;
  certPem: string;
  keyPem: string;
} {
  const certPath = join(root, "cert.pem");
  const keyPath = join(root, "key.pem");

  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=Boleta REST Fixture/serialNumber=27164542-2/C=CL",
    ],
    {
      encoding: "utf8",
    },
  );

  assert.equal(
    result.status,
    0,
    result.stderr,
  );

  chmodSync(certPath, 0o600);
  chmodSync(keyPath, 0o600);

  return {
    certPath,
    keyPath,
    certPem: readFileSync(certPath, "utf8"),
    keyPem: readFileSync(keyPath, "utf8"),
  };
}

test(
  "Boleta REST signer matches the official seed fixture",
  () => {
    const root = mkdtempSync(
      join(tmpdir(), "citaya-boleta-rest-"),
    );

    try {
      const fixture =
        createCertificateFixture(root);

      const result = signBoletaRestSeed(
        "030530912644",
        fixture.keyPem,
        fixture.certPem,
      );

      assert.equal(
        result.unsignedXml,
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          "<getToken><item><Semilla>030530912644</Semilla></item></getToken>",
        ].join("\n"),
      );

      assert.equal(
        result.unsignedXml.split("\n").length,
        2,
      );

      assert.equal(
        result.signedXml.split("\n").length,
        2,
      );

      assert.equal(
        result.signedXml.endsWith("\n"),
        false,
      );

      assert.match(
        result.signedXml,
        /<Reference URI="">/,
      );

      assert.equal(
        result.digestValue,
        "l2s9BqLppHaWo+w1Al1J5SsYScs=",
      );

      assert.equal(result.verified, true);

      const recovered =
        result.signedXml.replace(
          /<Signature\b[\s\S]*?<\/Signature>/,
          "",
        );

      assert.equal(
        recovered,
        result.unsignedXml,
      );

      const xmlPath = join(
        root,
        "getToken.xml",
      );

      writeFileSync(
        xmlPath,
        result.signedXml,
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );

      chmodSync(xmlPath, 0o600);

      const xmlsec = spawnSync(
        "xmlsec1",
        [
          "--verify",
          "--pubkey-cert-pem",
          fixture.certPath,
          xmlPath,
        ],
        {
          encoding: "utf8",
        },
      );

      assert.equal(
        xmlsec.status,
        0,
        xmlsec.stderr,
      );
    } finally {
      rmSync(root, {
        recursive: true,
        force: true,
      });
    }
  },
);

test(
  "Boleta REST parsers accept official response shapes",
  () => {
    const seedResponse = [
      '<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">',
      "<SII:RESP_HDR>",
      "<SII:ESTADO>0</SII:ESTADO>",
      "</SII:RESP_HDR>",
      "<SII:RESP_BODY>",
      "<SII:SEMILLA>030530912644</SII:SEMILLA>",
      "</SII:RESP_BODY>",
      "</SII:RESPUESTA>",
    ].join("");

    const tokenResponse = [
      '<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">',
      "<SII:RESP_HDR>",
      "<SII:ESTADO>00</SII:ESTADO>",
      "<SII:GLOSA>Token Creado</SII:GLOSA>",
      "</SII:RESP_HDR>",
      "<SII:RESP_BODY>",
      "<SII:TOKEN>XAuSbYXiNh9Ik</SII:TOKEN>",
      "</SII:RESP_BODY>",
      "</SII:RESPUESTA>",
    ].join("");

    assert.deepEqual(
      parseBoletaRestSeedResponse(
        seedResponse,
      ),
      {
        estado: "0",
        glosa: null,
        seed: "030530912644",
      },
    );

    assert.deepEqual(
      parseBoletaRestTokenResponse(
        tokenResponse,
      ),
      {
        estado: "00",
        glosa: "Token Creado",
        token: "XAuSbYXiNh9Ik",
      },
    );
  },
);

test(
  "Boleta REST submit parser and status URL preserve Track ID",
  () => {
    const response =
      parseBoletaRestSubmitResponse(
        JSON.stringify({
          rut_emisor: "78195645-7",
          rut_envia: "27164542-2",
          trackid: 1014,
          fecha_recepcion:
            "2026-08-03 17:20:00",
          estado: "REC",
          file:
            "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml",
        }),
      );

    assert.equal(response.trackId, "1014");
    assert.equal(response.status, "REC");

    assert.equal(
      buildBoletaRestStatusUrl(
        "78195645-7",
        response.trackId,
      ),
      "https://apicert.sii.cl/recursos/v1/boleta.electronica.envio/78195645-7-1014",
    );

    assert.equal(
      parseBoletaRetryAfter("10"),
      10,
    );

    assert.equal(
      parseBoletaRetryAfter("invalid"),
      null,
    );
  },
);

test(
  "Boleta REST endpoints remain isolated from DTE SOAP upload",
  () => {
    assert.equal(
      BOLETA_CERTIFICATION_SEED_URL,
      "https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla",
    );

    assert.equal(
      BOLETA_CERTIFICATION_TOKEN_URL,
      "https://apicert.sii.cl/recursos/v1/boleta.electronica.token",
    );

    assert.equal(
      BOLETA_CERTIFICATION_SUBMIT_URL,
      "https://pangal.sii.cl/recursos/v1/boleta.electronica.envio",
    );

    assert.equal(
      buildBoletaRestUnsignedTokenXml(
        "030530912644",
      ).endsWith("\n"),
      false,
    );
  },
);
