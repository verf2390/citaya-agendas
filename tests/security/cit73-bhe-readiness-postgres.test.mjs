import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const migration = read("migrations/202609090010_cit73_bhe_authority_readiness.sql");
const DTE = "72000000-0000-4000-8000-000000000001";
const BHE = "72000000-0000-4000-8000-000000000002";
const ADMIN = "72000000-0000-4000-8000-000000000099";
const q = (value) => value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const reason = "Reviewed authority evidence for readiness fixture";
const entityTables = ["bhe_issuers", "bhe_authority_records", "bhe_authority_controls", "bhe_authority_audit",
  "tenant_bhe_automation_settings", "tenant_bhe_automation_audit"];

function definition(path, name) {
  const source = read(path);
  const start = source.indexOf(`create or replace function public.${name}(`);
  const end = source.indexOf("\n$$;", start);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end + 4);
}

test("CIT-73 phase 1B composes real PostgreSQL foundation, authority and capabilities without enabling execution", async (t) => {
  const database = `citaya_cit73_readiness_${randomUUID().replaceAll("-", "")}`;
  const run = (input, db = database) => spawnSync("docker", ["exec", "-i", "citaya-dte-sqltest",
    "psql", "-X", "-U", "postgres", "-d", db, "-qAt", "-v", "ON_ERROR_STOP=1"],
  { input, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  function sql(input, db = database) {
    const result = run(input, db);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  }
  const service = "set local role service_role;";
  const human = `set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub=${q(ADMIN)};`;
  const rpc = (name, args) => JSON.parse(sql(`begin; ${human} select public.${name}(${args.map(q).join(",")}); commit;`));
  const report = (tenant = BHE) => JSON.parse(sql(`begin; ${service} select public.tenant_bhe_authority_report(${q(tenant)}); commit;`));
  const caps = (tenant = BHE) => JSON.parse(sql(`begin; ${service} select public.resolve_tenant_operational_capabilities(${q(tenant)}); commit;`));
  const combinedQuery = (tenant = BHE) => `select jsonb_build_object(
    'readiness',public.tenant_bhe_automation_readiness(${q(tenant)}),
    'capabilities',public.resolve_tenant_operational_capabilities(${q(tenant)}))`;
  const readCombined = (fixture = "", tenant = BHE) => JSON.parse(sql(`begin; ${fixture} ${service} ${combinedQuery(tenant)}; rollback;`));
  // Owner-only adversarial fixture. It never commits and is not an application path.
  const legacyComplete = (tenant = BHE) => `
    alter table public.tenant_bhe_automation_settings disable trigger user;
    update public.tenant_bhe_automation_settings set automation_mode='sii_mass_webservice',
      authorization_status='authorized',form_2117_reference='fixture-reference',certification_reference='fixture-reference',
      sii_authorization_reference='fixture-reference',provider_included_in_certification=true,
      ws_spec_received=true,credentials_configured=true,worker_ready=true,automation_enabled=true
      where tenant_id=${q(tenant)};
    alter table public.tenant_bhe_automation_settings enable trigger user;`;
  const snapshot = () => sql(`select jsonb_build_object(${entityTables.map((table) =>
    `${q(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r)`).join(",")})`);
  function closed(data, foundationReady, authorityControlReady) {
    assert.equal(data.readiness.foundationReady, foundationReady);
    assert.equal(data.readiness.authorityControlReady, authorityControlReady);
    assert.equal(data.readiness.authorityExecutionEnabled, false);
    assert.equal(data.readiness.effectiveReady, false);
    assert.equal(data.readiness.ready, false);
    assert.equal(data.capabilities.bheAutomation, false);
  }

  sql(`create database ${database}`, "postgres");
  try {
    const prior = read("tests/security/cit72-capability-aware-live-postgres.test.mjs");
    const marker = "const bootstrap = String.raw`";
    const start = prior.indexOf(marker) + marker.length;
    const end = prior.indexOf("\n  `;", start);
    assert.ok(start >= marker.length && end > start);
    sql(`create schema extensions; create extension pgcrypto with schema extensions;
      ${prior.slice(start, end)}
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create table public.tenant_members(tenant_id uuid,user_id uuid,role text,is_active boolean);
      ${definition("migrations/202607230001_security_hardening.sql", "is_tenant_member")}
      ${definition("migrations/202607270001_dte_legal_activation.sql", "normalize_chilean_rut")}
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
      ${read("migrations/202609090002_cit72_capability_aware_live.sql")}
      ${read("migrations/202609090003_cit73_bhe_automation_foundation.sql")}
      ${read("migrations/202609090004_cit72_external_bhe_payment_guard.sql")}
      ${read("migrations/202609090007_cit73_bhe_automation_capability.sql")}
      ${read("migrations/202609090008_cit73_bhe_control_plane.sql")}
      ${read("migrations/202609090009_cit73_bhe_authority_audit_security.sql")}
      ${definition("migrations/202608020005_tenant_operational_mode.sql", "tenant_operational_capability_allowed")}
      ${definition("migrations/202608020005_tenant_operational_mode.sql", "assert_tenant_can_create_appointment")}
      ${definition("migrations/202608200003_admin_internal_appointment.sql", "assert_tenant_can_create_admin_appointment")}
      revoke all on function public.assert_tenant_can_create_admin_appointment(uuid) from public,anon,authenticated,service_role;
      grant execute on function public.assert_tenant_can_create_admin_appointment(uuid) to service_role;
      ${read("tests/sql/cit72-capability-aware-live-assertions.sql")}`);

    const oldCaps = [caps(DTE), caps(BHE)];
    const oldResolver = sql("select pg_get_functiondef('public.resolve_tenant_operational_capabilities(uuid)'::regprocedure)");
    const oldData = snapshot();
    const oldLegacy = JSON.parse(sql(`begin; ${legacyComplete()} ${service}
      select public.tenant_bhe_automation_readiness(${q(BHE)}); rollback;`));
    assert.equal(oldLegacy.ready, true, "fixture actually satisfied 003 before 010");
    sql(migration);

    await t.test("010 changes no data or resolver definition; DTE and manual BHE keep all capabilities and booking guards", () => {
      assert.equal(snapshot(), oldData);
      assert.equal(sql("select pg_get_functiondef('public.resolve_tenant_operational_capabilities(uuid)'::regprocedure)"), oldResolver);
      assert.deepEqual([caps(DTE), caps(BHE)], oldCaps);
      assert.equal(caps(BHE).createAppointment, true);
      assert.equal(caps(BHE).ordinaryAdmin, true);
      assert.equal(caps(BHE).createPayment, false);
      assert.equal(caps(DTE).createPayment, true);
      assert.equal(caps(DTE).enqueueDte, true);
      for (const role of ["service_role", "authenticated", "anon"]) {
        sql(`begin; set local role ${role};
          select public.assert_tenant_can_create_appointment(${q(BHE)}); rollback;`);
      }
      sql(`begin; ${service} select public.assert_tenant_can_create_admin_appointment(${q(BHE)}); rollback;`);
    });

    await t.test("missing dossier stays closed with either incomplete or fully forged legacy foundation", () => {
      closed(readCombined(), false, false);
      const data = readCombined(legacyComplete());
      closed(data, true, false);
      const { foundationReady, authorityControlReady, authorityExecutionEnabled, effectiveReady, ...compatible } = data.readiness;
      assert.deepEqual(compatible, { ...oldLegacy, ready: false });
      const missing = readCombined("", "73000000-0000-4000-8000-000000000000");
      for (const key of ["foundationReady", "authorityControlReady", "authorityExecutionEnabled", "effectiveReady", "ready"]) {
        assert.equal(missing.readiness[key], false);
      }
      assert.deepEqual(missing.capabilities, { exists: false, allowed: false });
    });

    let issuer, authorization;
    await t.test("complete foundation cannot replace an unverified issuer or incomplete dossier", () => {
      issuer = rpc("bhe_register_issuer", [BHE, "12345678-5", "fixture-issuer-reference", reason]);
      closed(readCombined(legacyComplete()), true, false);
      issuer = rpc("bhe_transition_issuer", [BHE, issuer.id, issuer.version, "VERIFIED", reason]);
      closed(readCombined(legacyComplete()), true, false);
    });

    await t.test("real reviewed authority without foundation stays closed", () => {
      let parent = null;
      for (const [domain, states] of [
        ["ELIGIBILITY", ["UNDER_REVIEW", "ELIGIBLE"]],
        ["APPLICATION", ["SUBMITTED", "UNDER_REVIEW", "APPROVED"]],
        ["CERTIFICATION", ["IN_PROGRESS", "VALID"]],
        ["AUTHORIZATION", ["ACTIVE"]],
      ]) {
        let item = rpc("bhe_open_authority_record", [BHE, issuer.id, domain, parent, reason]);
        for (const state of states) item = rpc("bhe_transition_authority_record",
          [BHE, item.id, item.version, state, reason, "fixture-reviewed-evidence"]);
        parent = item.id;
        if (domain === "AUTHORIZATION") authorization = item;
      }
      assert.equal(report().controlReady, true);
      assert.equal(report().executionEnabled, false);
      closed(readCombined(), false, true);
    });

    await t.test("complete foundation AND real controlReady still cannot enable execution or BHE capability", () => {
      const before = snapshot();
      const data = readCombined(legacyComplete());
      closed(data, true, true);
      assert.deepEqual(data.capabilities, oldCaps[1]);
      assert.equal(snapshot(), before, "legacy fixture and reads must not persist changes");
      sql(`begin; set transaction read only; ${service} ${combinedQuery()}; commit;`);
    });

    await t.test("missing settings, missing/corrupt control and suspended authority fail closed without healing", () => {
      closed(readCombined(`delete from public.tenant_bhe_automation_settings where tenant_id=${q(BHE)};`), false, true);
      for (const change of [
        `delete from public.bhe_authority_controls where tenant_id=${q(BHE)};`,
        `update public.bhe_authority_controls set generation=generation+1 where tenant_id=${q(BHE)};`,
      ]) {
        const before = snapshot();
        const values = sql(`begin; ${legacyComplete()} ${change} ${service} ${combinedQuery()};
          ${combinedQuery()}; reset role;
          select coalesce(max(generation),0) from public.bhe_authority_controls where tenant_id=${q(BHE)}; rollback;`).split("\n");
        closed(JSON.parse(values[0]), true, false);
        assert.deepEqual(JSON.parse(values[0]), JSON.parse(values[1]));
        assert.equal(Number(values[2]), change.startsWith("delete") ? 0 : report().generation + 1);
        assert.equal(snapshot(), before);
      }
      const data = JSON.parse(sql(`begin; ${human}
        do $$ begin perform public.bhe_transition_authority_record(${q(BHE)},${q(authorization.id)},${authorization.version},'SUSPENDED',${q(reason)}); end; $$;
        reset role; ${legacyComplete()} ${service} ${combinedQuery()}; rollback;`));
      closed(data, true, false);
    });

    // Report replacement is a transaction-local owner fixture to exercise the
    // consumer contract. It never changes authority rows or enables execution.
    const replaceReport = (value) => `create or replace function public.tenant_bhe_authority_report(p_tenant_id uuid)
      returns jsonb language sql stable security definer set search_path='' as $$ select ${q(value === null ? null : JSON.stringify(value))}::jsonb $$;`;
    const hypothetical = { ...report(), executionEnabled: true, requiresExplicitEnablement: false };
    await t.test("absent, malformed or contradictory authority payloads cannot produce effective readiness", () => {
      const invalid = [null, {}, [], "invalid", { ...hypothetical, executionEnabled: "true" },
        { ...hypothetical, requiresExplicitEnablement: true },
        ...["issuerVerified", "authorizationActive", "evidenceComplete", "controlReady"].flatMap((key) =>
          [false, null, "true"].map((value) => ({ ...hypothetical, [key]: value }))),
        ...[null, 0, -1, 1.5, "1"].map((generation) => ({ ...hypothetical, generation }))];
      for (const value of invalid) {
        const data = readCombined(`${legacyComplete()} ${replaceReport(value)}`);
        assert.equal(data.readiness.effectiveReady, false, JSON.stringify(value));
        assert.equal(data.readiness.ready, false);
        assert.equal(data.capabilities.bheAutomation, false);
      }
    });

    await t.test("the unchanged resolver derives BHE from all three gates, live mode and external_bhe", () => {
      // This stub is not a production enablement path; it detects a hardcoded
      // false or an omitted input in the new readiness composition.
      const fixture = `${legacyComplete()} ${replaceReport(hypothetical)}`;
      const data = readCombined(fixture);
      assert.equal(data.readiness.foundationReady, true);
      assert.equal(data.readiness.authorityControlReady, true);
      assert.equal(data.readiness.authorityExecutionEnabled, true);
      assert.equal(data.readiness.effectiveReady, true);
      assert.equal(data.readiness.ready, true);
      assert.equal(data.capabilities.bheAutomation, true);
      assert.deepEqual({ ...data.capabilities, bheAutomation: false }, oldCaps[1]);
      assert.equal(readCombined(replaceReport(hypothetical)).readiness.effectiveReady, false);
      for (const mode of ["demo", "internal", "unclassified"]) {
        assert.equal(readCombined(`${fixture} update public.tenants set operational_mode=${q(mode)} where id=${q(BHE)};`).capabilities.bheAutomation, false);
      }
      assert.equal(readCombined(`${fixture} update public.tenants set lifecycle_status='archived' where id=${q(BHE)};`).capabilities.bheAutomation, false);
      const dte = readCombined(`${legacyComplete(DTE)} ${replaceReport(hypothetical)}`, DTE);
      assert.equal(dte.readiness.effectiveReady, true);
      assert.deepEqual(dte.capabilities, oldCaps[0]);
      closed(readCombined(legacyComplete()), true, true);
    });

    await t.test("real report errors and missing DB functions propagate instead of becoming a successful response", () => {
      for (const fixture of [
        `create or replace function public.tenant_bhe_authority_report(p_tenant_id uuid)
          returns jsonb language plpgsql stable security definer set search_path='' as $$
          begin raise exception 'TEST_AUTHORITY_DB_FAILURE'; end; $$;`,
        "drop function public.tenant_bhe_authority_report(uuid);",
      ]) {
        const result = run(`begin; ${legacyComplete()} ${fixture} ${service} ${combinedQuery()}; rollback;`);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /TEST_AUTHORITY_DB_FAILURE|function public\.tenant_bhe_authority_report\(uuid\) does not exist/);
      }
    });

    await t.test("readiness is invoker, read only and service-only; no mutation or helper ACL is widened", () => {
      const info = JSON.parse(sql(`select jsonb_build_object('definer',prosecdef,'volatility',provolatile,'config',proconfig)
        from pg_proc where oid='public.tenant_bhe_automation_readiness(uuid)'::regprocedure`));
      assert.deepEqual(info, { definer: false, volatility: "s", config: ['search_path=""'] });
      assert.equal(sql(`select exists(select 1 from pg_proc p,
        lateral aclexplode(coalesce(proacl,acldefault('f',proowner))) a
        where p.oid='public.tenant_bhe_automation_readiness(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')`), "f");
      for (const role of ["anon", "authenticated", "service_role"]) {
        for (const name of ["tenant_bhe_automation_readiness", "resolve_tenant_operational_capabilities"]) {
          assert.equal(sql(`select has_function_privilege(${q(role)},${q(`public.${name}(uuid)`)},'EXECUTE')`), role === "service_role" ? "t" : "f");
          if (role !== "service_role") {
            const result = run(`begin; set local role ${role}; select public.${name}(${q(BHE)}); rollback;`);
            assert.notEqual(result.status, 0); assert.match(result.stderr, /permission denied/);
          }
        }
        for (const table of entityTables) {
          for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
            assert.equal(sql(`select has_table_privilege(${q(role)},${q(`public.${table}`)},${q(privilege)})`), "f");
          }
        }
      }
      for (const name of ["bhe_audit_state(jsonb)", "bhe_deny_history_mutation()", "bhe_disable_legacy_automation(uuid,text)"]) {
        assert.equal(sql(`select has_function_privilege('service_role',${q(`public.${name}`)},'EXECUTE')`), "f");
      }
    });
  } finally {
    sql(`drop database if exists ${database} with (force)`, "postgres");
  }
});
