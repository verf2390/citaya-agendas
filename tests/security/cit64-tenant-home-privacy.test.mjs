import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as operational from "../../lib/tenant/operational-mode.mjs";

const ts = createRequire(import.meta.url)("typescript");
const source = readFileSync("app/tenants/[slug]/page.tsx", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
async function renderTenant(flags) {
  const tenant = { id: "tenant-a-id", slug: "tenant-a", name: "Public business", address: "PRIVATE STREET 123", city: "Santiago", phone_display: "+56987654321", show_address: true, show_phone: true, lifecycle_status: "active", operational_mode: "live", ...flags };
  const queries = [];
  const cjsModule = { exports: {} };
  const mockRequire = (name) => {
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" };
    if (name === "next/headers") return { headers: async () => new Headers({ host: "tenant-a.citaya.online" }) };
    if (name === "@/lib/tenant/operational-mode.mjs") return operational;
    if (name === "@/lib/supabaseServer") return { supabaseServer: { from(table) {
      const query = { table, filters: [], select(columns) { this.columns = columns; return this; }, eq(key, value) { this.filters.push([key, value]); return this; }, single() { return this; }, order() { return this; }, limit() { return this; }, then(accept, reject) { queries.push(this); return Promise.resolve({ data: table === "tenants" ? tenant : [], error: null }).then(accept, reject); } };
      return query;
    } } };
    if (name === "next/link" || name === "./DemoQuoteCard" || name === "@/components/tenant/LeaveReviewModal") return { __esModule: true, default: name };
    if (name.startsWith("@/components/")) return new Proxy({}, { get: (_, key) => String(key) });
    throw new Error(`Unexpected import ${name}`);
  };
  new Function("require", "module", "exports", compiled)(mockRequire, cjsModule, cjsModule.exports);
  const tree = await cjsModule.exports.default({ params: { slug: "tenant-a" } });
  assert.ok(queries[0].columns.includes("show_address_home"));
  assert.ok(queries[0].columns.includes("show_phone_home"));
  return JSON.stringify(tree);
}
for (const flag of [false, null, undefined]) {
  test(`server page cannot bypass home flags ${flag} with service-role data and legacy flags true`, async () => {
    const tree = await renderTenant({ show_address_home: flag, show_phone_home: flag });
    assert.equal(tree.includes("PRIVATE STREET 123"), false);
    assert.equal(tree.includes("+56987654321"), false);
  });
}
test("server page preserves explicitly public contact", async () => {
  const tree = await renderTenant({ show_address_home: true, show_phone_home: true });
  assert.equal(tree.includes("PRIVATE STREET 123"), true);
  assert.equal(tree.includes("+56987654321"), true);
});
test("legacy false still hides contact even with home flags true", async () => {
  const tree = await renderTenant({ show_address_home: true, show_phone_home: true, show_address: false, show_phone: false });
  assert.equal(tree.includes("PRIVATE STREET 123"), false);
  assert.equal(tree.includes("+56987654321"), false);
});
