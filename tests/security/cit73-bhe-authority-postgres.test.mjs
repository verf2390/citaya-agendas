import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(file, "utf8");
const control = read("migrations/202609090008_cit73_bhe_control_plane.sql");
const security = read("migrations/202609090009_cit73_bhe_authority_audit_security.sql");
const q = (value) => value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const A = "73000000-0000-4000-8000-000000000001";
const B = "73000000-0000-4000-8000-000000000002";
const PLATFORM = "72000000-0000-4000-8000-000000000099";
const TENANT_ADMIN = "73000000-0000-4000-8000-000000000099";
const INACTIVE_ADMIN = "73000000-0000-4000-8000-000000000098";
const reason = "Reviewed administrative evidence for fixture";
const tables = ["bhe_issuers", "bhe_authority_records", "bhe_authority_controls", "bhe_authority_audit",
  "tenant_bhe_automation_settings", "tenant_bhe_automation_audit"];

test("CIT-73 authority migrations are transport-agnostic and do not wire operational execution", () => {
  for (const source of [control, security]) {
    assert.doesNotMatch(source, /https?:\/\/|wsdl|soap|private_key|access_token|\bfetch\s*\(|net\.http|http_post/i);
    assert.doesNotMatch(source, /create\s+(?:or replace\s+)?function public\.(?:resolve_tenant_operational_capabilities|tenant_bhe_automation_readiness)/i);
    assert.doesNotMatch(source, /automation_enabled\s*=\s*true|outbox|issuance_intents|claim_token|lease_expires_at/i);
    assert.doesNotMatch(source, /p_actor(?:_user)?_id/);
  }
  assert.match(security, /BHE_LEGACY_AUTOMATION_MUST_BE_OFF/);
  assert.match(security, /lock table public\.tenant_bhe_automation_settings in share row exclusive mode;[\s\S]*BHE_LEGACY_AUTOMATION_MUST_BE_OFF/);
});

test("CIT-73 authority, audit, isolation and concurrency in ephemeral PostgreSQL", async (t) => {
  const database = `citaya_cit73_${randomUUID().replaceAll("-", "")}`;
  const args = (db) => ["exec", "-i", "citaya-dte-sqltest", "psql", "-X", "-U", "postgres", "-d", db, "-qAt", "-v", "ON_ERROR_STOP=1"];
  function run(input, db = database) {
    return spawnSync("docker", args(db), { input, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  }
  function sql(input, db = database) {
    const result = run(input, db);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  }
  function session(body, role = "authenticated", actor = PLATFORM) {
    return `begin; set local statement_timeout='10s'; set local role ${role};
      set local request.jwt.claim.sub=${q(actor ?? "")};
      set local request.jwt.claim.role=${q(role)}; ${body}; commit;`;
  }
  function rpc(name, params, role = "authenticated", actor = PLATFORM) {
    return JSON.parse(sql(session(`select public.${name}(${params.map(q).join(",")})`, role, actor)));
  }
  function fails(body, pattern, role = "authenticated", actor = PLATFORM) {
    const result = run(session(body, role, actor));
    assert.notEqual(result.status, 0, `Unexpected success: ${body}`);
    assert.match(result.stderr, pattern);
  }
  const report = (tenant = A, role = "authenticated", actor = PLATFORM) => rpc("tenant_bhe_authority_report", [tenant], role, actor);
  const register = (tenant) => rpc("bhe_register_issuer", [tenant, "12.345.678-5", "fixture-evidence-issuer", reason]);
  const open = (tenant, issuer, domain, parent = null) => rpc("bhe_open_authority_record", [tenant, issuer, domain, parent, reason]);
  const transition = (item, status, evidence = null, tenant = A, from = null, until = null) =>
    rpc("bhe_transition_authority_record", [tenant, item.id, item.version, status, reason, evidence, from, until]);
  const audits = (id) => JSON.parse(sql(`select coalesce(jsonb_agg(a order by generation),'[]'::jsonb) from public.bhe_authority_audit a where entity_id=${q(id)}`));

  sql(`create database ${database}`, "postgres");
  try {
    const prior = read("tests/security/cit72-capability-aware-live-postgres.test.mjs");
    const marker = "const bootstrap = String.raw`";
    const start = prior.indexOf(marker) + marker.length;
    const end = prior.indexOf("\n  `;", start);
    assert.ok(start >= marker.length && end > start);
    const primitive = read("migrations/202607270001_dte_legal_activation.sql")
      .match(/create or replace function public\.normalize_chilean_rut[\s\S]*?\n\$\$;/)?.[0];
    assert.ok(primitive);
    sql(`create schema extensions; create extension pgcrypto with schema extensions;
      ${prior.slice(start, end)}
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      grant usage on schema auth to authenticated,anon,service_role;
      create table public.tenant_members(tenant_id uuid,user_id uuid,role text,is_active boolean);
      create function public.is_tenant_member(p_tenant_id uuid,p_user_id uuid default auth.uid())
        returns boolean language sql stable security definer set search_path='' as $$
        select exists(select 1 from public.tenant_members where tenant_id=p_tenant_id and user_id=p_user_id and is_active) $$;
      ${primitive}
      insert into public.platform_admins values (${q(INACTIVE_ADMIN)},'super_admin',false);
      -- Reproduce the broad Supabase defaults that a narrow GRANT cannot remove.
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
      ${read("migrations/202609090002_cit72_capability_aware_live.sql")}
      ${read("migrations/202609090003_cit73_bhe_automation_foundation.sql")}
      ${read("migrations/202609090004_cit72_external_bhe_payment_guard.sql")}
      ${read("migrations/202609090007_cit73_bhe_automation_capability.sql")}
      ${control}
      ${security}
      ${read("tests/sql/cit72-capability-aware-live-assertions.sql")}
      insert into public.tenants(id,slug,name) values (${q(A)},'cit73-a','Issuer tenant A'),(${q(B)},'cit73-b','Issuer tenant B');
      insert into public.tenant_members values (${q(A)},${q(TENANT_ADMIN)},'owner',true);`);

    await t.test("default report is fail-closed, read-only, and does not expose taxpayer data", () => {
      const data = report();
      for (const key of ["issuerVerified", "authorizationActive", "evidenceComplete", "controlReady", "executionEnabled"]) assert.equal(data[key], false, key);
      assert.equal(data.requiresExplicitEnablement, true);
      assert.deepEqual([data.eligibilityStatus, data.applicationStatus, data.certificationStatus, data.authorizationStatus],
        ["NOT_ASSESSED", "DRAFT", "NOT_STARTED", "NOT_GRANTED"]);
      sql(session(`set transaction read only; select public.tenant_bhe_authority_report(${q(A)})`));
      assert.deepEqual(report(A, "authenticated", TENANT_ADMIN), data);
      fails(`select public.tenant_bhe_authority_report(${q(B)})`, /BHE_AUTHORITY_REPORT_FORBIDDEN/, "authenticated", TENANT_ADMIN);
      fails(`select public.tenant_bhe_authority_report(${q(A)})`, /permission denied/, "anon", null);
      assert.deepEqual(report(A, "service_role", null), data);
    });

    await t.test("anon, tenant admin, inactive admin, missing actor and service role cannot administer", () => {
      const call = `select public.bhe_register_issuer(${q(A)},'12345678-5','fixture-reference',${q(reason)})`;
      fails(call, /permission denied/, "anon", null);
      fails(call, /permission denied/, "service_role", PLATFORM);
      for (const actor of [TENANT_ADMIN, INACTIVE_ADMIN, null]) fails(call, /BHE_PLATFORM_ADMIN_REQUIRED/, "authenticated", actor);
      // Even accidentally granting EXECUTE cannot make a service session an admin.
      const attempted = run(`begin; grant execute on function public.bhe_register_issuer(uuid,text,text,text) to service_role;
        set local role service_role; set local request.jwt.claim.role='authenticated';
        set local request.jwt.claim.sub=${q(PLATFORM)}; ${call}; rollback;`);
      assert.notEqual(attempted.status, 0);
      assert.match(attempted.stderr, /BHE_PLATFORM_ADMIN_REQUIRED/);
    });

    await t.test("effective table and function ACLs remove broad inherited privileges", () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        for (const table of tables) {
          for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
            assert.equal(sql(`select has_table_privilege(${q(role)},${q(`public.${table}`)},${q(privilege)})`), "f", `${role}/${table}/${privilege}`);
          }
          fails(`delete from public.${table}`, /permission denied/, role, PLATFORM);
          fails(`truncate public.${table}`, /permission denied/, role, PLATFORM);
        }
      }
      const functions = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('name',proname,'args',oidvectortypes(proargtypes),
        'definer',prosecdef,'config',proconfig)) from pg_proc where pronamespace='public'::regnamespace and
        (proname like 'bhe_%' or proname='tenant_bhe_authority_report')`));
      const publicRpcs = new Set(["bhe_register_issuer", "bhe_transition_issuer", "bhe_open_authority_record", "bhe_transition_authority_record", "tenant_bhe_authority_report"]);
      const invokerHelpers = new Set(["bhe_audit_state", "bhe_deny_history_mutation"]);
      for (const name of [...invokerHelpers, ...publicRpcs]) {
        assert.ok(functions.some((fn) => fn.name === name), name);
      }
      for (const fn of functions) {
        assert.equal(fn.definer, !invokerHelpers.has(fn.name), fn.name);
        assert.deepEqual(fn.config, ['search_path=""']);
        assert.equal(sql(`select exists(select 1 from pg_proc p,
          lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
          where p.oid=${q(`public.${fn.name}(${fn.args})`)}::regprocedure
            and acl.grantee=0 and acl.privilege_type='EXECUTE')`), "f", `PUBLIC/${fn.name}`);
        const signature = `public.${fn.name}(${fn.args})`;
        for (const role of ["anon", "authenticated", "service_role"]) {
          const allowed = role === "authenticated" && publicRpcs.has(fn.name) || role === "service_role" && fn.name === "tenant_bhe_authority_report";
          assert.equal(sql(`select has_function_privilege(${q(role)},${q(signature)},'EXECUTE')`), allowed ? "t" : "f", `${role}/${fn.name}`);
        }
      }
    });

    let issuerA, issuerB, eligibility, application, certification, authorization;
    await t.test("issuer is verified explicitly, stores only tenant-bound fingerprint and keeps real audited actor", () => {
      issuerA = register(A); issuerB = register(B);
      fails(`select public.bhe_register_issuer(${q(A)},'12345678-5','reference',${q(reason)})`, /BHE_CURRENT_ISSUER_EXISTS/);
      fails(`select public.bhe_transition_issuer(${q(B)},${q(issuerA.id)},1,'VERIFIED',${q(reason)})`, /BHE_ISSUER_NOT_FOUND/);
      fails(`select public.bhe_transition_issuer(${q(A)},${q(issuerA.id)},9,'VERIFIED',${q(reason)})`, /BHE_CONCURRENT_MODIFICATION/);
      issuerA = rpc("bhe_transition_issuer", [A, issuerA.id, 1, "VERIFIED", `Verify issuer 12.345.678-5 using evidence`]);
      issuerB = rpc("bhe_transition_issuer", [B, issuerB.id, 1, "VERIFIED", reason]);
      const history = audits(issuerA.id);
      assert.equal(history.length, 2);
      assert.equal(history[0].previous_state.status, undefined);
      assert.equal(history[0].new_state.status, "UNVERIFIED");
      assert.equal(history[1].previous_state.status, "UNVERIFIED");
      assert.equal(history[1].new_state.status, "VERIFIED");
      assert.equal(history[1].new_state.verified_by, PLATFORM);
      assert.equal(history[1].actor_user_id, PLATFORM);
      assert.equal(history[1].entity_version, 2);
      assert.ok(history[1].occurred_at);
      assert.match(history[1].reason, /RUT_REDACTED/);
      assert.doesNotMatch(JSON.stringify(history), /12345678|12\.345\.678|tax_identifier_fingerprint|fixture-evidence-issuer/);
      const fingerprints = sql(`select count(distinct tax_identifier_fingerprint) from public.bhe_issuers`);
      assert.equal(fingerprints, "2");
    });

    await t.test("tenant/issuer/parent crossing is rejected by RPC and composite FK", () => {
      fails(`select public.bhe_open_authority_record(${q(B)},${q(issuerA.id)},'ELIGIBILITY',null,${q(reason)})`, /BHE_ISSUER_NOT_VERIFIED/);
      const badFk = run(`begin; alter table public.bhe_authority_records disable trigger user;
        insert into public.bhe_authority_records(tenant_id,issuer_id,domain,revision,status,created_by,updated_by)
        values (${q(B)},${q(issuerA.id)},'ELIGIBILITY',1,'NOT_ASSESSED',${q(PLATFORM)},${q(PLATFORM)}); rollback;`);
      assert.notEqual(badFk.status, 0); assert.match(badFk.stderr, /foreign key constraint/);
    });

    await t.test("eligibility cannot jump states and stale writes leave no audit", () => {
      eligibility = open(A, issuerA.id, "ELIGIBILITY");
      fails(`select public.bhe_transition_authority_record(${q(A)},${q(eligibility.id)},1,'ELIGIBLE',${q(reason)},'evidence')`, /BHE_INVALID_TRANSITION/);
      assert.equal(audits(eligibility.id).length, 1);
      eligibility = transition(eligibility, "UNDER_REVIEW");
      fails(`select public.bhe_transition_authority_record(${q(A)},${q(eligibility.id)},1,'ELIGIBLE',${q(reason)},'evidence')`, /BHE_CONCURRENT_MODIFICATION/);
      fails(`select public.bhe_transition_authority_record(${q(A)},${q(eligibility.id)},2,'ELIGIBLE',${q(reason)})`, /BHE_EVIDENCE_REQUIRED/);
      assert.equal(audits(eligibility.id).length, 2);
      eligibility = transition(eligibility, "ELIGIBLE", "eligibility-reviewed");
      assert.equal(audits(eligibility.id).length, 3);
    });

    await t.test("application, certification and authorization follow independent reviewed state paths", () => {
      application = open(A, issuerA.id, "APPLICATION", eligibility.id);
      application = transition(application, "SUBMITTED");
      application = transition(application, "UNDER_REVIEW");
      application = transition(application, "APPROVED", "application-reviewed");
      certification = open(A, issuerA.id, "CERTIFICATION", application.id);
      certification = transition(certification, "IN_PROGRESS");
      certification = transition(certification, "VALID", "certification-reviewed");
      authorization = open(A, issuerA.id, "AUTHORIZATION", certification.id);
      assert.equal(report().controlReady, false);
      authorization = transition(authorization, "ACTIVE", "authorization-reviewed");
      const data = report();
      assert.equal(data.controlReady, true); assert.equal(data.authorizationActive, true);
      assert.equal(data.evidenceComplete, true); assert.equal(data.requiresExplicitEnablement, true);
      assert.equal(data.executionEnabled, false);
      assert.doesNotMatch(JSON.stringify(data), /12345678|evidence_reference|fingerprint/);
      assert.equal(sql(`select automation_enabled from public.tenant_bhe_automation_settings where tenant_id=${q(A)}`), "f");
    });

    await t.test("a missing or inconsistent control fails closed without silent healing of a complete authority chain", () => {
      const before = report();
      assert.equal(before.controlReady, true);
      assert.ok(before.generation > 1);
      const history = audits(authorization.id);
      for (const generation of [null, 0, before.generation - 1, before.generation + 1]) {
        // Only the test owner may remove/corrupt controls; roll back each fixture.
        const fixture = generation === null
          ? `delete from public.bhe_authority_controls where tenant_id=${q(A)}`
          : `update public.bhe_authority_controls set generation=${generation} where tenant_id=${q(A)}`;
        const [first, second, stored] = sql(`begin; ${fixture};
          set local role authenticated; set local request.jwt.claim.role='authenticated';
          set local request.jwt.claim.sub=${q(PLATFORM)};
          select public.tenant_bhe_authority_report(${q(A)});
          select public.tenant_bhe_authority_report(${q(A)});
          reset role;
          select jsonb_build_object('count',count(*),'generation',max(generation))
            from public.bhe_authority_controls where tenant_id=${q(A)};
          rollback;`).split("\n").map((row) => JSON.parse(row));
        assert.deepEqual(first, { ...before, generation: generation ?? 0, controlReady: false });
        assert.equal(first.executionEnabled, false);
        assert.deepEqual(second, first);
        assert.deepEqual(stored, { count: generation === null ? 0 : 1, generation });
        assert.deepEqual(report(), before);
        assert.deepEqual(audits(authorization.id), history);
      }
    });

    await t.test("audit is append-only even with accidental grants and cannot be inserted by applications", () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        fails(`update public.bhe_authority_audit set reason='Forged historical reason'`, /permission denied/, role, PLATFORM);
        fails(`insert into public.bhe_authority_audit default values`, /permission denied/, role, PLATFORM);
        fails(`update public.bhe_issuers set status='VERIFIED'`, /permission denied/, role, PLATFORM);
        fails(`update public.tenant_bhe_automation_settings set automation_enabled=false`, /permission denied/, role, PLATFORM);
      }
      for (const command of ["update public.bhe_authority_audit set reason='Forged historical reason'", "delete from public.bhe_authority_audit", "truncate public.bhe_authority_audit"]) {
        const result = run(`begin; ${command}; rollback;`);
        assert.notEqual(result.status, 0); assert.match(result.stderr, /BHE_HISTORY_APPEND_ONLY/);
      }
      assert.equal(sql(session(`select count(*) from public.bhe_authority_audit`, "authenticated", TENANT_ADMIN)), "0");
    });

    await t.test("an audit insertion failure rolls back the transition, version and generation", () => {
      const before = report();
      const history = audits(authorization.id);
      const failed = run(`begin;
        create function public.test_bhe_reject_audit() returns trigger language plpgsql as $$
          begin raise exception 'TEST_AUDIT_UNAVAILABLE'; end; $$;
        create trigger test_bhe_reject_audit before insert on public.bhe_authority_audit
          for each row execute function public.test_bhe_reject_audit();
        set local role authenticated; set local request.jwt.claim.role='authenticated';
        set local request.jwt.claim.sub=${q(PLATFORM)};
        select public.bhe_transition_authority_record(${q(A)},${q(authorization.id)},${authorization.version},'SUSPENDED',${q(reason)});
        rollback;`);
      assert.notEqual(failed.status, 0); assert.match(failed.stderr, /TEST_AUDIT_UNAVAILABLE/);
      assert.deepEqual(report(), before);
      assert.deepEqual(audits(authorization.id), history);
      assert.equal(sql(`select version from public.bhe_authority_records where id=${q(authorization.id)}`), String(authorization.version));
    });

    await t.test("installation refuses a legacy activation without silently changing data", () => {
      const guard = security.match(/do \$\$[\s\S]*?\$\$;/)?.[0];
      assert.ok(guard);
      const before = report();
      const failed = run(`begin;
        alter table public.tenant_bhe_automation_settings disable trigger user;
        update public.tenant_bhe_automation_settings set automation_mode='sii_mass_webservice',
          authorization_status='authorized',form_2117_reference='legacy-reference',certification_reference='legacy-reference',
          sii_authorization_reference='legacy-reference',provider_included_in_certification=true,
          ws_spec_received=true,credentials_configured=true,worker_ready=true,automation_enabled=true where tenant_id=${q(A)};
        alter table public.tenant_bhe_automation_settings enable trigger user;
        ${guard} rollback;`);
      assert.notEqual(failed.status, 0); assert.match(failed.stderr, /BHE_LEGACY_AUTOMATION_MUST_BE_OFF/);
      assert.deepEqual(report(), before);
      assert.equal(sql(`select automation_enabled from public.tenant_bhe_automation_settings where tenant_id=${q(A)}`), "f");
    });

    await t.test("installation holds the legacy OFF precondition against concurrent writes", async () => {
      const preflight = security.slice(0, security.indexOf("create function public.bhe_require_platform_actor"));
      const holder = spawn("docker", args(database), { stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      holder.stderr.on("data", (chunk) => { stderr += chunk; });
      const done = new Promise((resolve, reject) => {
        holder.on("error", reject);
        holder.on("close", (status) => resolve(status));
      });
      const ready = new Promise((resolve, reject) => {
        let output = "";
        holder.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("guard-locked")) resolve();
        });
        holder.on("error", reject);
        holder.on("close", () => reject(new Error(`Preflight exited before locking: ${stderr}`)));
      });
      holder.stdin.write(`${preflight}\nselect 'guard-locked';\n`);
      try {
        await ready;
        const writer = run(`begin; set local lock_timeout='200ms';
          update public.tenant_bhe_automation_settings set automation_enabled=false where tenant_id=${q(A)}; rollback;`);
        assert.notEqual(writer.status, 0); assert.match(writer.stderr, /lock timeout/);
      } finally {
        holder.stdin.end("rollback;\n");
        assert.equal(await done, 0, stderr);
      }
    });

    await t.test("suspension closes a synthetic legacy ON state in the same canonical operation", () => {
      const before = audits(authorization.id).length;
      // Owner-only fixture simulates a historical ON row, without committing it.
      // All application ACLs and the actual suspension/audit triggers stay in force.
      const result = sql(`begin;
        alter table public.tenant_bhe_automation_settings disable trigger user;
        update public.tenant_bhe_automation_settings set automation_mode='sii_mass_webservice',
          authorization_status='authorized',form_2117_reference='legacy-reference',certification_reference='legacy-reference',
          sii_authorization_reference='legacy-reference',provider_included_in_certification=true,
          ws_spec_received=true,credentials_configured=true,worker_ready=true,automation_enabled=true where tenant_id=${q(A)};
        alter table public.tenant_bhe_automation_settings enable trigger user;
        set local role authenticated; set local request.jwt.claim.sub=${q(PLATFORM)};
        set local request.jwt.claim.role='authenticated';
        select public.bhe_transition_authority_record(${q(A)},${q(authorization.id)},${authorization.version},'SUSPENDED',${q(reason)});
        commit;`);
      authorization = JSON.parse(result);
      assert.equal(report().authorizationStatus, "SUSPENDED"); assert.equal(report().controlReady, false);
      assert.equal(audits(authorization.id).length, before + 1);
      const legacy = JSON.parse(sql(`select jsonb_build_object('enabled',automation_enabled,'status',authorization_status) from public.tenant_bhe_automation_settings where tenant_id=${q(A)}`));
      assert.deepEqual(legacy, { enabled: false, status: "suspended" });
      const legacyEvent = JSON.parse(sql(`select new_state from public.bhe_authority_audit where tenant_id=${q(A)} and action='LEGACY_DISABLED' order by generation desc limit 1`));
      assert.equal(legacyEvent.automation_enabled, false);
    });

    await t.test("resumption is explicit; revocation is terminal and a new authorization gets new lineage", () => {
      assert.equal(report().authorizationActive, false);
      fails(`select public.bhe_transition_authority_record(${q(B)},${q(authorization.id)},${authorization.version},'ACTIVE',${q(reason)},'evidence')`, /BHE_RECORD_NOT_FOUND/);
      fails(`select public.bhe_transition_authority_record(${q(A)},${q(authorization.id)},${authorization.version},'ACTIVE',${q(reason)})`, /BHE_EVIDENCE_REQUIRED/);
      authorization = transition(authorization, "ACTIVE", "resumption-reviewed");
      assert.equal(report().controlReady, true); assert.equal(report().requiresExplicitEnablement, true);
      authorization = transition(authorization, "REVOKED");
      assert.equal(report().controlReady, false);
      fails(`select public.bhe_transition_authority_record(${q(A)},${q(authorization.id)},${authorization.version},'ACTIVE',${q(reason)},'evidence')`, /BHE_INVALID_TRANSITION/);
      const oldId = authorization.id;
      authorization = open(A, issuerA.id, "AUTHORIZATION", certification.id);
      assert.notEqual(authorization.id, oldId); assert.equal(authorization.revision, 2);
      assert.equal(sql(`select status from public.bhe_authority_records where id=${q(oldId)}`), "REVOKED");
      assert.equal(report().controlReady, false);
      authorization = transition(authorization, "ACTIVE", "new-authorization-reviewed", A, "2099-01-01", null);
      assert.equal(report().authorizationActive, false);
      authorization = transition(authorization, "SUSPENDED");
      authorization = transition(authorization, "ACTIVE", "current-authorization-reviewed");
      assert.equal(report().controlReady, true);
      assert.equal(sql(`select valid_until is null from public.bhe_authority_records where id=${q(authorization.id)}`), "t");
    });

    await t.test("invalidation and successor assessment never reactivate or reuse stale parents", () => {
      certification = transition(certification, "INVALIDATED");
      assert.equal(report().controlReady, false);
      authorization = transition(authorization, "SUSPENDED");
      fails(`select public.bhe_transition_authority_record(${q(A)},${q(authorization.id)},${authorization.version},'ACTIVE',${q(reason)},'evidence')`, /BHE_PARENT_NOT_READY/);
      const successor = open(A, issuerA.id, "ELIGIBILITY");
      assert.equal(successor.revision, 2); assert.equal(report().eligibilityStatus, "NOT_ASSESSED");
      fails(`select public.bhe_open_authority_record(${q(A)},${q(issuerA.id)},'APPLICATION',${q(eligibility.id)},${q(reason)})`, /BHE_PARENT_NOT_READY/);
      assert.equal(report().authorizationStatus, "SUSPENDED");
    });

    await t.test("two real sessions with the same expected_version produce exactly one transition", async () => {
      const item = open(B, issuerB.id, "ELIGIBILITY");
      const command = session(`select public.bhe_transition_authority_record(${q(B)},${q(item.id)},1,'UNDER_REVIEW',${q(reason)})`);
      const attempt = () => new Promise((resolve, reject) => {
        const child = spawn("docker", args(database), { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (status) => resolve({ status, stdout, stderr }));
        child.stdin.end(command);
      });
      const results = await Promise.all([attempt(), attempt()]);
      assert.equal(results.filter((result) => result.status === 0).length, 1);
      assert.match(results.find((result) => result.status !== 0).stderr, /BHE_CONCURRENT_MODIFICATION/);
      assert.equal(audits(item.id).length, 2);
    });

    await t.test("negative decisions are terminal, successors are explicit, and parent FKs enforce domain and tenant", () => {
      let item = JSON.parse(sql(`select jsonb_build_object('id',id,'version',version) from public.bhe_authority_records where tenant_id=${q(B)} and domain='ELIGIBILITY'`));
      const rejectJump = (record, status) => fails(`select public.bhe_transition_authority_record(${q(B)},${q(record.id)},${record.version},${q(status)},${q(reason)},'fixture-evidence')`, /BHE_INVALID_TRANSITION/);
      item = transition(item, "INELIGIBLE", null, B);
      rejectJump(item, "ELIGIBLE");
      item = open(B, issuerB.id, "ELIGIBILITY");
      item = transition(item, "UNDER_REVIEW", null, B);
      item = transition(item, "ELIGIBLE", "eligibility-reviewed", B);
      for (const state of ["DRAFT", "SUBMITTED", "UNDER_REVIEW"]) {
        let withdrawn = open(B, issuerB.id, "APPLICATION", item.id);
        if (state !== "DRAFT") withdrawn = transition(withdrawn, "SUBMITTED", null, B);
        if (state === "UNDER_REVIEW") withdrawn = transition(withdrawn, "UNDER_REVIEW", null, B);
        withdrawn = transition(withdrawn, "WITHDRAWN", null, B);
        rejectJump(withdrawn, "SUBMITTED");
      }
      let app = open(B, issuerB.id, "APPLICATION", item.id);
      rejectJump(app, "APPROVED");
      app = transition(app, "SUBMITTED", null, B);
      app = transition(app, "UNDER_REVIEW", null, B);
      app = transition(app, "REJECTED", null, B);
      rejectJump(app, "APPROVED");
      app = open(B, issuerB.id, "APPLICATION", item.id);
      app = transition(app, "SUBMITTED", null, B);
      app = transition(app, "UNDER_REVIEW", null, B);
      app = transition(app, "APPROVED", "application-reviewed", B);
      let cert = open(B, issuerB.id, "CERTIFICATION", app.id);
      rejectJump(cert, "VALID");
      cert = transition(cert, "IN_PROGRESS", null, B);
      cert = transition(cert, "FAILED", null, B);
      rejectJump(cert, "VALID");
      cert = open(B, issuerB.id, "CERTIFICATION", app.id);
      cert = transition(cert, "IN_PROGRESS", null, B);
      cert = transition(cert, "VALID", "certification-reviewed", B);
      let auth = open(B, issuerB.id, "AUTHORIZATION", cert.id);
      rejectJump(auth, "SUSPENDED");
      auth = transition(auth, "REVOKED", null, B);
      rejectJump(auth, "ACTIVE");
      auth = open(B, issuerB.id, "AUTHORIZATION", cert.id);
      auth = transition(auth, "ACTIVE", "authorization-expired", B, null, "2000-01-01");
      assert.equal(report(B).authorizationActive, false);
      auth = transition(auth, "SUSPENDED", null, B);
      assert.match(sql(`select valid_until::text from public.bhe_authority_records where id=${q(auth.id)}`), /^2000-01-01/);
      auth = transition(auth, "REVOKED", null, B);
      rejectJump(auth, "ACTIVE");

      for (const parent of [eligibility.id, app.id]) {
        const failed = run(`begin; alter table public.bhe_authority_records disable trigger user;
          insert into public.bhe_authority_records(tenant_id,issuer_id,domain,revision,parent_id,parent_domain,status,created_by,updated_by)
          values (${q(B)},${q(issuerB.id)},'APPLICATION',99,${q(parent)},'ELIGIBILITY','DRAFT',${q(PLATFORM)},${q(PLATFORM)}); rollback;`);
        assert.notEqual(failed.status, 0); assert.match(failed.stderr, /foreign key constraint/);
      }
      issuerB = rpc("bhe_transition_issuer", [B, issuerB.id, issuerB.version, "INACTIVE", reason]);
      fails(`select public.bhe_transition_issuer(${q(B)},${q(issuerB.id)},${issuerB.version},'VERIFIED',${q(reason)})`, /BHE_INVALID_TRANSITION/);
      assert.equal(report(B).issuerVerified, false);
      const successor = register(B);
      assert.notEqual(successor.id, issuerB.id);
      assert.equal(report(B).controlReady, false);
    });

    await t.test("CIT-72 DTE and external manual profiles keep existing capabilities; BHE stays OFF", () => {
      for (const [tenant, dte] of [["72000000-0000-4000-8000-000000000001", true], ["72000000-0000-4000-8000-000000000002", false]]) {
        const caps = JSON.parse(sql(`select public.resolve_tenant_operational_capabilities(${q(tenant)})`));
        assert.equal(caps.createAppointment, true); assert.equal(caps.createPayment, dte);
        assert.equal(caps.enqueueDte, dte); assert.equal(caps.runDteWorker, dte); assert.equal(caps.bheAutomation, false);
      }
    });
  } finally {
    sql(`drop database if exists ${database} with (force)`, "postgres");
  }
});
