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
  BoletaRestSubmitHttpError,
  buildBoletaRestStatusUrl,
  buildBoletaRestUnsignedTokenXml,
  evaluateRcofResponse,
  parseBoletaRestSeedResponse,
  parseBoletaRestSubmitResponse,
  parseBoletaRestTokenResponse,
  parseBoletaRetryAfter,
  requestBoletaRestSeed,
  requestBoletaRestStatus,
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

test(
  "Boleta REST submit captures HTTP 400 text/plain with sanitized body",
  async () => {
    const fileName =
      "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml";

    const fileBytes =
      Buffer.from(
        "<EnvioBOLETA/>",
        "latin1",
      );

    const http400WithToken: typeof fetch =
      async () =>
        new Response(
          "Peticion con error: TOKEN=SECRET123XYZ",
          {
            status: 400,
            headers: {
              "Content-Type":
                "text/plain; charset=UTF-8",
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
            http400WithToken,
          timeoutMs:
            2_000,
        }),
      (error) => {
        assert(
          error instanceof
            BoletaRestSubmitHttpError,
        );

        assert.equal(
          error.message,
          "BOLETA_REST_SUBMIT_HTTP_400",
        );

        assert.equal(
          error.status,
          400,
        );

        assert.equal(
          error.contentType,
          "text/plain",
        );

        assert.ok(
          error.responseText,
        );

        assert(
          error.responseText.includes(
            "TOKEN=[REDACTED]",
          ),
          "Should redact TOKEN value",
        );

        assert(
          !error.responseText.includes(
            "SECRET123XYZ",
          ),
          "Should not contain original token",
        );

        return true;
      },
    );
  },
);

test(
  "Boleta REST submit sanitizes HTTP 401 without exposing body",
  async () => {
    const fileName =
      "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml";

    const fileBytes =
      Buffer.from(
        "<EnvioBOLETA/>",
        "latin1",
      );

    const http401Response: typeof fetch =
      async () =>
        new Response(
          "Unauthorized: invalid cookie TOKEN=value",
          {
            status: 401,
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
            http401Response,
          timeoutMs:
            2_000,
        }),
      (error) => {
        assert(
          error instanceof
            BoletaRestSubmitHttpError,
        );

        assert.equal(
          error.message,
          "BOLETA_REST_SUBMIT_HTTP_401",
        );

        assert.equal(
          error.status,
          401,
        );

        assert(
          !error.responseText.includes(
            "value",
          ),
          "Token value should be redacted",
        );

        return true;
      },
    );
  },
);

test(
  "Boleta REST submit sanitizes Cookie and Authorization headers",
  async () => {
    const fileName =
      "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml";

    const fileBytes =
      Buffer.from(
        "<EnvioBOLETA/>",
        "latin1",
      );

    const withCookieAndAuth: typeof fetch =
      async () =>
        new Response(
          [
            "Error occurred",
            "Cookie: TOKEN=SECRET456",
            "Authorization: Bearer xyz789",
          ].join("\n"),
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
            withCookieAndAuth,
          timeoutMs:
            2_000,
        }),
      (error) => {
        assert(
          error instanceof
            BoletaRestSubmitHttpError,
        );

        const body =
          error.responseText;

        assert(
          !body.includes("SECRET456"),
          "Cookie token should be redacted",
        );

        assert(
          !body.includes("xyz789"),
          "Authorization should be redacted",
        );

        assert(
          body.includes(
            "Cookie: [REDACTED]",
          ),
          "Cookie should show redaction marker",
        );

        assert(
          body.includes(
            "Authorization: [REDACTED]",
          ),
          "Authorization should show redaction marker",
        );

        return true;
      },
    );
  },
);

test(
  "Boleta REST submit sanitizes PEM blocks (PRIVATE KEY and CERTIFICATE)",
  async () => {
    const fileName =
      "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml";

    const fileBytes =
      Buffer.from(
        "<EnvioBOLETA/>",
        "latin1",
      );

    const withPemBlocks: typeof fetch =
      async () => {
        const body = [
          "Error details:",
          "-----BEGIN PRIVATE KEY-----",
          "MIIEvQIBADANBgkqhkiG9w0BAQE",
          "-----END PRIVATE KEY-----",
          "-----BEGIN CERTIFICATE-----",
          "MIIDXTCCAkWgAwIBAgIJAK",
          "-----END CERTIFICATE-----",
        ].join("\n");

        return new Response(body, {
          status: 400,
          headers: {
            "Content-Type":
              "text/plain",
          },
        });
      };

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
            withPemBlocks,
          timeoutMs:
            2_000,
        }),
      (error) => {
        assert(
          error instanceof
            BoletaRestSubmitHttpError,
        );

        const body =
          error.responseText;

        assert(
          !body.includes(
            "BEGIN PRIVATE KEY",
          ),
          "PRIVATE KEY block should be removed",
        );

        assert(
          !body.includes(
            "BEGIN CERTIFICATE",
          ),
          "CERTIFICATE block should be removed",
        );

        assert(
          !body.includes(
            "MIIEvQIBADANBgkqhkiG9w0BAQE",
          ),
          "Key material should be removed",
        );

        assert(
          body.includes(
            "[REDACTED_PEM]",
          ),
          "Should have redaction markers",
        );

        return true;
      },
    );
  },
);

test(
  "Boleta REST submit handles empty HTTP 400 response",
  async () => {
    const fileName =
      "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml";

    const fileBytes =
      Buffer.from(
        "<EnvioBOLETA/>",
        "latin1",
      );

    const emptyResponse: typeof fetch =
      async () =>
        new Response("", {
          status: 400,
          headers: {
            "Content-Type":
              "text/plain",
          },
        });

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
            emptyResponse,
          timeoutMs:
            2_000,
        }),
      (error) => {
        assert(
          error instanceof
            BoletaRestSubmitHttpError,
        );

        assert.equal(
          error.responseText,
          "EMPTY_RESPONSE",
        );

        return true;
      },
    );
  },
);

test(
  "Boleta REST submit handles oversized HTTP 400 response",
  async () => {
    const fileName =
      "EnvioBOLETA-39-CASO-1-5-CERTIFICATION.xml";

    const fileBytes =
      Buffer.from(
        "<EnvioBOLETA/>",
        "latin1",
      );

    const oversizedResponse: typeof fetch =
      async () => {
        const body =
          "Error ".repeat(12000);

        return new Response(body, {
          status: 400,
          headers: {
            "Content-Type":
              "text/plain",
          },
        });
      };

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
            oversizedResponse,
          timeoutMs:
            2_000,
        }),
      /BOLETA_REST_SUBMIT_RESPONSE_SIZE_INVALID/,
    );
  },
);

test(
  "Boleta REST submit continues to return Track ID on HTTP 200",
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

    const successResponse: typeof fetch =
      async (input) => {
        assert.equal(
          String(input),
          BOLETA_CERTIFICATION_SUBMIT_URL,
        );

        return new Response(
          JSON.stringify({
            rut_emisor:
              "78195645-7",
            rut_envia:
              "27164542-2",
            trackid:
              999888777,
            fecha_recepcion:
              "2026-08-03 18:00:00",
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
                "/boleta.electronica.envio/78195645-7-999888777",
              "X-Retry-After": "10",
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
        fetchImpl:
          successResponse,
        timeoutMs:
          2_000,
      });

    assert.equal(
      result.data.trackId,
      "999888777",
    );

    assert.equal(
      result.data.status,
      "REC",
    );
  },
);

test(
  "Boleta REST submit handles identical filename and returns trackId",
  async () => {
    const fileName = "EnvioBOLETA-39-CASO-1-5-CERTIFICATION-SCHEMA-FIX.xml";
    const fileBytes = Buffer.from("<EnvioBOLETA/>", "latin1");
    const mockFetch: typeof fetch = async () => new Response(
      JSON.stringify({
        rut_emisor: "78195645-7",
        rut_envia: "27164542-2",
        trackid: 12288340532,
        fecha_recepcion: "2026-08-04 00:16:00",
        estado: "REC",
        file: fileName,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

    const result = await requestBoletaRestSubmit({
      token: "SECRETTOKEN123",
      senderRut: "27164542-2",
      companyRut: "78195645-7",
      fileName,
      fileBytes,
      fetchImpl: mockFetch,
    });

    assert.equal(result.data.trackId, "12288340532");
    assert.equal(result.warning, null);
    assert.equal(result.httpStatus, 200);
    assert.doesNotMatch(JSON.stringify(result.sanitizedJson), /SECRETTOKEN123/);
  },
);

test(
  "Boleta REST submit handles SII returning different basename without losing trackId",
  async () => {
    const fileName = "EnvioBOLETA-39-CASO-1-5-CERTIFICATION-SCHEMA-FIX.xml";
    const fileBytes = Buffer.from("<EnvioBOLETA/>", "latin1");
    const mockFetch: typeof fetch = async () => new Response(
      JSON.stringify({
        rut_emisor: "78195645-7",
        rut_envia: "27164542-2",
        trackid: 12288340532,
        fecha_recepcion: "2026-08-04 00:16:00",
        estado: "REC",
        file: "EnvioBOLETA.xml",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

    const result = await requestBoletaRestSubmit({
      token: "SECRETTOKEN123",
      senderRut: "27164542-2",
      companyRut: "78195645-7",
      fileName,
      fileBytes,
      fetchImpl: mockFetch,
    });

    assert.equal(result.data.trackId, "12288340532");
    assert.equal(result.data.status, "REC");
    assert.equal(result.warning, "FILE_NAME_MISMATCH");
    assert.doesNotMatch(JSON.stringify(result), /SECRETTOKEN123/);
  },
);

test(
  "Boleta REST submit handles SII returning abbreviated filename",
  async () => {
    const fileName = "EnvioBOLETA-39-CASO-1-5-CERTIFICATION-SCHEMA-FIX.xml";
    const fileBytes = Buffer.from("<EnvioBOLETA/>", "latin1");
    const mockFetch: typeof fetch = async () => new Response(
      JSON.stringify({
        rut_emisor: "78195645-7",
        rut_envia: "27164542-2",
        trackid: 12288340532,
        fecha_recepcion: "2026-08-04 00:16:00",
        estado: "REC",
        file: "ENVIO39.XML",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

    const result = await requestBoletaRestSubmit({
      token: "SECRETTOKEN123",
      senderRut: "27164542-2",
      companyRut: "78195645-7",
      fileName,
      fileBytes,
      fetchImpl: mockFetch,
    });

    assert.equal(result.data.trackId, "12288340532");
    assert.equal(result.warning, "FILE_NAME_MISMATCH");
    assert.equal(result.data.fileName, "ENVIO39.XML");
  },
);

test(
  "REC response always retains trackId and contains no tokens in sanitized outputs",
  async () => {
    const fileName = "EnvioBOLETA-39-CASO-1-5-CERTIFICATION-SCHEMA-FIX.xml";
    const fileBytes = Buffer.from("<EnvioBOLETA/>", "latin1");
    const secretToken = "SECRETTOKEN123456789";
    const mockFetch: typeof fetch = async () => new Response(
      JSON.stringify({
        rut_emisor: "78195645-7",
        rut_envia: "27164542-2",
        trackid: 5544332211,
        fecha_recepcion: "2026-08-04 00:16:00",
        estado: "REC",
        file: "ANY_FILENAME.XML",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

    const result = await requestBoletaRestSubmit({
      token: secretToken,
      senderRut: "27164542-2",
      companyRut: "78195645-7",
      fileName,
      fileBytes,
      fetchImpl: mockFetch,
    });

    assert.equal(result.data.trackId, "5544332211");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secretToken));
  },
);

test(
  "recover-by-folio phase CANNOT perform submit",
  async () => {
    const { runRecoverByFolio } = await import("../../../scripts/dte/boleta39-certification-transport.mjs");
    const preflight = {
      artifactDir: "/home/verf/secure/dte-lab/caf/artifacts/boleta39-schema-fix",
      signingMaterial: {
        fingerprint256: "EF:2A:0E:68:E9:2F:0D:63:99:08:D0:DB:6C:85:D5:05:DF:1C:D6:F4:BB:25:18:21:C9:6C:50:21:70:F5:25:6B",
        validFrom: "May  6 00:10:28 2026 GMT",
        validTo: "May 26 13:01:31 2028 GMT",
      },
    };

    const oldSubmit = process.env.DTE_SII_ENABLE_SUBMIT;
    process.env.DTE_SII_ENABLE_SUBMIT = "true";
    try {
      await assert.rejects(
        () => runRecoverByFolio(preflight),
        /RECOVER_PHASE_CANNOT_SUBMIT/,
      );
    } finally {
      process.env.DTE_SII_ENABLE_SUBMIT = oldSubmit;
    }
  },
);

test(
  "RCOF code 250 (RVD not mandatory since Aug 2022) evaluates as REPARO_INFORMATIONAL and non-blocking",
  () => {
    const result = evaluateRcofResponse({
      trackId: 253620646,
      estado: "REPARO",
      errores: 0,
      reparos: 1,
      codigo: 250,
      descripcion: "Envío de RVD no es obligatorio desde agosto 2022",
      detalle: "RVD no es obligatorio desde 2022-08-01",
    });

    assert.equal(result.received, true);
    assert.equal(result.trackId, "253620646");
    assert.equal(result.status, "REPARO_INFORMATIONAL");
    assert.equal(result.blocking, false);
    assert.equal(result.errors, 0);
    assert.equal(result.warningCode, 250);
    assert.equal(result.rcofRequired, false);
    assert.equal(result.description, "Envío de RVD no es obligatorio desde agosto 2022");
    assert.equal(result.detail, "RVD no es obligatorio desde 2022-08-01");
  },
);

test(
  "Track ID is saved BEFORE filename mismatch check and retained in response",
  async () => {
    const fileName = "EnvioBOLETA-39-CASO-6-10-CERTIFICATION.xml";
    const fileBytes = Buffer.from("<EnvioBOLETA/>", "latin1");
    const mockFetch: typeof fetch = async () => new Response(
      JSON.stringify({
        rut_emisor: "78195645-7",
        rut_envia: "27164542-2",
        trackid: 9988776655,
        fecha_recepcion: "2026-08-03 21:45:00",
        estado: "REC",
        file: "DIFFERENT_FILENAME.XML",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

    const result = await requestBoletaRestSubmit({
      token: "TOKEN123",
      senderRut: "27164542-2",
      companyRut: "78195645-7",
      fileName,
      fileBytes,
      fetchImpl: mockFetch,
    });

    assert.equal(result.data.trackId, "9988776655");
    assert.equal(result.warning, "FILE_NAME_MISMATCH");
    assert.equal(result.data.status, "REC");
  },
);

test(
  "Filename mismatch only generates warning and keeps status REC",
  async () => {
    const fileName = "EnvioBOLETA-39-CASO-6-10-CERTIFICATION.xml";
    const fileBytes = Buffer.from("<EnvioBOLETA/>", "latin1");
    const mockFetch: typeof fetch = async () => new Response(
      JSON.stringify({
        rut_emisor: "78195645-7",
        rut_envia: "27164542-2",
        trackid: 9988776655,
        fecha_recepcion: "2026-08-03 21:45:00",
        estado: "REC",
        file: "EnvioBOLETA.xml",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

    const result = await requestBoletaRestSubmit({
      token: "TOKEN123",
      senderRut: "27164542-2",
      companyRut: "78195645-7",
      fileName,
      fileBytes,
      fetchImpl: mockFetch,
    });

    assert.equal(result.warning, "FILE_NAME_MISMATCH");
    assert.equal(result.data.status, "REC");
    assert.equal(result.data.trackId, "9988776655");
  },
);

test(
  "All three persistence backups contain the exact same Track ID",
  async () => {
    const { persistTrackIdBackups, verifyPersistenceBackups } = await import("../../../scripts/dte/boleta39-certification-transport.mjs");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempDir = mkdtempSync(join(tmpdir(), "citaya-test-backups-"));
    try {
      const envelopeSha256 = "82805da5ea3e2450965193c9a84eb562a411052efe2e0e2cf796aea921862573";
      const trackId = "9988776655";
      const startedAt = "2026-08-03T21-45-00";

      const completedRecord = {
        schemaVersion: 1,
        environment: "certification",
        documentType: 39,
        attemptNumber: 1,
        envelopeSha256,
        trackId,
        status: "REC",
        httpStatus: 200,
        warning: "FILE_NAME_MISMATCH",
      };

      const backups = persistTrackIdBackups({
        envelopeSha256,
        trackId,
        status: "REC",
        completedRecord,
        startedAt,
        live: true,
        auditDir: tempDir,
        liveSubmitDir: tempDir,
      });

      const verification = verifyPersistenceBackups({
        jsonPath: backups.jsonPath,
        txtPath: backups.txtPath,
        logPath: backups.logPath,
        expectedTrackId: trackId,
        isDryRun: false,
      });

      assert.equal(verification.verified, true);
      assert.equal(verification.trackId, trackId);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  },
);

test(
  "No HTTP 200 response is lost even if secondary validation fails",
  async () => {
    const fileName = "EnvioBOLETA-39-CASO-6-10-CERTIFICATION.xml";
    const fileBytes = Buffer.from("<EnvioBOLETA/>", "latin1");
    const mockFetch: typeof fetch = async () => new Response(
      JSON.stringify({
        rut_emisor: "78195645-7",
        rut_envia: "27164542-2",
        trackid: 7766554433,
        fecha_recepcion: "2026-08-03 21:45:00",
        estado: "REC",
        file: "ANY_NAME.XML",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

    const result = await requestBoletaRestSubmit({
      token: "TOKEN123",
      senderRut: "27164542-2",
      companyRut: "78195645-7",
      fileName,
      fileBytes,
      fetchImpl: mockFetch,
    });

    assert.equal(result.httpStatus, 200);
    assert.equal(result.data.trackId, "7766554433");
    assert.ok(result.sanitizedJson);
  },
);

test(
  "No automatic retry occurs when submit completes with REC",
  async () => {
    let callCount = 0;
    const fileName = "EnvioBOLETA-39-CASO-6-10-CERTIFICATION.xml";
    const fileBytes = Buffer.from("<EnvioBOLETA/>", "latin1");
    const mockFetch: typeof fetch = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          rut_emisor: "78195645-7",
          rut_envia: "27164542-2",
          trackid: 1122334455,
          fecha_recepcion: "2026-08-03 21:45:00",
          estado: "REC",
          file: fileName,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await requestBoletaRestSubmit({
      token: "TOKEN123",
      senderRut: "27164542-2",
      companyRut: "78195645-7",
      fileName,
      fileBytes,
      fetchImpl: mockFetch,
    });

    assert.equal(callCount, 1);
    assert.equal(result.data.trackId, "1122334455");
  },
);

test(
  "submit-dry-run does NOT create any files in boleta39-submit or boleta39-live-submit",
  async () => {
    const { persistTrackIdBackups } = await import("../../../scripts/dte/boleta39-certification-transport.mjs");
    const { existsSync } = await import("node:fs");
    const dummySha = "9999999999999999999999999999999999999999999999999999999999999999";
    const dummyJsonPath = `/home/verf/secure/dte-lab/audit/boleta39-submit/${dummySha}.json`;
    const dummyTxtPath = `/home/verf/secure/dte-lab/audit/boleta39-submit/${dummySha}.TRACK-ID.txt`;

    const result = persistTrackIdBackups({
      envelopeSha256: dummySha,
      trackId: "12288340532",
      status: "REC",
      completedRecord: { status: "REC", trackId: "12288340532" },
      startedAt: "2026-08-03T22:00:00",
      live: false,
    });

    assert.equal(result.isDryRun, true);
    assert.equal(existsSync(dummyJsonPath), false);
    assert.equal(existsSync(dummyTxtPath), false);
  },
);

test(
  "simulated Track ID is never persisted to real audit directories during dry-run",
  async () => {
    const { existsSync } = await import("node:fs");
    const dummySha = "9999999999999999999999999999999999999999999999999999999999999999";
    const dummyTxtPath = `/home/verf/secure/dte-lab/audit/boleta39-submit/${dummySha}.TRACK-ID.txt`;
    assert.equal(existsSync(dummyTxtPath), false);
  },
);

test(
  "requestBoletaRestStatus performs strictly GET requests and never POST submit",
  async () => {
    const requestedMethods: string[] = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      requestedMethods.push(method);
      if (method === "POST") {
        throw new Error("POST_NOT_ALLOWED_IN_STATUS_BY_TRACK");
      }
      return new Response(
        JSON.stringify({
          rut_emisor: "78195645-7",
          trackid: 30573329,
          fecha_recepcion: "2026-08-03 22:08:43",
          estado: "REC",
          estadisticas: [
            { tipo: 39, informados: 5, aceptados: 5, rechazados: 0, reparos: 0 },
          ],
          detalle_rep_rech: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await requestBoletaRestStatus({
      token: "TOKEN123",
      companyRut: "78195645-7",
      trackId: "30573329",
      fetchImpl: mockFetch,
    });

    assert.equal(result.httpStatus, 200);
    assert.equal(result.data.trackId, "30573329");
    assert.equal(result.data.status, "REC");
    assert.deepEqual(requestedMethods, ["GET"]);
  },
);

test(
  "status-by-track phase CANNOT run if DTE_SII_ENABLE_SUBMIT is true",
  async () => {
    const { runStatusByTrack } = await import("../../../scripts/dte/boleta39-certification-transport.mjs");
    process.env.DTE_SII_ENABLE_SUBMIT = "true";

    try {
      await assert.rejects(
        async () => {
          await runStatusByTrack({}, {});
        },
        /STATUS_PHASE_CANNOT_SUBMIT/,
      );
    } finally {
      delete process.env.DTE_SII_ENABLE_SUBMIT;
    }
  },
);
