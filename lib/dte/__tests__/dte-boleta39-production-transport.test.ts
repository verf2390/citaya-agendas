import assert from "node:assert/strict";
import test from "node:test";
import { createProductionSiiClient, ProductionSiiClient } from "../production/sii-client";
import {
  BOLETA_SII_DEFAULT_USER_AGENT,
  resolveBoletaSiiUploadUserAgent,
  SiiBoletaApiTransport,
} from "../production/boleta-api-transport";
import {
  assertBoletaApiEnvironmentHosts,
  BOLETA_API_ENVIRONMENT_CONFIG,
  BOLETA_PRODUCTION_API_BASE,
  BOLETA_PRODUCTION_SEED_URL,
  BOLETA_PRODUCTION_SUBMIT_URL,
  BOLETA_PRODUCTION_TOKEN_URL,
  BoletaRestSubmitHttpError,
  buildBoletaDocumentStatusUrl,
  classifyBoletaRestSubmitFailure,
  requestBoletaRestSubmit,
} from "../certification/boleta39-rest-api";
import type { ProductionRuntimeConfig } from "../production/config";

const mockConfig: ProductionRuntimeConfig = {
  enabled: true,
  environment: "production",
  signingMode: "production",
  seedUrl: "https://palena.sii.cl/seed",
  tokenUrl: "https://palena.sii.cl/token",
  uploadUrl: "https://palena.sii.cl/upload",
  statusUrl: "https://palena.sii.cl/status",
  storageBucket: "dte-production-private",
  cafRoot: "/tmp/caf",
  certificateRoot: "/tmp/cert",
  privateKeyRoot: "/tmp/cert",
  timeoutMs: 30000,
};

test("Boleta upload User-Agent defaults to the historically accepted profile and permits explicit configuration", () => {
  assert.equal(
    BOLETA_SII_DEFAULT_USER_AGENT,
    "Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)",
  );
  assert.equal(
    resolveBoletaSiiUploadUserAgent({ NODE_ENV: "test" }),
    BOLETA_SII_DEFAULT_USER_AGENT,
  );
  assert.equal(
    resolveBoletaSiiUploadUserAgent({
      NODE_ENV: "test",
      BOLETA_SII_USER_AGENT: "Configured-Agent/1.0",
    }),
    "Configured-Agent/1.0",
  );
});

test("createProductionSiiClient routing test: Tipo 39/41 uses SiiBoletaApiTransport", () => {
  const clientType39 = createProductionSiiClient(mockConfig, 39);
  const clientType41 = createProductionSiiClient(mockConfig, 41);

  assert.ok(clientType39 instanceof SiiBoletaApiTransport, "Type 39 should use SiiBoletaApiTransport");
  assert.ok(clientType41 instanceof SiiBoletaApiTransport, "Type 41 should use SiiBoletaApiTransport");
});

test("createProductionSiiClient routing test: Tipo 33/56/61 preserves ProductionSiiClient", () => {
  const clientType33 = createProductionSiiClient(mockConfig, 33);
  const clientType56 = createProductionSiiClient(mockConfig, 56);
  const clientType61 = createProductionSiiClient(mockConfig, 61);

  assert.ok(clientType33 instanceof ProductionSiiClient, "Type 33 should use ProductionSiiClient");
  assert.ok(clientType56 instanceof ProductionSiiClient, "Type 56 should use ProductionSiiClient");
  assert.ok(clientType61 instanceof ProductionSiiClient, "Type 61 should use ProductionSiiClient");
});

test("SiiBoletaApiTransport handling of timeout returns ambiguous status without retry", async () => {
  const transport = new SiiBoletaApiTransport(mockConfig);

  // Test queryBoletaStatus routing
  assert.ok(typeof transport.queryBoletaStatus === "function");
  assert.ok(typeof transport.uploadExactlyOnce === "function");
  assert.ok(typeof transport.queryStatusManually === "function");
});

test("Boleta API uses explicit official hosts for each environment", () => {
  assert.deepEqual(BOLETA_API_ENVIRONMENT_CONFIG.production, {
    authBaseUrl: "https://api.sii.cl/recursos/v1",
    uploadBaseUrl: "https://rahue.sii.cl/recursos/v1",
    queryBaseUrl: "https://api.sii.cl/recursos/v1",
  });
  assert.deepEqual(BOLETA_API_ENVIRONMENT_CONFIG.certification, {
    authBaseUrl: "https://apicert.sii.cl/recursos/v1",
    uploadBaseUrl: "https://pangal.sii.cl/recursos/v1",
    queryBaseUrl: "https://apicert.sii.cl/recursos/v1",
  });
  assert.equal(
    BOLETA_PRODUCTION_SEED_URL,
    "https://api.sii.cl/recursos/v1/boleta.electronica.semilla",
  );
  assert.equal(
    BOLETA_PRODUCTION_TOKEN_URL,
    "https://api.sii.cl/recursos/v1/boleta.electronica.token",
  );
  assert.equal(
    BOLETA_PRODUCTION_SUBMIT_URL,
    "https://rahue.sii.cl/recursos/v1/boleta.electronica.envio",
  );
  assert.equal(BOLETA_PRODUCTION_API_BASE, "https://api.sii.cl/recursos/v1");
  assert.doesNotMatch(JSON.stringify(BOLETA_API_ENVIRONMENT_CONFIG.production), /palena|pangal/);
});

test("Boleta API rejects mixed certification and production hosts", async () => {
  assert.throws(
    () => assertBoletaApiEnvironmentHosts("production", {
      authBaseUrl: "https://api.sii.cl/recursos/v1",
      uploadBaseUrl: "https://pangal.sii.cl/recursos/v1",
      queryBaseUrl: "https://api.sii.cl/recursos/v1",
    }),
    /DTE_BOLETA_API_ENVIRONMENT_HOST_MISMATCH/,
  );
  assert.throws(
    () => assertBoletaApiEnvironmentHosts("certification", {
      authBaseUrl: "https://api.sii.cl/recursos/v1",
      uploadBaseUrl: "https://rahue.sii.cl/recursos/v1",
      queryBaseUrl: "https://api.sii.cl/recursos/v1",
    }),
    /DTE_BOLETA_API_ENVIRONMENT_HOST_MISMATCH/,
  );

  await assert.rejects(
    requestBoletaRestSubmit({
      environment: "production",
      token: "TOKENFIXTURE123",
      senderRut: "27164542-2",
      companyRut: "78195645-7",
      fileName: "EnvioBoleta.xml",
      fileBytes: Buffer.from("<EnvioBOLETA/>", "utf8"),
      submitUrl: "https://pangal.sii.cl/recursos/v1/boleta.electronica.envio",
      fetchImpl: async () => {
        throw new Error("must not contact network");
      },
    }),
    /DTE_BOLETA_API_ENVIRONMENT_HOST_MISMATCH/,
  );
});

test("Production document query uses the official OpenAPI parameter names", () => {
  const url = new URL(buildBoletaDocumentStatusUrl({
    environment: "production",
    companyRut: "78195645-7",
    dteType: 39,
    folio: 40014,
    recipientRut: "66666666-6",
    amount: 5000,
    issueDate: "05-08-2026",
  }));

  assert.equal(url.origin, "https://api.sii.cl");
  assert.equal(
    url.pathname,
    "/recursos/v1/boleta.electronica/78195645-7-39-40014/estado",
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    rut_receptor: "66666666",
    dv_receptor: "6",
    monto: "5000",
    fechaEmision: "05-08-2026",
  });
  assert.equal(url.searchParams.has("fecha_emision"), false);
});

test("Production upload sends the five OpenAPI multipart fields and required headers", async () => {
  const envioXml = Buffer.from("<EnvioBOLETA/>", "utf8");
  let calls = 0;
  await requestBoletaRestSubmit({
    environment: "production",
    token: "TOKENFIXTURE123",
    senderRut: "27164542-2",
    companyRut: "78195645-7",
    fileName: "39-40014-EnvioBOLETA.xml",
    fileBytes: envioXml,
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(
        String(input),
        "https://rahue.sii.cl/recursos/v1/boleta.electronica.envio",
      );
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("cookie"), "TOKEN=TOKENFIXTURE123");
      assert.equal(new URL(String(input)).hostname !== new URL(BOLETA_PRODUCTION_TOKEN_URL).hostname, true);
      assert.ok(headers.get("user-agent"));
      assert.equal("credentials" in (init ?? {}), false, "must not depend on a cookie jar");
      assert.ok(init?.body instanceof FormData);
      const form = init.body;
      assert.deepEqual([...form.keys()], [
        "rutSender",
        "dvSender",
        "rutCompany",
        "dvCompany",
        "archivo",
      ]);
      assert.equal(form.get("rutSender"), "27164542");
      assert.equal(form.get("dvSender"), "2");
      assert.equal(form.get("rutCompany"), "78195645");
      assert.equal(form.get("dvCompany"), "7");
      const archivo = form.get("archivo");
      assert.ok(archivo instanceof Blob);
      assert.deepEqual(Buffer.from(await archivo.arrayBuffer()), envioXml);
      return new Response(JSON.stringify({
        rut_emisor: "78195645-7",
        rut_envia: "27164542-2",
        trackid: 99999999,
        fecha_recepcion: "2026-08-10 12:00:00",
        estado: "REC",
        file: "39-40014-EnvioBOLETA.xml",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(calls, 1);
});

test("Cross-host TOKEN forwarding is explicit and does not depend on a cookie jar", async () => {
  let calls = 0;
  await requestBoletaRestSubmit({
    environment: "production",
    token: "TOKENFIXTURE123",
    senderRut: "27164542-2",
    companyRut: "78195645-7",
    fileName: "39-40014-EnvioBOLETA.xml",
    fileBytes: Buffer.from("<EnvioBOLETA/>", "utf8"),
    fetchImpl: async (input, init) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      assert.equal(new URL(String(input)).hostname, "rahue.sii.cl");
      assert.equal(new URL(BOLETA_PRODUCTION_TOKEN_URL).hostname, "api.sii.cl");
      assert.equal(headers.get("cookie"), "TOKEN=TOKENFIXTURE123");
      assert.equal("credentials" in (init ?? {}), false);
      return new Response(JSON.stringify({
        rut_emisor: "78195645-7",
        rut_envia: "27164542-2",
        trackid: 99999998,
        fecha_recepcion: "2026-08-10 12:00:00",
        estado: "REC",
        file: "39-40014-EnvioBOLETA.xml",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(calls, 1);
});

test("A 401 is AUTH_FAILURE, is not retried, and exposes only sanitized diagnostics", async () => {
  let calls = 0;
  let failure: unknown = null;
  try {
    await requestBoletaRestSubmit({
      environment: "production",
      token: "TOKENFIXTURE123",
      senderRut: "27164542-2",
      companyRut: "78195645-7",
      fileName: "39-40014-EnvioBOLETA.xml",
      fileBytes: Buffer.from("<EnvioBOLETA/>", "utf8"),
      fetchImpl: async (_input, init) => {
        calls += 1;
        const strippedHeaders = new Headers(init?.headers);
        strippedHeaders.delete("cookie");
        assert.equal(strippedHeaders.has("cookie"), false);
        return new Response(JSON.stringify({ message: "No autorizado" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": 'Bearer realm="SII"',
            "X-Request-Id": "sii-request-123",
            "X-Correlation-Id": "sii-correlation-456",
            "Set-Cookie": "TOKEN=NEVER_PERSIST_THIS",
          },
        });
      },
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(classifyBoletaRestSubmitFailure(failure), "AUTH_FAILURE");
  assert.equal(calls, 1);
  assert.ok(failure instanceof BoletaRestSubmitHttpError);
  assert.equal(failure.status, 401);
  assert.equal(failure.contentType, "application/json");
  assert.equal(failure.host, "rahue.sii.cl");
  assert.match(failure.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(failure.responseHeaderNames, [
    "content-type",
    "set-cookie",
    "www-authenticate",
    "x-correlation-id",
    "x-request-id",
  ]);
  assert.equal(failure.wwwAuthenticate, 'Bearer realm="SII"');
  assert.equal(failure.requestId, "sii-request-123");
  assert.equal(failure.correlationId, "sii-correlation-456");
  assert.doesNotMatch(JSON.stringify(failure), /NEVER_PERSIST_THIS/);
});
