import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const originalResolve = Module._resolveFilename;

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
  });
  module._compile(output.outputText, filename);
};

const { getTenantSlugFromHostname } = require(
  resolve(repoRoot, "lib/tenant.ts"),
);
const { resolveTenantBySlug, resolveTenantFromHostname } = require(
  resolve(repoRoot, "lib/client/tenant-resolution.ts"),
);

const tenantResponse = () =>
  new Response(
    JSON.stringify({
      tenant: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "demo",
        name: "Demo",
        logo_url: null,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

test("demo.citaya.online resuelve el tenant demo", async () => {
  assert.equal(getTenantSlugFromHostname("demo.citaya.online"), "demo");
  const result = await resolveTenantFromHostname("demo.citaya.online", {
    fetchImpl: async () => tenantResponse(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.slug, "demo");
});

test("hostname con puerto conserva el subdominio", () => {
  assert.equal(getTenantSlugFromHostname("demo.citaya.online:443"), "demo");
});

test("rg-spa.citaya.online resuelve inequívocamente rg-spa", () => {
  assert.equal(getTenantSlugFromHostname("rg-spa.citaya.online"), "rg-spa");
});

test("localhost no se interpreta como tenant", () => {
  assert.equal(getTenantSlugFromHostname("localhost:3000"), null);
  assert.equal(getTenantSlugFromHostname("demo.localhost:3000"), null);
});

test("dominio desconocido falla cerrado", () => {
  assert.equal(getTenantSlugFromHostname("demo.example.com"), null);
  assert.equal(getTenantSlugFromHostname("citaya.online"), null);
});

test("error Supabase/API produce mensaje seguro y estado terminal", async () => {
  const result = await resolveTenantBySlug("demo", {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: "relation public.tenants does not exist; internal detail",
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "api_error");
  assert.doesNotMatch(result.message, /relation|internal detail/i);
  assert.match(result.message, /nuevamente/i);
});

test("API que no responde termina por timeout", async () => {
  const result = await resolveTenantBySlug("demo", {
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 10,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "api_error");
});

test("reserva pública acota sus loaders y ofrece Reintentar", () => {
  const source = readFileSync(resolve(repoRoot, "app/reservar/page.tsx"), "utf8");
  assert.match(source, /resolveTenantBySlug/);
  assert.match(source, /fetchWithClientTimeout/);
  assert.match(source, /finally\s*\{[\s\S]*setLoadingTenant\(false\)/);
  assert.match(source, /Reintentar/);
});

test("admin resuelve el tenant sin consultas directas desde el cliente", () => {
  for (const file of [
    "app/admin/customers/page.tsx",
    "app/admin/agenda/page.tsx",
    "app/admin/servicios/page.tsx",
  ]) {
    const source = readFileSync(resolve(repoRoot, file), "utf8");
    assert.match(source, /resolveTenantFromHostname/);
    assert.doesNotMatch(source, /\.from\("tenants"\)/);
    assert.match(source, /Reintentar/);
  }

  const billing = readFileSync(resolve(repoRoot, "app/admin/facturacion/page.tsx"), "utf8");
  const billingApi = readFileSync(resolve(repoRoot, "app/api/admin/dte-settings/route.ts"), "utf8");
  assert.match(billing, /adminFetch\("\/api\/admin\/dte-settings"/);
  assert.doesNotMatch(billing, /\.from\("tenants"\)/);
  assert.match(billing, /Reintentar/);
  assert.match(billingApi, /requireHostTenantAdmin/);
});

test("endpoint separa not-found de fallo Supabase sin filtrar mensajes SQL", () => {
  const source = readFileSync(
    resolve(repoRoot, "app/api/tenants/by-slug/route.ts"),
    "utf8",
  );
  assert.match(source, /\.maybeSingle\(\)/);
  assert.match(source, /Tenant lookup unavailable/);
  assert.match(source, /\{ status: 503 \}/);
  assert.doesNotMatch(source, /error\?\.message/);
});
