import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hashManageToken,
  isUsableManageTokenRecord,
  safeTokenHashEqual,
} from "../../lib/security/manage-tokens.mjs";
import { safeInternalRedirect } from "../../lib/security/redirects.mjs";

test("login only accepts internal relative routes", () => {
  assert.equal(safeInternalRedirect("https://evil.example/x"), "/admin");
  assert.equal(safeInternalRedirect("javascript:alert(1)"), "/admin");
  assert.equal(safeInternalRedirect("//evil.example/x"), "/admin");
  assert.equal(safeInternalRedirect("/\\evil.example"), "/admin");
  assert.equal(safeInternalRedirect("%252f%252fevil.example"), "/admin");
  assert.equal(safeInternalRedirect("/admin/agenda?view=week"), "/admin/agenda?view=week");
});

test("manage tokens enforce hash, expiry, revocation and rotation", () => {
  const pepper = "test-pepper-not-a-production-secret";
  const valid = "valid-token-with-at-least-thirty-two-characters";
  const rotated = "rotated-token-with-at-least-thirty-two-chars";
  const record = {
    manage_token_hash: hashManageToken(valid, pepper),
    manage_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    manage_token_revoked_at: null,
  };
  assert.equal(isUsableManageTokenRecord(record), true);
  assert.equal(safeTokenHashEqual(record.manage_token_hash, hashManageToken(valid, pepper)), true);
  assert.equal(safeTokenHashEqual(record.manage_token_hash, hashManageToken("incorrect", pepper)), false);
  assert.equal(isUsableManageTokenRecord({ ...record, manage_token_expires_at: new Date(0).toISOString() }), false);
  assert.equal(isUsableManageTokenRecord({ ...record, manage_token_revoked_at: new Date().toISOString() }), false);
  const rotatedHash = hashManageToken(rotated, pepper);
  assert.equal(safeTokenHashEqual(rotatedHash, record.manage_token_hash), false);
  assert.equal(safeTokenHashEqual(rotatedHash, hashManageToken(rotated, pepper)), true);
});

test("legacy plaintext manage tokens have a bounded removal migration", () => {
  const sql = readFileSync(new URL("../../migrations/202608070001_remove_legacy_manage_tokens.sql", import.meta.url), "utf8");
  assert.match(sql, /legacy_manage_token_window_still_active/);
  assert.match(sql, /set manage_token = null/);
  assert.match(sql, /check \(manage_token is null\)/);
});

test("manage-token appointment response exposes customer contact only after token authorization", () => {
  const route = readFileSync(
    new URL("../../app/api/appointments/by-token/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    route,
    /customer_name,\s*customer_phone,\s*customer_email,/,
  );

  const authorization = route.indexOf(
    'if (!access.ok || access.actor !== "manage_token") return notFound();',
  );
  const customerResponse = route.indexOf(
    "customer_name: data.customer_name",
  );

  assert.notEqual(authorization, -1);
  assert.notEqual(customerResponse, -1);
  assert.ok(customerResponse > authorization);

  assert.match(route, /customer_phone: data\.customer_phone/);
  assert.match(route, /customer_email: data\.customer_email/);
});
