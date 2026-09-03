import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const ts = require("typescript");
const originalResolve = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];

Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = resolve(repoRoot, request.slice(2));
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const routePath = resolve(
  repoRoot,
  "app/api/appointments/payment-instructions/route.ts",
);
const supabasePath = resolve(repoRoot, "lib/supabaseAdmin.ts");
const accessPath = resolve(repoRoot, "lib/api/appointmentAccess.ts");
const validatorsPath = resolve(repoRoot, "lib/api/validators.ts");
const configPath = resolve(repoRoot, "services/payments/payment-config.ts");
const readinessPath = resolve(
  repoRoot,
  "services/payments/provider-readiness.ts",
);

function installMock(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

function builderFor(table, resolveQuery, queries) {
  const state = { table, eq: {}, in: {}, limit: null };
  queries.push(state);
  const builder = {
    select() {
      return builder;
    },
    eq(column, value) {
      state.eq[column] = value;
      return builder;
    },
    in(column, values) {
      state.in[column] = values;
      return builder;
    },
    order() {
      return builder;
    },
    limit(value) {
      state.limit = value;
      return builder;
    },
    maybeSingle() {
      return builder;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(resolveQuery(state)).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function bankConfig(tenantId) {
  const suffix = tenantId.endsWith("a") ? "A" : "B";
  return {
    tenantId,
    manualReady: true,
    bankName: `Banco ${suffix}`,
    bankAccountType: "Corriente",
    bankAccountNumber: `ACCOUNT-${suffix}`,
    bankAccountHolder: `Empresa ${suffix}`,
    bankRut: "78195645-7",
    bankEmail: `pagos-${suffix.toLowerCase()}@example.test`,
  };
}

async function requestInstructions({
  appointmentTenant,
  suppliedToken,
  expectedToken,
  manualIntent = true,
  manualReady = true,
}) {
  const appointmentId = "10000000-0000-4000-8000-000000000059";
  const queries = [];
  const configLoads = [];
  const config = { ...bankConfig(appointmentTenant), manualReady };
  const supabaseAdmin = {
    from(table) {
      return builderFor(
        table,
        (query) => {
          if (table === "appointments") {
            return query.eq.id === appointmentId
              ? {
                  data: {
                    id: appointmentId,
                    tenant_id: appointmentTenant,
                    manage_token: null,
                    manage_token_hash: "hash",
                  },
                  error: null,
                }
              : { data: null, error: null };
          }
          if (table === "payment_intents") {
            const exactScope =
              query.eq.tenant_id === appointmentTenant &&
              query.eq.appointment_id === appointmentId &&
              query.eq.provider === "manual" &&
              query.in.status?.includes("pending") &&
              query.limit === 1;
            return {
              data: manualIntent && exactScope ? { id: "manual-intent" } : null,
              error: null,
            };
          }
          throw new Error(`unexpected table: ${table}`);
        },
        queries,
      );
    },
  };

  installMock(supabasePath, { supabaseAdmin });
  installMock(accessPath, {
    authorizeAppointmentActor: async ({ req, appointment }) => ({
      ok:
        appointment.tenant_id === appointmentTenant &&
        req.headers.get("x-manage-token") === expectedToken,
    }),
  });
  installMock(validatorsPath, { isUuid: () => true });
  installMock(configPath, {
    getTenantPaymentConfig: async (tenantId) => {
      configLoads.push(tenantId);
      return config;
    },
  });
  installMock(readinessPath, {
    evaluateTenantPaymentReadiness: (value) => ({
      methods: { manual: { ready: value.manualReady === true } },
    }),
  });
  installMock(require.resolve("next/server"), {
    NextResponse: { json: (body, init) => Response.json(body, init) },
  });
  delete require.cache[routePath];
  const { GET } = require(routePath);
  const response = await GET(
    new Request(
      `http://localhost/api/appointments/payment-instructions?appointmentId=${appointmentId}`,
      { headers: { "x-manage-token": suppliedToken } },
    ),
  );
  return {
    response,
    body: await response.json(),
    queries,
    configLoads,
    config,
  };
}

test("manual payment instructions return exactly six safe fields after authorization", async () => {
  const tenantA = "20000000-0000-4000-8000-00000000000a";
  const tokenA = "a".repeat(48);
  const result = await requestInstructions({
    appointmentTenant: tenantA,
    suppliedToken: tokenA,
    expectedToken: tokenA,
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(Object.keys(result.body.instructions).sort(), [
    "bankAccountHolder",
    "bankAccountNumber",
    "bankAccountType",
    "bankEmail",
    "bankName",
    "bankRut",
  ]);
  assert.deepEqual(result.configLoads, [tenantA]);
  assert.equal(result.body.instructions.bankName, "Banco A");
  assert.equal(result.response.headers.get("cache-control"), "private, no-store");
});

test("invalid token and non-manual or incomplete payments return no bank data", async () => {
  const tenantA = "20000000-0000-4000-8000-00000000000a";
  const validToken = "a".repeat(48);
  const invalid = await requestInstructions({
    appointmentTenant: tenantA,
    suppliedToken: "x".repeat(48),
    expectedToken: validToken,
  });
  assert.equal(invalid.response.status, 404);
  assert.equal("instructions" in invalid.body, false);
  assert.deepEqual(invalid.configLoads, []);

  const noIntent = await requestInstructions({
    appointmentTenant: tenantA,
    suppliedToken: validToken,
    expectedToken: validToken,
    manualIntent: false,
  });
  assert.equal(noIntent.response.status, 404);
  assert.equal("instructions" in noIntent.body, false);

  const incomplete = await requestInstructions({
    appointmentTenant: tenantA,
    suppliedToken: validToken,
    expectedToken: validToken,
    manualReady: false,
  });
  assert.equal(incomplete.response.status, 404);
  assert.equal("instructions" in incomplete.body, false);
});

test("tenant B instructions are never loaded from tenant A", async () => {
  const tenantB = "20000000-0000-4000-8000-00000000000b";
  const tokenA = "a".repeat(48);
  const tokenB = "b".repeat(48);
  const crossTenant = await requestInstructions({
    appointmentTenant: tenantB,
    suppliedToken: tokenA,
    expectedToken: tokenB,
  });
  assert.equal(crossTenant.response.status, 404);
  assert.equal("instructions" in crossTenant.body, false);
  assert.deepEqual(crossTenant.configLoads, []);

  const result = await requestInstructions({
    appointmentTenant: tenantB,
    suppliedToken: tokenB,
    expectedToken: tokenB,
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.configLoads, [tenantB]);
  assert.equal(result.body.instructions.bankName, "Banco B");
  assert.notEqual(result.body.instructions.bankName, "Banco A");
});

test("manual result page uses the protected endpoint and never reads settings directly", () => {
  const page = readFileSync("app/reservar/resultado/page.tsx", "utf8");
  assert.match(page, /\/api\/appointments\/payment-instructions\?appointmentId=/);
  assert.match(page, /headers: \{ "x-manage-token": manageToken \}/);
  assert.doesNotMatch(page, /tenant_payment_settings|mercadopago_access_token|webpay_api_key|khipu_secret/);
});

test.after(() => {
  Module._resolveFilename = originalResolve;
  if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
  else delete require.extensions[".ts"];
});
