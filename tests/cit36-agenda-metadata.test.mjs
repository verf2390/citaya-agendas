import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(new URL("..", import.meta.url).pathname);
let requestHeaders = {};
let failing = false;
let calls = 0;

const rows = new Map([
  ["rg-spa", { name: "R&G SPA", lifecycle_status: "active" }],
  ["demo", { name: "Demo", lifecycle_status: "active" }],
  ["archived", { name: "Antiguo", lifecycle_status: "archived" }],
]);

const supabaseServer = {
  from(table) {
    assert.equal(table, "tenants");
    const filters = {};
    return {
      select(columns) { assert.equal(columns, "name"); return this; },
      eq(key, value) { filters[key] = value; return this; },
      async maybeSingle() {
        calls++;
        if (failing) return { data: null, error: new Error("database unavailable") };
        const row = rows.get(filters.slug);
        return {
          data: row?.lifecycle_status === filters.lifecycle_status ? row : null,
          error: null,
        };
      },
    };
  },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = resolve(root, request.slice(2));
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "next/headers") {
    return { headers: async () => ({ get: (key) => requestHeaders[key] ?? null }) };
  }
  if (request === "@/lib/supabaseServer") return { supabaseServer };
  if (request === "react/jsx-runtime") return { Fragment: Symbol("Fragment"), jsx: () => null };
  return originalLoad.call(this, request, parent, isMain);
};

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    module._compile(output.outputText, filename);
  };
}

const { generateMetadata } = require(resolve(root, "app/admin/agenda/layout.tsx"));
const title = async () => (await generateMetadata()).title.absolute;

test("cada subdominio muestra el nombre de su propio tenant", async () => {
  requestHeaders = { host: "rg-spa.citaya.online" };
  assert.equal(await title(), "Agenda Citas | R&G SPA");
  requestHeaders = { host: "demo.citaya.online" };
  assert.equal(await title(), "Agenda Citas | Demo");
});

test("se respeta el hostname del proxy usado en autorización", async () => {
  requestHeaders = { host: "app.citaya.online", "x-forwarded-host": "rg-spa.citaya.online, internal" };
  assert.equal(await title(), "Agenda Citas | R&G SPA");
});

test("host reservado o ajeno no consulta el tenant", async () => {
  const previous = calls;
  for (const host of ["citaya.online", "app.citaya.online", "localhost:3000", "demo.example.com"]) {
    requestHeaders = { host };
    assert.equal(await title(), "Agenda | Citaya");
  }
  assert.equal(calls, previous);
});

test("tenant inexistente o archivado no exhibe marcas ajenas", async () => {
  for (const host of ["inexistente.citaya.online", "archived.citaya.online"]) {
    requestHeaders = { host };
    assert.equal(await title(), "Agenda | Citaya");
  }
});

test("error en Supabase muestra título neutro", async () => {
  requestHeaders = { host: "rg-spa.citaya.online" };
  failing = true;
  try { assert.equal(await title(), "Agenda | Citaya"); }
  finally { failing = false; }
});
