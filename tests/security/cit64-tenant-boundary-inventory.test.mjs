import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import test from "node:test";

import {
  boundaryMarkers,
  privilegedHelperInventory,
  privilegedRouteInventory,
} from "./fixtures/cit64-tenant-boundaries.mjs";

const root = resolve(".");
const privilegedUse = /\b(?:supabaseAdmin|supabaseServer|SUPABASE_SERVICE_ROLE_KEY|service_role)\b/;
const statuses = new Set(["OK", "REVIEW_REQUIRED", "FINDING"]);
const severities = new Set(["P0", "P1", "P2", "none"]);

function filesBelow(directory) {
  const absolute = resolve(root, directory);
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = resolve(absolute, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(relative(root, path)));
    else found.push(relative(root, path));
  }
  return found;
}

function privilegedRoutes() {
  return filesBelow("app/api")
    .filter((file) => file.endsWith("/route.ts"))
    .filter((file) => privilegedUse.test(readFileSync(resolve(root, file), "utf8")))
    .sort();
}

function privilegedLibFiles() {
  return filesBelow("lib")
    .filter((file) => privilegedUse.test(readFileSync(resolve(root, file), "utf8")))
    .sort();
}

test("CIT-64 inventories every privileged API route explicitly", () => {
  const discovered = privilegedRoutes();
  const inventoried = privilegedRouteInventory.map(({ route }) => route).sort();
  assert.deepEqual(
    inventoried,
    discovered,
    "A privileged route was added/removed without updating the CIT-64 boundary inventory",
  );
  assert.equal(new Set(inventoried).size, inventoried.length, "Duplicate route in CIT-64 inventory");
});

test("CIT-64 inventories every privileged lib helper/reference explicitly", () => {
  const discovered = privilegedLibFiles();
  const inventoried = privilegedHelperInventory.map(({ file }) => file).sort();
  assert.deepEqual(
    inventoried,
    discovered,
    "A privileged lib file was added/removed without updating the CIT-64 helper inventory",
  );
  assert.equal(new Set(inventoried).size, inventoried.length, "Duplicate lib file in CIT-64 inventory");
});

test("CIT-64 classifications have evidence and their minimum boundary markers", (t) => {
  for (const entry of privilegedRouteInventory) {
    assert.ok(statuses.has(entry.status), `${entry.route}: invalid status`);
    assert.ok(severities.has(entry.severity), `${entry.route}: invalid severity`);
    assert.ok(entry.rationale?.trim(), `${entry.route}: rationale is required`);
    if (entry.status === "OK") assert.equal(entry.severity, "none", `${entry.route}: OK must use severity none`);
    if (entry.status === "FINDING") assert.notEqual(entry.severity, "none", `${entry.route}: FINDING needs severity`);

    const source = readFileSync(resolve(root, entry.route), "utf8");
    const markers = [...(boundaryMarkers[entry.boundary] ?? []), ...(entry.markers ?? [])];
    assert.ok(markers.length > 0, `${entry.route}: ${entry.boundary} needs explicit markers`);
    for (const marker of markers) {
      assert.ok(source.includes(marker), `${entry.route}: missing boundary marker ${JSON.stringify(marker)}`);
    }
  }

  const review = privilegedRouteInventory.filter(({ status }) => status === "REVIEW_REQUIRED");
  const findings = privilegedRouteInventory.filter(({ status }) => status === "FINDING");
  t.diagnostic(`REVIEW_REQUIRED (${review.length}): ${review.map(({ route }) => route).join(", ") || "none"}`);
  t.diagnostic(`FINDING (${findings.length}): ${findings.map(({ route, severity }) => `${severity} ${route}`).join(", ") || "none"}`);
});

test("CIT-64 production_admin terminates in the hostname tenant boundary", () => {
  const source = readFileSync(resolve(root, "lib/dte/production/api.ts"), "utf8");
  assert.match(source, /void legacyTenantHints/);
  assert.match(source, /return requireHostTenantAdmin\(req\)/);
});

test("CIT-64 keeps known preventive helper debt visible", () => {
  const source = readFileSync(resolve(root, "lib/api/appointmentAccess.ts"), "utf8");
  for (const helper of ["rotateAppointmentManageToken", "revokeAppointmentManageToken"]) {
    const start = source.indexOf(`export async function ${helper}`);
    assert.ok(start >= 0, `${helper} must remain inventoried`);
    const nextExport = source.indexOf("export async function", start + 1);
    const body = source.slice(start, nextExport < 0 ? undefined : nextExport);
    assert.match(body, /\.eq\("id", appointmentId\)/);
    assert.doesNotMatch(body, /\.eq\("tenant_id"/);
  }
});
