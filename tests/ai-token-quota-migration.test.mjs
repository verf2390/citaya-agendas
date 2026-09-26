import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(
  resolve("migrations/202609260001_cit97_ai_token_quota_actual_usage.sql"),
  "utf8",
);

test("cuota AI reserva tokens solo mientras el request está started", () => {
  assert.match(
    migration,
    /when status = 'started' then reserved_tokens[\s\S]*?else total_tokens/,
  );
  assert.doesNotMatch(
    migration,
    /sum\(greatest\(total_tokens, reserved_tokens\)\)/,
  );
});

test("cuota AI conserva lock por tenant para reservas concurrentes", () => {
  assert.match(
    migration,
    /pg_advisory_xact_lock\(hashtext\('citaya-ai:' \|\| p_tenant_id::text\)\)/,
  );
  assert.match(
    migration,
    /v_used_tokens \+ p_reserved_tokens > p_daily_token_limit/,
  );
});

test("RPC de cuota AI sigue server-only", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = public/);
  assert.match(
    migration,
    /revoke all on function public\.begin_ai_request_audit[\s\S]*?from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.begin_ai_request_audit[\s\S]*?to service_role;/,
  );
});
