import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const routePath = resolve(
  repoRoot,
  "app/api/admin/platform/tenants/route.ts",
);
const nextServerPath = require.resolve("next/server");
const requireAdminPath = resolve(repoRoot, "lib/api/requireTenantAdmin.ts");
const supabasePath = resolve(repoRoot, "lib/supabaseAdmin.ts");
const operationalPath = resolve(
  repoRoot,
  "lib/tenant/operational-mode.mjs",
);
const routeSource = readFileSync(routePath, "utf8");
const originalResolve = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];

const actorId = "67000000-0000-4000-8000-000000000001";
const attackerActorId = "67000000-0000-4000-8000-000000000099";
const requestId = "67000000-0000-4000-8000-000000000101";
const ownerUserId = "67000000-0000-4000-8000-000000000002";
const tenantId = "67000000-0000-4000-8000-000000000201";
const validBody = {
  requestId,
  ownerUserId,
  slug: " tenant-a ",
  name: " Tenant A ",
  contactEmail: " owner@example.test ",
  phoneDisplay: " +56 9 1111 1111 ",
  whatsapp: null,
  address: " Address A ",
  city: " City A ",
};

Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = resolve(repoRoot, request.slice(2));
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = (module, filename) => {
  const typescript = require("typescript");
  const output = typescript.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

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

async function runPost({
  body = validBody,
  auth = { ok: true, userId: actorId },
  rpc = {
    data: { tenantId, requestId, created: true, internal: "do-not-return" },
    error: null,
  },
  invalidJson = false,
} = {}) {
  const events = [];
  const rpcCalls = [];

  installMock(nextServerPath, {
    NextResponse: {
      json(responseBody, options = {}) {
        return { body: responseBody, status: options.status ?? 200 };
      },
    },
  });
  installMock(requireAdminPath, {
    requirePlatformAdmin: async () => {
      events.push("auth");
      return auth;
    },
  });
  installMock(supabasePath, {
    supabaseAdmin: {
      from(table) {
        throw new Error(`unexpected direct table access: ${table}`);
      },
      async rpc(name, args) {
        events.push("rpc");
        rpcCalls.push({ name, args });
        return rpc;
      },
    },
  });
  installMock(operationalPath, {
    resolveTenantOperationalCapabilities: () => ({}),
  });

  delete require.cache[routePath];
  const { POST } = require(routePath);
  const response = await POST({
    json: async () => {
      events.push("json");
      if (invalidJson) throw new SyntaxError("invalid JSON secret");
      return body;
    },
  });
  return { events, response, rpcCalls };
}

test.after(() => {
  Module._resolveFilename = originalResolve;
  if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
  else delete require.extensions[".ts"];
  for (const modulePath of [
    routePath,
    nextServerPath,
    requireAdminPath,
    supabasePath,
    operationalPath,
  ]) {
    delete require.cache[modulePath];
  }
});

test("CIT-67 POST has one authenticated RPC-only provisioning boundary", () => {
  const postStart = routeSource.indexOf("export async function POST");
  const postEnd = routeSource.indexOf("export async function PATCH", postStart);
  const postSource = routeSource.slice(postStart, postEnd);
  const authIndex = postSource.indexOf("requirePlatformAdmin(req)");
  const jsonIndex = postSource.indexOf("req.json()");
  const rpcIndex = postSource.indexOf('rpc("provision_tenant"');

  assert.ok(postStart >= 0);
  assert.ok(authIndex >= 0);
  assert.ok(jsonIndex > authIndex);
  assert.ok(rpcIndex > jsonIndex);
  assert.match(postSource, /p_actor_user_id: auth\.userId/);
  assert.doesNotMatch(postSource, /body\.(?:actorUserId|actor_user_id)/);
  assert.doesNotMatch(postSource, /\.from\(|\binsert\b|\bupsert\b/i);
  assert.equal((postSource.match(/\.rpc\(/g) ?? []).length, 1);
  assert.doesNotMatch(
    postSource,
    /sii|caf|folio|certificate|certificado|fetch\(|https?:\/\//i,
  );
});

test("CIT-67 POST authenticates first and binds actor to auth.userId", async () => {
  const result = await runPost({
    body: {
      ...validBody,
      actorUserId: attackerActorId,
      actor_user_id: attackerActorId,
    },
  });
  assert.deepEqual(result.events, ["auth", "json", "rpc"]);
  assert.equal(result.rpcCalls.length, 1);
  assert.deepEqual(result.rpcCalls[0], {
    name: "provision_tenant",
    args: {
      p_request_id: requestId,
      p_actor_user_id: actorId,
      p_owner_user_id: ownerUserId,
      p_slug: "tenant-a",
      p_name: "Tenant A",
      p_contact_email: "owner@example.test",
      p_phone_display: "+56 9 1111 1111",
      p_whatsapp: null,
      p_address: "Address A",
      p_city: "City A",
    },
  });
  assert.equal(result.response.status, 201);
  assert.deepEqual(result.response.body, {
    ok: true,
    tenantId,
    requestId,
    created: true,
  });
  assert.deepEqual(Object.keys(result.response.body).sort(), [
    "created",
    "ok",
    "requestId",
    "tenantId",
  ]);

  const denied = await runPost({
    auth: { ok: false, status: 401, error: "Unauthorized" },
  });
  assert.equal(denied.response.status, 401);
  assert.deepEqual(denied.events, ["auth"]);
  assert.equal(denied.rpcCalls.length, 0);
});

test("CIT-67 POST returns 200 for an idempotent replay", async () => {
  const result = await runPost({
    rpc: { data: { tenantId, requestId, created: false }, error: null },
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.response.body, {
    ok: true,
    tenantId,
    requestId,
    created: false,
  });
});

test("CIT-67 POST rejects malformed input before provisioning", async () => {
  const scenarios = [
    { name: "invalid JSON", invalidJson: true },
    { name: "non-object", body: [] },
    { name: "missing requestId", body: { ...validBody, requestId: undefined } },
    { name: "invalid requestId", body: { ...validBody, requestId: "invalid" } },
    { name: "missing owner", body: { ...validBody, ownerUserId: undefined } },
    { name: "invalid owner", body: { ...validBody, ownerUserId: "invalid" } },
    { name: "empty slug", body: { ...validBody, slug: "   " } },
    { name: "empty name", body: { ...validBody, name: "   " } },
    ...[
      "contactEmail",
      "phoneDisplay",
      "whatsapp",
      "address",
      "city",
    ].map((field) => ({
      name: `non-string optional ${field}`,
      body: { ...validBody, [field]: 123 },
    })),
  ];

  for (const scenario of scenarios) {
    const result = await runPost(scenario);
    assert.equal(result.response.status, 400, scenario.name);
    assert.deepEqual(result.response.body, {
      ok: false,
      error: "Solicitud inválida",
    }, scenario.name);
    assert.equal(result.rpcCalls.length, 0, scenario.name);
    assert.equal(result.events[0], "auth", scenario.name);
  }
});

test("CIT-67 POST maps known RPC failures without leaking internals", async () => {
  const scenarios = [
    ["TENANT_SLUG_INVALID", 400],
    ["TENANT_SLUG_RESERVED", 400],
    ["TENANT_NAME_REQUIRED", 400],
    ["PROVISIONING_REQUEST_ID_REQUIRED", 400],
    ["PROVISIONING_OWNER_REQUIRED", 400],
    ["PLATFORM_SUPER_ADMIN_REQUIRED", 403],
    ["OWNER_USER_NOT_FOUND", 404],
    ["OWNER_EMAIL_REQUIRED", 409],
    ["TENANT_SLUG_ALREADY_EXISTS", 409],
    ["PROVISIONING_REQUEST_PAYLOAD_MISMATCH", 409],
  ];

  for (const [code, status] of scenarios) {
    const result = await runPost({
      rpc: {
        data: null,
        error: {
          message: `Postgres error: ${code}`,
          details: "private database details",
          hint: "private hint",
          code: "P0001",
        },
      },
    });
    assert.equal(result.response.status, status, code);
    assert.doesNotMatch(
      JSON.stringify(result.response.body),
      /Postgres|private|P0001/i,
      code,
    );
  }
});

test("CIT-67 POST returns a generic 503 for unknown or malformed RPC output", async () => {
  for (const rpc of [
    {
      data: null,
      error: {
        message: "secret SQLERRM",
        details: "secret details",
        hint: "secret hint",
        code: "XX000",
      },
    },
    { data: { created: true, fingerprint: "secret" }, error: null },
  ]) {
    const result = await runPost({ rpc });
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.response.body, {
      ok: false,
      error: "No se pudo crear el tenant",
    });
  }
});

test("CIT-67 preserves authentication on GET and PATCH", async () => {
  const authCalls = [];
  installMock(nextServerPath, {
    NextResponse: {
      json(body, options = {}) {
        return { body, status: options.status ?? 200 };
      },
    },
  });
  installMock(requireAdminPath, {
    requirePlatformAdmin: async () => {
      authCalls.push("auth");
      return { ok: false, status: 401, error: "Unauthorized" };
    },
  });
  installMock(supabasePath, {
    supabaseAdmin: {
      from() {
        throw new Error("GET/PATCH accessed storage before auth");
      },
      rpc() {
        throw new Error("GET/PATCH called RPC before auth");
      },
    },
  });
  installMock(operationalPath, {
    resolveTenantOperationalCapabilities: () => ({}),
  });
  delete require.cache[routePath];
  const { GET, PATCH } = require(routePath);

  const getResponse = await GET({});
  const patchResponse = await PATCH({
    json: async () => {
      throw new Error("PATCH parsed JSON before auth");
    },
  });
  assert.equal(getResponse.status, 401);
  assert.equal(patchResponse.status, 401);
  assert.deepEqual(authCalls, ["auth", "auth"]);
});
