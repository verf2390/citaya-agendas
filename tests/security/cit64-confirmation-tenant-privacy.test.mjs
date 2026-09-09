import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as operational from "../../lib/tenant/operational-mode.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync("app/reservar/confirmacion/page.tsx", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRIVATE_ADDRESS = "Private appointment street 123";
const PRIVATE_PHONE = "+56987654321";
const publicTenant = () => ({ id: TENANT_ID, slug: "tenant-a", name: "Public business", address: null, phone_display: null, address_display: "Public city", show_address_after_booking: false, show_phone_after_booking: false, operational_capabilities: operational.resolveTenantOperationalCapabilities({ lifecycleStatus: "active", operationalMode: "live" }) });
const appointment = () => ({ id: ID, tenant_id: TENANT_ID, professional_id: "professional-a", service_name: "Consulta", start_at: "2026-09-10T14:00:00Z", end_at: "2026-09-10T15:00:00Z", tenant: { id: TENANT_ID, slug: "tenant-a", name: "Protected business", address: PRIVATE_ADDRESS, city: "Santiago", phone_display: PRIVATE_PHONE, show_address_after_booking: true, show_phone_after_booking: true } });

// Execute the real TSX component in a small hook harness with simulated browser,
// fetch and presentation components. No source snippets are substituted.
function harness({ appt = appointment(), tenant = publicTenant(), token = "manage-test", authorized = true, hostname = "tenant-a.citaya.online", queryTenant = "", publicFailure = false } = {}) {
  const hooks = [];
  let index = 0;
  let dirty = true;
  let tree;
  const pending = [];
  const requests = [];
  const params = new URLSearchParams({ id: ID, ...(queryTenant ? { tenant: queryTenant } : {}) });
  const react = {
    Suspense: "Suspense",
    useState(initial) {
      const slot = index++;
      if (!hooks[slot]) hooks[slot] = { value: initial };
      return [hooks[slot].value, (value) => {
        const next = typeof value === "function" ? value(hooks[slot].value) : value;
        if (!Object.is(next, hooks[slot].value)) { hooks[slot].value = next; dirty = true; }
      }];
    },
    useMemo(callback) { index++; return callback(); },
    useEffect(callback, deps) {
      const slot = index++;
      if (!hooks[slot] || deps.some((dep, i) => !Object.is(dep, hooks[slot].deps[i]))) {
        const cleanup = hooks[slot]?.cleanup;
        hooks[slot] = { deps };
        pending.push(() => { cleanup?.(); hooks[slot].cleanup = callback(); });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const cjsModule = { exports: {} };
  const mockRequire = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (name === "next/navigation") return { useSearchParams: () => params };
    if (name === "@/lib/tenant/operational-mode.mjs") return operational;
    if (name === "next/link") return { __esModule: true, default: "Link" };
    if (name === "lucide-react" || name.startsWith("@/components/")) return new Proxy({}, { get: (_, key) => String(key) });
    throw new Error(`Unexpected import ${name}`);
  };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith("/api/appointments/by-id?")) {
      assert.equal(options.headers["x-manage-token"], token);
      return Response.json(authorized ? { ok: true, appointment: appt } : { ok: false, error: "Cita no disponible" }, { status: authorized ? 200 : 404 });
    }
    if (url.startsWith("/api/tenants/by-slug?")) return Response.json(publicFailure ? { error: "Unavailable" } : { tenant }, { status: publicFailure ? 503 : 200 });
    if (url.startsWith("/api/professionals/by-tenant?")) return Response.json([{ id: "professional-a", name: "Profesional A" }]);
    throw new Error(`Unexpected endpoint ${url}`);
  };
  const storageKeys = [];
  const storage = { getItem(key) { storageKeys.push(key); return token; } };
  new Function("require", "module", "exports", "fetch", "window", "navigator", "sessionStorage", `${compiled}\nexports.inner = ConfirmacionInner;`)(mockRequire, cjsModule, cjsModule.exports, fetch, { location: { hostname } }, { userAgent: "Desktop" }, storage);
  function render() {
    index = 0;
    dirty = false;
    tree = cjsModule.exports.inner();
    while (pending.length) pending.shift()();
    return tree;
  }
  return {
    requests, storageKeys, params, render,
    async settle() {
      for (let turn = 0; turn < 20; turn++) {
        if (dirty) render();
        await new Promise((resolve) => setImmediate(resolve));
        if (!dirty && !pending.length) return tree;
      }
      throw new Error("Component did not settle");
    },
  };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const hrefs = (tree) => nodes(tree).filter((node) => node.type === "a").map((node) => node.props.href).filter(Boolean);
const addressRow = (tree) => nodes(tree).find((node) => node.props?.label === "Dirección")?.props.value;
const calendar = (tree) => {
  const links = hrefs(tree);
  return { google: links.find((url) => url.startsWith("https://calendar.google.com")), ics: links.find((url) => url.startsWith("data:text/calendar")), wa: links.find((url) => url.includes("whatsapp.com")) };
};
test("protected appointment provides address, WhatsApp and calendar location when public API hides them", async () => {
  const app = harness();
  const tree = await app.settle();
  assert.equal(addressRow(tree), `${PRIVATE_ADDRESS} · Santiago`);
  const links = calendar(tree);
  assert.equal(new URL(links.wa).searchParams.get("phone"), "56987654321");
  assert.equal(new URL(links.google).searchParams.get("location"), `${PRIVATE_ADDRESS} · Santiago`);
  assert.ok(decodeURIComponent(links.ics).includes(`LOCATION:${PRIVATE_ADDRESS} · Santiago`));
  assert.deepEqual(app.storageKeys, [`citaya_manage_token:${ID}`]);
  assert.equal(app.requests[0].url, `/api/appointments/by-id?id=${ID}`);
  assert.ok(app.requests.some(({ url }) => url === "/api/tenants/by-slug?slug=tenant-a"));
  assert.ok(app.requests.every(({ url }) => !url.includes("/api/tenants/by-id")));
});
for (const [showAddress, showPhone] of [[false, false], [false, true], [true, false]]) {
  test(`protected flags address=${showAddress}, phone=${showPhone} override public flags`, async () => {
    const appt = appointment();
    appt.tenant.show_address_after_booking = showAddress;
    appt.tenant.show_phone_after_booking = showPhone;
    const tenant = { ...publicTenant(), address_display: "WRONG PUBLIC ADDRESS", phone_display: "+56911111111", show_address_after_booking: true, show_phone_after_booking: true };
    const tree = await harness({ appt, tenant }).settle();
    assert.equal(addressRow(tree), showAddress ? `${PRIVATE_ADDRESS} · Santiago` : undefined);
    const links = calendar(tree);
    assert.equal(Boolean(links.wa), showPhone);
    assert.equal(new URL(links.google).searchParams.get("location"), showAddress ? `${PRIVATE_ADDRESS} · Santiago` : "");
    assert.equal(decodeURIComponent(links.ics).includes("LOCATION:"), showAddress);
    assert.equal(JSON.stringify(tree).includes("WRONG PUBLIC ADDRESS"), false);
    assert.equal(JSON.stringify(tree).includes("56911111111"), false);
  });
}
test("absent protected tenant never falls back to public post-booking contact", async () => {
  const appt = appointment();
  appt.tenant = null;
  const tenant = { ...publicTenant(), address_display: "WRONG PUBLIC ADDRESS", phone_display: PRIVATE_PHONE, show_address_after_booking: true, show_phone_after_booking: true };
  const tree = await harness({ appt, tenant }).settle();
  assert.equal(addressRow(tree), undefined);
  assert.equal(calendar(tree).wa, undefined);
  assert.equal(new URL(calendar(tree).google).searchParams.get("location"), "");
});
for (const options of [{ token: "" }, { authorized: false }]) {
  test(`missing/denied token ${JSON.stringify(options)} cannot render protected contact`, async () => {
    const app = harness(options);
    const tree = await app.settle();
    assert.equal(addressRow(tree), undefined);
    assert.deepEqual(hrefs(tree), []);
    assert.equal(JSON.stringify(tree).includes(PRIVATE_ADDRESS), false);
    assert.equal(JSON.stringify(tree).includes(PRIVATE_PHONE), false);
    if (options.token === "") assert.ok(app.requests.every(({ url }) => !url.startsWith("/api/appointments/by-id")));
  });
}
test("authorized appointment slug resolves public metadata without tenant query/subdomain or nonexistent by-id API", async () => {
  const app = harness({ hostname: "localhost" });
  const tree = await app.settle();
  assert.equal(addressRow(tree), `${PRIVATE_ADDRESS} · Santiago`);
  assert.ok(app.requests.some(({ url }) => url === "/api/tenants/by-slug?slug=tenant-a"));
  assert.ok(app.requests.every(({ url }) => !url.includes("/api/tenants/by-id")));
});
test("authorized appointment slug takes precedence over tenant query hint", async () => {
  const app = harness({ queryTenant: "tenant-b" });
  await app.settle();
  const lookups = app.requests.filter(({ url }) => url.startsWith("/api/tenants/by-slug"));
  assert.equal(lookups.at(-1).url, "/api/tenants/by-slug?slug=tenant-a");
});
test("public metadata failure does not remove authorized address or ICS location", async () => {
  const tree = await harness({ publicFailure: true }).settle();
  assert.equal(addressRow(tree), `${PRIVATE_ADDRESS} · Santiago`);
  assert.ok(decodeURIComponent(calendar(tree).ics).includes(`LOCATION:${PRIVATE_ADDRESS}`));
  assert.equal(calendar(tree).wa, undefined, "existing capability gate remains fail-closed when public capabilities cannot load");
});
test("demo operational capabilities retain demo presentation and suppress WhatsApp", async () => {
  const tenant = publicTenant();
  tenant.operational_capabilities = operational.resolveTenantOperationalCapabilities({ lifecycleStatus: "active", operationalMode: "demo" });
  const tree = await harness({ tenant }).settle();
  assert.match(JSON.stringify(tree), /Tu reserva de demostración/);
  assert.equal(calendar(tree).wa, undefined);
  assert.ok(calendar(tree).ics);
});
test("changing appointment id clears private contact while new authorization is pending", async () => {
  const app = harness();
  await app.settle();
  app.params.set("id", "22222222-2222-4222-8222-222222222222");
  const tree = app.render();
  assert.equal(addressRow(tree), undefined);
  assert.equal(calendar(tree).wa, undefined);
});
