import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "app/api/appointments/create/route.ts",
  "utf8",
);

const migration = readFileSync(
  "migrations/202608200003_admin_internal_appointment.sql",
  "utf8",
);

test("admin appointment path stays separate from public booking", () => {
  assert.match(
    route,
    /!operational\.capabilities\.createAppointment && !isAdminRequest/,
  );

  assert.match(
    route,
    /isAdminRequest[\s\S]*\? "create_admin_appointment"/,
  );

  assert.match(
    migration,
    /citaya\.admin_appointment_tenant_id/,
  );

  assert.match(
    migration,
    /v_mode not in \('internal','live'\)/,
  );

  assert.match(
    migration,
    /perform public\.assert_tenant_can_create_appointment/,
  );

  assert.match(
    migration,
    /grant execute on function public\.create_admin_appointment/,
  );
});
