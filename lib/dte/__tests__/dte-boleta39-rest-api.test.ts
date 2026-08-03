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
  BOLETA_CERTIFICATION_USER_AGENT,
  buildBoletaRestStatusUrl,
  buildBoletaRestUnsignedTokenXml,
  parseBoletaRestSeedResponse,
  parseBoletaRestSubmitResponse,
  parseBoletaRestTokenResponse,
  parseBoletaRetryAfter,
  requestBoletaRestSeed,
  requestBoletaRestSubmit,
  requestBoletaRestToken,
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

test(
  "Boleta REST seed request uses only the certification endpoint",
  async () => {
    let calls = 0;

    const fetchImpl: typeof fetch =
      async (input, init) => {
        calls += 1;

        assert.equal(
          String(input),
          BOLETA_CERTIFICATION_SEED_URL,
        );

        assert.equal(
          init?.method,
          "GET",
        );

        assert.equal(
          init?.redirect,
          "manual",
        );

        assert.ok(
          init?.signal instanceof AbortSignal,
        );

        const headers =
          new Headers(init?.headers);

        assert.equal(
          headers.get("accept"),
          "application/xml",
        );

        assert.equal(
          headers.get("cache-control"),
          "no-store",
        );

        assert.equal(
          init?.body,
          undefined,
        );

        return new Response(
          [
            '<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">',
            "<SII:RESP_HDR>",
            "<SII:ESTADO>0</SII:ESTADO>",
            "</SII:RESP_HDR>",
            "<SII:RESP_BODY>",
            "<SII:SEMILLA>030530912644</SII:SEMILLA>",
            "</SII:RESP_BODY>",
            "</SII:RESPUESTA>",
          ].join(""),
          {
            status: 200,
            headers: {
              "Content-Type":
                "application/xml; charset=UTF-8",
            },
          },
        );
      };

    const result =
      await requestBoletaRestSeed({
        fetchImpl,
        timeoutMs: 2_000,
      });

    assert.equal(calls, 1);

    assert.deepEqual(
      result.data,
      {
        estado: "0",
        glosa: null,
        seed: "030530912644",
      },
    );

    assert.equal(
      result.contentType,
      "application/xml",
    );

    assert.ok(
      result.responseBytes > 0,
    );
  },
);

test(
  "Boleta REST token request posts the exact signed XML",
  async () => {
    const root = mkdtempSync(
      join(
        tmpdir(),
        "citaya-boleta-token-http-",
      ),
    );

    try {
      const fixture =
        createCertificateFixture(root);

      const signed =
        signBoletaRestSeed(
          "030530912644",
          fixture.keyPem,
          fixture.certPem,
        );

      let calls = 0;

      const fetchImpl: typeof fetch =
        async (input, init) => {
          calls += 1;

          assert.equal(
            String(input),
            BOLETA_CERTIFICATION_TOKEN_URL,
          );

          assert.equal(
            init?.method,
            "POST",
          );

          assert.equal(
            init?.redirect,
            "manual",
          );

          assert.equal(
            init?.body,
            signed.signedXml,
          );

          const headers =
            new Headers(init?.headers);

          assert.equal(
            headers.get("accept"),
            "application/xml",
          );

          assert.equal(
            headers.get("content-type"),
            "application/xml; charset=UTF-8",
          );

          assert.equal(
            headers.get("cookie"),
            null,
          );

          return new Response(
            [
              '<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">',
              "<SII:RESP_HDR>",
              "<SII:ESTADO>00</SII:ESTADO>",
              "<SII:GLOSA>Token Creado</SII:GLOSA>",
              "</SII:RESP_HDR>",
              "<SII:RESP_BODY>",
              "<SII:TOKEN>XAuSbYXiNh9Ik</SII:TOKEN>",
              "</SII:RESP_BODY>",
              "</SII:RESPUESTA>",
            ].join(""),
            {
              status: 200,
              headers: {
                "Content-Type":
                  "text/xml; charset=UTF-8",
              },
            },
          );
        };

      const result =
        await requestBoletaRestToken(
          signed.signedXml,
          {
            fetchImpl,
            timeoutMs: 2_000,
          },
        );

      assert.equal(calls, 1);

      assert.deepEqual(
        result.data,
        {
          estado: "00",
          glosa: "Token Creado",
          token: "XAuSbYXiNh9Ik",
        },
      );

      assert.equal(
        result.contentType,
        "text/xml",
      );

      assert.ok(
        result.responseBytes > 0,
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
  "Boleta REST authentication rejects unsafe HTTP responses",
  async () => {
    const invalidContentType: typeof fetch =
      async () =>
        new Response(
          "<html>unexpected</html>",
          {
            status: 200,
            headers: {
              "Content-Type": "text/html",
            },
          },
        );

    await assert.rejects(
      () =>
        requestBoletaRestSeed({
          fetchImpl:
            invalidContentType,
          timeoutMs: 2_000,
        }),
      /BOLETA_REST_SEED_CONTENT_TYPE_INVALID/,
    );

    const unauthorized: typeof fetch =
      async () =>
        new Response(
          "Unauthorized",
          {
            status: 401,
            headers: {
              "Content-Type": "text/plain",
            },
          },
        );

    await assert.rejects(
      () =>
        requestBoletaRestSeed({
          fetchImpl: unauthorized,
          timeoutMs: 2_000,
        }),
      /BOLETA_REST_SEED_HTTP_401/,
    );

    await assert.rejects(
      () =>
        requestBoletaRestToken(
          "<getToken/>",
          {
            fetchImpl:
              invalidContentType,
            timeoutMs: 2_000,
          },
        ),
      /BOLETA_REST_SIGNED_TOKEN_XML_INVALID/,
    );
  },
);

test(
  "Boleta REST submit builds the exact multipart request",
  async () => {
    const fileName =
      "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml";

    const fileBytes =
      Buffer.from(
        [
          '<?xml version="1.0" encoding="ISO-8859-1"?>',
          "<EnvioBOLETA/>",
        ].join(""),
        "latin1",
      );

    let calls = 0;

    const fetchImpl: typeof fetch =
      async (input, init) => {
        calls += 1;

        assert.equal(
          String(input),
          BOLETA_CERTIFICATION_SUBMIT_URL,
        );

        assert.equal(
          init?.method,
          "POST",
        );

        assert.equal(
          init?.redirect,
          "manual",
        );

        assert.ok(
          init?.signal instanceof AbortSignal,
        );

        const headers =
          new Headers(init?.headers);

        assert.equal(
          headers.get("accept"),
          "application/json",
        );

        assert.equal(
          headers.get("cache-control"),
          "no-store",
        );

        assert.equal(
          headers.get("cookie"),
          "TOKEN=TOKENFIXTURE123",
        );

        assert.equal(
          headers.get("user-agent"),
          BOLETA_CERTIFICATION_USER_AGENT,
        );

        /*
         * No se debe definir Content-Type manualmente:
         * fetch genera el boundary multipart.
         */
        assert.equal(
          headers.get("content-type"),
          null,
        );

        assert.ok(
          init?.body instanceof FormData,
        );

        const form =
          init.body;

        assert.equal(
          form.get("rutSender"),
          "27164542",
        );

        assert.equal(
          form.get("dvSender"),
          "2",
        );

        assert.equal(
          form.get("rutCompany"),
          "78195645",
        );

        assert.equal(
          form.get("dvCompany"),
          "7",
        );

        const archivo =
          form.get("archivo");

        assert.ok(
          archivo instanceof Blob,
        );

        assert.equal(
          (
            archivo as Blob & {
              name?: string;
            }
          ).name,
          fileName,
        );

        assert.equal(
          archivo.type,
          "application/xml",
        );

        assert.equal(
          archivo.size,
          fileBytes.length,
        );

        assert.deepEqual(
          Buffer.from(
            await archivo.arrayBuffer(),
          ),
          fileBytes,
        );

        return new Response(
          JSON.stringify({
            rut_emisor:
              "78195645-7",
            rut_envia:
              "27164542-2",
            trackid:
              12288340531,
            fecha_recepcion:
              "2026-08-03 17:50:00",
            estado:
              "REC",
            file:
              fileName,
          }),
          {
            status: 200,
            headers: {
              "Content-Type":
                "application/json; charset=UTF-8",
              "X-Location":
                "/boleta.electronica.envio/78195645-7-12288340531",
              "X-Retry-After":
                "10",
            },
          },
        );
      };

    const result =
      await requestBoletaRestSubmit({
        token:
          "TOKENFIXTURE123",
        senderRut:
          "27164542-2",
        companyRut:
          "78195645-7",
        fileName,
        fileBytes,
        fetchImpl,
        timeoutMs:
          2_000,
      });

    assert.equal(calls, 1);

    assert.equal(
      result.data.trackId,
      "12288340531",
    );

    assert.equal(
      result.data.status,
      "REC",
    );

    assert.equal(
      result.location,
      "/boleta.electronica.envio/78195645-7-12288340531",
    );

    assert.equal(
      result.retryAfterSeconds,
      10,
    );

    assert.equal(
      result.contentType,
      "application/json",
    );

    assert.ok(
      result.responseBytes > 0,
    );
  },
);

test(
  "Boleta REST submit rejects inconsistent SII responses",
  async () => {
    const fileName =
      "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml";

    const fileBytes =
      Buffer.from(
        "<EnvioBOLETA/>",
        "latin1",
      );

    const wrongRut: typeof fetch =
      async () =>
        new Response(
          JSON.stringify({
            rut_emisor:
              "11111111-1",
            rut_envia:
              "27164542-2",
            trackid:
              12288340531,
            fecha_recepcion:
              "2026-08-03 17:50:00",
            estado:
              "REC",
            file:
              fileName,
          }),
          {
            status: 200,
            headers: {
              "Content-Type":
                "application/json",
            },
          },
        );

    await assert.rejects(
      () =>
        requestBoletaRestSubmit({
          token:
            "TOKENFIXTURE123",
          senderRut:
            "27164542-2",
          companyRut:
            "78195645-7",
          fileName,
          fileBytes,
          fetchImpl:
            wrongRut,
          timeoutMs:
            2_000,
        }),
      /BOLETA_REST_SUBMIT_RESPONSE_RUT_MISMATCH/,
    );

    const badContentType: typeof fetch =
      async () =>
        new Response(
          "<html>unexpected</html>",
          {
            status: 200,
            headers: {
              "Content-Type":
                "text/html",
            },
          },
        );

    await assert.rejects(
      () =>
        requestBoletaRestSubmit({
          token:
            "TOKENFIXTURE123",
          senderRut:
            "27164542-2",
          companyRut:
            "78195645-7",
          fileName,
          fileBytes,
          fetchImpl:
            badContentType,
          timeoutMs:
            2_000,
        }),
      /BOLETA_REST_SUBMIT_CONTENT_TYPE_INVALID/,
    );

    const badRequest: typeof fetch =
      async () =>
        new Response(
          "Peticion con error",
          {
            status: 400,
            headers: {
              "Content-Type":
                "text/plain",
            },
          },
        );

    await assert.rejects(
      () =>
        requestBoletaRestSubmit({
          token:
            "TOKENFIXTURE123",
          senderRut:
            "27164542-2",
          companyRut:
            "78195645-7",
          fileName,
          fileBytes,
          fetchImpl:
            badRequest,
          timeoutMs:
            2_000,
        }),
      /BOLETA_REST_SUBMIT_HTTP_400/,
    );
  },
);
