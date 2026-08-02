import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";

const files = [
  "tests/sql/payment-policy-privacy-bootstrap.sql",
  "migrations/202608020001_tenant_legal_privacy_gate.sql",
  "migrations/202608020002_service_payment_policy_sales_coverage.sql",
  "migrations/202608020003_tenant_lifecycle_offboarding.sql",
  "migrations/202608020004_payment_policy_accounting.sql",
  "tests/sql/payment-policy-privacy-assertions.sql",
];

test("PostgreSQL 17 executes payment/privacy migrations, RLS and triggers with rollback", () => {
  const database = `citaya_pp_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync("docker", ["exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);
  const input = files.map((file) => readFileSync(file, "utf8")).join("\n");
  try {
    const run = spawnSync("docker", ["exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8" });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const verify = spawnSync("docker", ["exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", database, "-Atc", "select count(*) from public.tenants"], { encoding: "utf8" });
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(verify.stdout.trim(), "0", "fictional fixtures did not roll back");
  } finally {
    const drop = spawnSync("docker", ["exec", "citaya-dte-sqltest", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `drop database if exists ${database}`], { encoding: "utf8" });
    assert.equal(drop.status, 0, drop.stderr);
  }
});
