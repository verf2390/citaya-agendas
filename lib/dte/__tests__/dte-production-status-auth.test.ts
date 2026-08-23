import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  BOLETA_API_ENVIRONMENT_CONFIG,
} from "../certification/boleta39-rest-api";
import { SiiBoletaApiTransport } from "../production/boleta-api-transport";
import type { ProductionRuntimeConfig } from "../production/config";
import {
  ProductionSiiClient,
  type ProductionSiiMilestone,
} from "../production/sii-client";
import {
  requestProductionBoletaStatusToken,
  requestProductionStatusTokenForDteType,
} from "../production/status-auth";
import type { ProductionTenantSettings } from "../production/types";

const REST_TOKEN = "BOLETA_REST_STATUS_TOKEN_SECRET";
const seedXml =
  "<RESPUESTA><RESP_HDR><ESTADO>00</ESTADO></RESP_HDR>" +
  "<RESP_BODY><SEMILLA>123456</SEMILLA></RESP_BODY></RESPUESTA>";
const tokenXml =
  "<RESPUESTA><RESP_HDR><ESTADO>00</ESTADO></RESP_HDR>" +
  `<RESP_BODY><TOKEN>${REST_TOKEN}</TOKEN></RESP_BODY></RESPUESTA>`;

function statusQueryConfig(): ProductionRuntimeConfig {
  return {
    enabled: true,
    environment: "production",
    signingMode: "production",
    seedUrl: "https://seed.example.invalid",
    tokenUrl: "https://token.example.invalid",
    uploadUrl: "https://upload.example.invalid",
    statusUrl: "https://status.example.invalid",
    storageBucket: "dte-production-private",
    cafRoot: "/tmp/citaya-status-test/caf",
    certificateRoot: "/tmp/citaya-status-test/certificate",
    privateKeyRoot: "/tmp/citaya-status-test/key",
    timeoutMs: 2_000,
  };
}

async function queryDte33Status(rawResponse: string, token = "STATUS_TOKEN_SECRET") {
  const milestones: string[] = [];
  const client = new ProductionSiiClient(
    statusQueryConfig(),
    async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("cookie"), `TOKEN=${token}`);
      return new Response(rawResponse, {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    },
  );
  const result = await client.queryStatusManually({
    trackId: "1234567890",
    token,
    milestone: async (event) => {
      milestones.push(event);
    },
  });
  assert.deepEqual(milestones, ["status_before_fetch", "status_after_fetch"]);
  return result;
}

test("DTE 33 manual status keeps known SII states canonical", async () => {
  const result = await queryDte33Status(
    "<RESPUESTA><ESTADO>EPR</ESTADO><GLOSA>Procesado</GLOSA></RESPUESTA>",
  );
  assert.equal(result.siiStatus, "accepted");
  assert.equal(result.responseSafe.siiStatus, "accepted");
  assert.equal("responseBytes" in result, false);
});

test("DTE 33 manual status exposes only a short allowlisted unknown code", async () => {
  const result = await queryDte33Status(
    "<RESPUESTA><ESTADO>NO_SE</ESTADO><GLOSA>Sin clasificar</GLOSA></RESPUESTA>",
  );
  assert.equal(result.siiStatus, "DTE_SII_STATUS_UNKNOWN_NO_SE");
  assert.equal(
    result.responseSafe.siiStatus,
    "DTE_SII_STATUS_UNKNOWN_NO_SE",
  );
  assert.equal("responseBytes" in result, false);
});

test("DTE 33 manual status collapses unsafe unknown content without leakage", async () => {
  const token = "STATUS_TOKEN_SECRET";
  const sensitive = [
    token,
    "COOKIE_SECRET",
    "BODY_XML_SECRET",
    "PRIVATE KEY",
    "CERTIFICATE",
    "12.345.678-5",
    "https://sensitive.example.invalid/status?token=secret",
    "Error: sensitive stack",
  ];
  const rawResponse =
    `<RESPUESTA><ESTADO>TOKEN=${token}</ESTADO>` +
    `<GLOSA>${sensitive.join(" ")}</GLOSA></RESPUESTA>`;
  const result = await queryDte33Status(rawResponse, token);
  assert.equal(result.siiStatus, "DTE_SII_STATUS_UNKNOWN");
  assert.equal(result.responseSafe.siiStatus, "DTE_SII_STATUS_UNKNOWN");
  assert.equal("responseBytes" in result, false);

  const exposed = JSON.stringify(result);
  for (const value of sensitive) {
    assert.equal(exposed.includes(value), false, value);
  }
  assert.equal(exposed.includes(rawResponse), false);
});

function signingFixture(): {
  root: string;
  config: ProductionRuntimeConfig;
  settings: ProductionTenantSettings;
} {
  const root = mkdtempSync(join(tmpdir(), "citaya-status-auth-"));
  const certificatePath = join(root, "certificate.pem");
  const privateKeyPath = join(root, "private-key.pem");
  const generated = spawnSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=Citaya Status Auth Test",
    "-keyout",
    privateKeyPath,
    "-out",
    certificatePath,
    "-days",
    "2",
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, "openssl fixture generation must succeed");
  chmodSync(privateKeyPath, 0o600);

  return {
    root,
    config: {
      enabled: true,
      environment: "production",
      signingMode: "production",
      seedUrl: "https://palena.sii.cl/DTEWS/CrSeed.jws",
      tokenUrl: "https://palena.sii.cl/DTEWS/GetTokenFromSeed.jws",
      uploadUrl: "https://palena.sii.cl/cgi_dte/UPL/DTEUpload",
      statusUrl: "https://palena.sii.cl/DTEWS/QueryEstUp.jws",
      storageBucket: "dte-production-private",
      cafRoot: root,
      certificateRoot: root,
      privateKeyRoot: root,
      timeoutMs: 2_000,
    },
    settings: {
      tenantId: "tenant-status-auth",
      enabled: true,
      issuer: {
        rut: "78195645-7",
        legalName: "R&G SpA",
        businessActivity: "Servicios digitales",
        businessActivityCode: "620200",
        address: "Regimiento Arica 301",
        commune: "Coquimbo",
        city: "Coquimbo",
        resolutionDate: "2026-07-01",
        resolutionNumber: "80",
        siiOffice: "LA SERENA",
      },
      senderRut: "78195645-7",
      certificatePath,
      privateKeyPath,
      certificateValidFrom: "2026-01-01T00:00:00.000Z",
      certificateValidTo: "2030-01-01T00:00:00.000Z",
      autoEmailDelivery: false,
    },
  };
}

test("manual status auth routes DTE 39/41 to Boleta REST and DTE 33 to SOAP", async () => {
  const fixture = signingFixture();
  try {
    const restBase = BOLETA_API_ENVIRONMENT_CONFIG.production.authBaseUrl;
    for (const dteType of [39, 41]) {
      const calls: Array<{ url: string; method: string }> = [];
      const milestones: string[] = [];
      let signedSeedSeen = false;
      const token = await requestProductionStatusTokenForDteType({
        config: fixture.config,
        settings: fixture.settings,
        dteType,
        milestone: async (event) => {
          milestones.push(event);
        },
        fetchImpl: async (input, init) => {
          const url = String(input);
          const method = init?.method ?? "GET";
          calls.push({ url, method });
          if (url.endsWith("/boleta.electronica.semilla")) {
            return new Response(seedXml, {
              status: 200,
              headers: { "Content-Type": "application/xml" },
            });
          }
          assert.equal(url, `${restBase}/boleta.electronica.token`);
          signedSeedSeen =
            method === "POST" &&
            String(init?.body).includes("<Signature");
          return new Response(tokenXml, {
            status: 200,
            headers: { "Content-Type": "application/xml" },
          });
        },
      });

      assert.equal(token, REST_TOKEN);
      assert.deepEqual(calls, [
        { url: `${restBase}/boleta.electronica.semilla`, method: "GET" },
        { url: `${restBase}/boleta.electronica.token`, method: "POST" },
      ]);
      assert.equal(signedSeedSeen, true);
      assert.deepEqual(milestones, [
        "seed_before_fetch",
        "seed_after_fetch",
        "token_before_fetch",
        "token_after_fetch",
      ]);
    }

    const soapCalls: Array<{ url: string; method: string; isSoap: boolean }> = [];
    const soapMilestones: string[] = [];
    const soapToken = await requestProductionStatusTokenForDteType({
      config: fixture.config,
      settings: fixture.settings,
      dteType: 33,
      milestone: async (event) => {
        soapMilestones.push(event);
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        soapCalls.push({
          url,
          method: init?.method ?? "GET",
          isSoap: String(init?.body).includes("soapenv:Envelope"),
        });
        return new Response(
          url === fixture.config.seedUrl
            ? seedXml
            : tokenXml.replace(REST_TOKEN, "SOAP_STATUS_TOKEN"),
          { status: 200 },
        );
      },
    });

    assert.equal(soapToken, "SOAP_STATUS_TOKEN");
    assert.deepEqual(soapCalls, [
      { url: fixture.config.seedUrl, method: "POST", isSoap: true },
      { url: fixture.config.tokenUrl, method: "POST", isSoap: true },
    ]);
    assert.deepEqual(soapMilestones, [
      "seed_before_fetch",
      "seed_after_fetch",
      "token_before_fetch",
      "token_after_fetch",
    ]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Boleta REST status auth rejects seed/token safely without leaking response material", async () => {
  const fixture = signingFixture();
  try {
    const sensitive = [
      REST_TOKEN,
      "BODY_SECRET",
      "COOKIE_SECRET",
      "PRIVATE KEY",
      "CERTIFICATE",
      "https://",
    ];
    for (const rejectedStage of ["seed", "token"] as const) {
      let calls = 0;
      let failure: unknown;
      try {
        await requestProductionBoletaStatusToken({
          config: fixture.config,
          settings: fixture.settings,
          milestone: async () => undefined,
          fetchImpl: async () => {
            calls += 1;
            if (rejectedStage === "token" && calls === 1) {
              return new Response(seedXml, {
                status: 200,
                headers: { "Content-Type": "application/xml" },
              });
            }
            return new Response(
              "<RESPUESTA><ESTADO>01</ESTADO>" +
                "<GLOSA>BODY_SECRET COOKIE_SECRET PRIVATE KEY CERTIFICATE</GLOSA>" +
                "</RESPUESTA>",
              {
                status: 200,
                headers: { "Content-Type": "application/xml" },
              },
            );
          },
        });
      } catch (error) {
        failure = error;
      }

      assert.ok(failure instanceof Error);
      assert.equal(
        failure.message,
        rejectedStage === "seed"
          ? "BOLETA_REST_SEED_RESPONSE_INVALID"
          : "BOLETA_REST_TOKEN_RESPONSE_INVALID",
      );
      for (const value of sensitive) {
        assert.equal(
          failure.message.toLowerCase().includes(value.toLowerCase()),
          false,
        );
      }
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("DTE 39 passes the REST token to Track Cookie and never calls document status", async () => {
  const fixture = signingFixture();
  try {
    const milestones: string[] = [];
    let seedCalls = 0;
    let tokenCalls = 0;
    let trackCalls = 0;
    let documentCalls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/boleta.electronica.semilla")) {
        seedCalls += 1;
        return new Response(seedXml, {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      if (url.endsWith("/boleta.electronica.token")) {
        tokenCalls += 1;
        return new Response(tokenXml, {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      if (/\/estado(?:\?|$)/.test(url)) {
        documentCalls += 1;
        return new Response("unauthorized", { status: 401 });
      }
      trackCalls += 1;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("cookie"), `TOKEN=${REST_TOKEN}`);
      return new Response(JSON.stringify({
        estado: "EPR",
        estadistica: [{
          tipo: 39,
          informados: 1,
          aceptados: 1,
          rechazados: 0,
          reparos: 0,
        }],
        detalle_rep_rech: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const milestone = async (event: ProductionSiiMilestone) => {
      milestones.push(event);
    };
    const token = await requestProductionStatusTokenForDteType({
      config: fixture.config,
      settings: fixture.settings,
      dteType: 39,
      milestone,
      fetchImpl,
    });
    const transport = new SiiBoletaApiTransport(
      fixture.config,
      "production",
      fetchImpl,
    );
    const result = await transport.queryStatusManually({
      trackId: "40016",
      token,
      companyRut: "78195645-7",
      document: {
        dteType: 39,
        folio: 40_016,
        recipientRut: "66666666-6",
        amount: 25_000,
        issueDate: "2026-08-10",
      },
      milestone,
    });

    assert.equal(result.siiStatus, "accepted");
    assert.deepEqual(
      { seedCalls, tokenCalls, trackCalls, documentCalls },
      { seedCalls: 1, tokenCalls: 1, trackCalls: 1, documentCalls: 0 },
    );
    assert.deepEqual(milestones, [
      "seed_before_fetch",
      "seed_after_fetch",
      "token_before_fetch",
      "token_after_fetch",
      "status_before_fetch",
      "status_after_fetch",
    ]);
    const safe = JSON.stringify(result.responseSafe).toLowerCase();
    for (const forbidden of [
      REST_TOKEN.toLowerCase(),
      "cookie",
      "signature",
      "private key",
      "certificate",
      "pem",
      "https://",
    ]) {
      assert.equal(safe.includes(forbidden), false);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
