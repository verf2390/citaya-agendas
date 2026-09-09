import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// Local-only, same disposable-database pattern as CIT-67. No URL/env credentials,
// application imports, network clients, real DTE material, or remote fallback.
const container = "citaya-dte-sqltest";
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const adminA = "11111111-1111-4111-8111-111111111111";
const adminB = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const platform = "44444444-4444-4444-8444-444444444444";
const ids = ["aaaaaaaa-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000001"];
const newId = "cccccccc-0000-4000-8000-000000000001";

// These are schema PROJECTIONS, not a production schema clone. Only columns
// needed by actual policies/public grants and observable writes are included.
// Business constraints, child FKs, triggers and RPCs are outside this test.
// The policies/helpers/ACLs below come verbatim from migrations, never mocks.
const surfaces = [
  { table: "tenants", field: "name", tenantKey: "id", extra: "slug text, logo_url text, city text, description text, show_address boolean, show_phone boolean, address text, phone_display text" },
  { table: "tenant_members", field: "email", mode: "read", extra: "user_id uuid not null, role text, is_active boolean" },
  { table: "services", field: "name", public: true, extra: "description text, duration_min integer, price numeric, currency text, is_active boolean, created_at timestamptz" },
  { table: "professionals", field: "name", public: true, extra: "title text, bio text, avatar_url text, active boolean, created_at timestamptz" },
  { table: "service_availability_rules", field: "start_time", type: "time", initial: "09:00", changed: "10:00" },
  { table: "availability", field: "start_time", type: "time", initial: "09:00", changed: "10:00" },
  { table: "customers", field: "full_name" },
  { table: "appointments", field: "notes" },
  { table: "tenant_payment_settings", field: "provider", key: "tenant_id", mode: "server" },
  { table: "payments", field: "status", initial: "pending", changed: "paid" },
  { table: "payment_intents", field: "status", initial: "created", changed: "pending" },
  { table: "waitlist_requests", field: "notes" },
  { table: "tenant_billing_settings", field: "legal_name" },
  { table: "message_logs", field: "subject" },
  { table: "tenant_reviews", field: "comment", public: true, extra: "customer_name text, rating integer, created_at timestamptz, is_hidden boolean" },
  { table: "customer_tax_profiles", field: "legal_name" },
  { table: "dte_tenant_issuance_settings", field: "safe_blocking_reason", key: "tenant_id", mode: "read" },
  { table: "dte_payment_document_intents", field: "safe_blocking_reason", mode: "read" },
  { table: "dte_issuance_outbox", field: "last_safe_error", mode: "read" },
  { table: "dte_document_events", field: "event_type", bigint: true, mode: "read" },
  { table: "dte_sii_authorization_evidence", field: "observation", mode: "read" },
  { table: "dte_legal_activation", field: "pause_reason", key: "tenant_id", mode: "read", extra: "dte_type integer default 39" },
  { table: "dte_legal_activation_events", field: "event_type", bigint: true, mode: "read" },
  { table: "tenant_legal_profiles", field: "trade_name", key: "tenant_id", mode: "read" },
  { table: "legal_documents", field: "title", mode: "read" },
].map((s) => ({ key: "id", tenantKey: "tenant_id", mode: "write", type: "text", initial: "CIT64 synthetic fixture", changed: "CIT64 changed fixture", ...s }));

// Exact bounded sections, failing closed if a migration is reorganized. This
// avoids copying/reimplementing the policy under test or loading unrelated RPCs.
function section(path, start, end) {
  const sql = read(`migrations/${path}`);
  const from = sql.indexOf(start);
  const to = end ? sql.indexOf(end, from + start.length) : sql.length;
  assert.ok(from >= 0 && to > from, `SQL section missing: ${path}: ${start}`);
  return sql.slice(from, to);
}
const hardening = "202607230001_security_hardening.sql";
const securitySQL = [
  section(hardening, "create or replace function public.is_platform_admin", "alter table if exists public.appointments"),
  section(hardening, "-- Canonical tenant isolation."),
  section("202607240002_dte_automatic_issuance.sql", "alter table public.dte_tenant_issuance_settings enable row level security;", "revoke all on function public.dte_enqueue_payment_snapshot"),
  section("202607270001_dte_legal_activation.sql", "alter table public.customer_tax_profiles enable row level security;", "revoke all on function public.dte_complete_intent_snapshot"),
  section("202608020001_tenant_legal_privacy_gate.sql", "alter table public.tenant_legal_profiles enable row level security;", "revoke all on function public.publish_legal_document"),
  section("202609010002_cit59_provider_dte_commercial_readiness.sql", "alter table public.tenant_payment_settings enable row level security;", "-- Preserve the validation state"),
].join("\n");
const privacySQL = read("migrations/202609080001_cit64_public_tenant_privacy_hardening.sql");

function psql(database, input) {
  assert.match(database, /^(postgres|citaya_cit64_[a-f0-9]{32})$/);
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-qAt"], {
    input, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function fixture(s, tenant, index, fresh = false) {
  const row = { [s.key]: s.key === "tenant_id" ? tenant : s.bigint ? (fresh ? 3 : index + 1) : (fresh ? newId : ids[index]), [s.tenantKey]: tenant, [s.field]: s.initial };
  if (s.table === "tenants") Object.assign(row, { slug: `cit64-${index}`, address: "Synthetic private address", phone_display: "Synthetic private phone", city: "Synthetic city", show_address: false, show_phone: false });
  if (s.table === "tenant_members") Object.assign(row, { user_id: fresh ? outsider : [adminA, adminB][index], role: "admin", is_active: true });
  if (s.table === "services") row.is_active = true;
  if (s.table === "professionals") row.active = true;
  if (s.table === "tenant_reviews") row.is_hidden = false;
  return row;
}
function insert(s, row) {
  return `insert into public.${s.table} select * from jsonb_populate_record(null::public.${s.table}, ${quote(JSON.stringify(row))}::jsonb)`;
}
function setupSQL() {
  return `
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      if exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then
        raise exception 'Unsafe test roles: anon/authenticated bypass RLS';
      end if;
    end $$;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    revoke all on function auth.uid() from public;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    ${surfaces.map((s) => `create table public.${s.table} (
      ${s.key} ${s.bigint ? "bigint" : "uuid"} primary key,
      ${s.key !== s.tenantKey ? `${s.tenantKey} uuid not null,` : ""}
      ${s.field} ${s.type}${s.extra ? `, ${s.extra}` : ""}
    );`).join("\n")}
    create table public.platform_admins(user_id uuid primary key, role text, is_active boolean);
    -- Dependency stubs for the legal ACL block; no runtime coverage claimed.
    create table public.legal_acceptances(tenant_id uuid);
    create table public.tenant_dte_mandates(tenant_id uuid);
    create table public.marketing_consent_events(tenant_id uuid);
    create table public.marketing_suppressions(tenant_id uuid);
    -- Explicit historical Data API baseline. Final grants/revokes below are
    -- the migration's actual SQL. Do not grant privileges after hardening.
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    ${securitySQL}
    ${surfaces.flatMap((s) => [insert(s, fixture(s, A, 0)), insert(s, fixture(s, B, 1))]).join(";\n")};
    insert into public.platform_admins values (${quote(platform)}, 'super_admin', true);
  `;
}
function roleSQL(role, uid) {
  return `set local role ${role}; select set_config('request.jwt.claim.sub', ${quote(uid ?? "")}, true);
    do $$ begin
      if current_user <> ${quote(role)} or session_user <> 'postgres' then raise exception 'Actor not switched'; end if;
      if current_setting('row_security') <> 'on' then raise exception 'RLS disabled'; end if;
    end $$;`;
}
function selectSQL(s, role, uid, tenant, expected, columns = "*", allowDenied = expected === 0) {
  return `begin; ${roleSQL(role, uid)}
    do $$ declare n integer; begin
      begin
        select count(*) into n from (select ${columns} from public.${s.table} ${tenant ? `where ${s.tenantKey}=${quote(tenant)}` : ""}) selected;
        if n <> ${expected} then raise exception 'CIT64 ${s.table}: expected ${expected} rows, got %', n; end if;
      exception when insufficient_privilege then
        ${allowDenied ? "null;" : "raise;"}
      end;
    end $$; rollback;`;
}
const snapshot = (s, where = "true") => `(select coalesce(jsonb_agg(to_jsonb(r) order by r.${s.key}), '[]'::jsonb) from public.${s.table} r where ${where})`;

// Every attempted mutation checks affected rows AND a postgres observer's full
// table snapshot before rollback. Only SQLSTATE 42501 counts as access denied;
// unique/FK/check/syntax errors fail the test instead of masquerading as RLS.
function mutationSQL(s, { role, uid, tenant, operation, allowed, foreign }) {
  const key = s.tenantKey;
  const predicate = `${key}=${quote(tenant)}`;
  let precondition = "";
  let statement;
  if (operation === "insert") {
    // Singleton keys already exist. Remove only the target fixture as postgres
    // inside this transaction, so an INSERT is valid and cannot pass on 23505.
    if (s.key === s.tenantKey) precondition = `delete from public.${s.table} where ${predicate};`;
    statement = insert(s, fixture(s, tenant, tenant === A ? 0 : 1, true));
  } else if (operation === "move") {
    statement = `update public.${s.table} set ${key}=${quote(foreign)} where ${predicate}`;
  } else if (operation === "update") {
    statement = `update public.${s.table} set ${s.field}=${quote(s.changed)} where ${predicate}`;
  } else {
    statement = `delete from public.${s.table} where ${predicate}`;
  }
  return `begin;
    ${precondition}
    create temp table cit64_before as select ${snapshot(s)} as whole,
      ${snapshot(s, `${key}<>${quote(tenant)}`)} as other;
    ${roleSQL(role, uid)}
    do $$ declare n integer; begin
      begin
        ${statement}; get diagnostics n = row_count;
        if n <> ${allowed ? 1 : 0} then raise exception 'CIT64 ${s.table} ${operation}: expected ${allowed ? 1 : 0} affected rows, got %', n; end if;
      exception when insufficient_privilege then ${allowed ? "raise;" : "null;"} end;
    end $$;
    reset role;
    do $$ begin
      if ${snapshot(s)} ${allowed ? "=" : "<>"} (select whole from cit64_before) then
        raise exception 'CIT64 ${s.table} ${operation}: observer ${allowed ? "did not see authorized mutation" : "detected forbidden mutation"}';
      end if;
      if ${snapshot(s, `${key}<>${quote(tenant)}`)} <> (select other from cit64_before) then
        raise exception 'CIT64 ${s.table} ${operation}: other tenant changed';
      end if;
    end $$;
    rollback;`;
}

test("CIT-64 PostgreSQL A/B: real RLS/ACL on disposable local schema projections", async (t) => {
  const database = `citaya_cit64_${randomUUID().replaceAll("-", "")}`;
  psql("postgres", `create database ${database} template template0;`);
  try {
    psql(database, setupSQL());
    await t.test("pre-CIT64 anon contact leak is reproduced, then full CIT64 migration closes it", () => {
      const tenants = surfaces[0];
      psql(database, selectSQL(tenants, "anon", null, null, 2, "address, phone_display"));
      // Exercise removal of historical table AND column grants and temp policy.
      psql(database, `grant select on public.tenants to anon;
        create policy temp_allow_select_for_subdomain on public.tenants for select to anon using (true);
        ${privacySQL}\n${privacySQL}`);
      for (const column of ["address", "phone_display", "*"]) {
        psql(database, `begin;
          update public.tenants set show_address=true, show_phone=true;
          ${roleSQL("anon", null)} do $$ begin
          begin perform ${column} from public.tenants; raise exception 'CIT64 private column exposed';
          exception when insufficient_privilege then null; end;
        end $$; rollback;`);
      }
      psql(database, selectSQL(tenants, "anon", null, null, 2, "id, slug, name, logo_url, city, description, show_address, show_phone"));
      assert.equal(psql(database, "select count(*) from pg_policies where tablename='tenants' and policyname='temp_allow_select_for_subdomain'"), "0");
    });

    await t.test("fixtures and actor roles cannot make negative assertions vacuously pass", () => {
      for (const s of surfaces) {
        assert.equal(psql(database, `select count(*) from public.${s.table}`), "2", s.table);
        assert.equal(psql(database, `select relrowsecurity and relowner <> 'authenticated'::regrole and relowner <> 'anon'::regrole from pg_class where oid='public.${s.table}'::regclass`), "t", s.table);
      }
      psql(database, `begin; ${roleSQL("authenticated", adminA)} do $$ begin
        if not public.is_tenant_member(${quote(A)}) or public.is_tenant_member(${quote(B)}) or public.is_platform_admin() then raise exception 'Bad A identity'; end if;
      end $$; rollback;
      begin; ${roleSQL("authenticated", platform)} do $$ begin
        if not public.is_platform_admin() or public.is_tenant_member(${quote(A)}) or public.is_tenant_member(${quote(B)}) then raise exception 'Platform must have no tenant membership'; end if;
      end $$; rollback;`);
    });

    for (const s of surfaces) {
      await t.test(`${s.table}: A/B SELECT + INSERT/UPDATE/DELETE, outsider, super_admin, anon (${s.mode})`, () => {
        const sql = [];
        for (const [uid, own, foreign] of [[adminA, A, B], [adminB, B, A]]) {
          sql.push(selectSQL(s, "authenticated", uid, own, s.mode === "server" ? 0 : 1));
          sql.push(selectSQL(s, "authenticated", uid, foreign, 0));
          sql.push(selectSQL(s, "authenticated", uid, null, s.mode === "server" ? 0 : 1));
          for (const operation of ["insert", "update", "delete"]) {
            sql.push(mutationSQL(s, { role: "authenticated", uid, tenant: own, operation, allowed: s.mode === "write" }));
            sql.push(mutationSQL(s, { role: "authenticated", uid, tenant: foreign, operation, allowed: false }));
          }
          // USING passes on own row, WITH CHECK must reject moving it to B/A.
          // For singleton tables remove foreign target to avoid PK collision.
          const move = mutationSQL(s, { role: "authenticated", uid, tenant: own, operation: "move", allowed: false, foreign });
          sql.push(s.key === s.tenantKey ? move.replace("begin;", `begin; delete from public.${s.table} where ${s.tenantKey}=${quote(foreign)};`) : move);
        }
        for (const tenant of [A, B]) {
          sql.push(selectSQL(s, "authenticated", outsider, tenant, 0));
          sql.push(selectSQL(s, "authenticated", platform, tenant, s.mode === "server" ? 0 : 1));
          const anonColumns = s.table === "tenants" ? "id,slug,name" : s.public ? `id,tenant_id,${s.field}` : "*";
          sql.push(selectSQL(s, "anon", null, tenant, s.public || s.table === "tenants" ? 1 : 0, anonColumns));
          for (const [role, uid] of [["authenticated", outsider], ["anon", null]]) {
            for (const operation of ["insert", "update", "delete"]) sql.push(mutationSQL(s, { role, uid, tenant, operation, allowed: false }));
          }
          // Platform access follows explicit policies; server/read-only tables
          // remain unwritable even for an active super_admin JWT.
          for (const operation of ["insert", "update", "delete"]) sql.push(mutationSQL(s, { role: "authenticated", uid: platform, tenant, operation, allowed: s.mode === "write" }));
        }
        psql(database, sql.join("\n"));
      });
    }

    await t.test("anon sees only active services/professionals and visible reviews", () => {
      for (const s of surfaces.filter((s) => s.public)) {
        const flag = s.table === "services" ? "is_active" : s.table === "professionals" ? "active" : "is_hidden";
        psql(database, `update public.${s.table} set ${flag}=${s.table === "tenant_reviews" ? "true" : "false"} where tenant_id=${quote(B)};`);
        psql(database, selectSQL(s, "anon", null, A, 1, `id,tenant_id,${s.field}`));
        psql(database, selectSQL(s, "anon", null, B, 0, `id,tenant_id,${s.field}`, false));
        psql(database, selectSQL(s, "authenticated", adminB, B, 1));
      }
    });

    await t.test("legacy rls_matrix.sql also executes real assertions against these fixtures", () => {
      psql(database, read("tests/security/rls_matrix.sql"));
    });

    await t.test("negative controls detect a permissive policy and a leaked anon grant", () => {
      // Deliberately weaken only this disposable DB inside rollback transactions.
      // The same assertions must FAIL with their own message, never an SQL error.
      const probe = (sql, expected) => {
        assert.throws(() => psql(database, sql), expected);
      };
      const customers = surfaces.find((s) => s.table === "customers");
      const inject = (sql, drift) => sql.replace("begin;", `begin; ${drift};`);
      probe(inject(selectSQL(customers, "authenticated", adminA, B, 0),
        "create policy cit64_bad_select on public.customers for select to authenticated using(true)"), /expected 0 rows, got 1/);
      probe(inject(mutationSQL(customers, { role: "authenticated", uid: adminA, tenant: B, operation: "update", allowed: false }),
        "create policy cit64_bad_write on public.customers for all to authenticated using(true) with check(true)"), /expected 0 affected rows, got 1/);
      probe(inject(mutationSQL(customers, { role: "authenticated", uid: adminA, tenant: A, foreign: B, operation: "move", allowed: false }),
        // UPDATE also enforces SELECT visibility of the new row. Open that
        // second guard in this control so it cannot mask a broken WITH CHECK.
        "create policy cit64_bad_move_read on public.customers for select to authenticated using(true); create policy cit64_bad_check on public.customers for update to authenticated using(public.is_tenant_member(tenant_id)) with check(true)"), /expected 0 affected rows, got 1/);
      probe(inject(selectSQL(surfaces[0], "anon", null, A, 0, "address"),
        "grant select(address) on public.tenants to anon"), /expected 0 rows, got 1/);
    });
    t.diagnostic(`RUNTIME: ${surfaces.length} table projections; migrations supply actual policies/helpers/ACLs; full CIT64 privacy migration applied locally twice.`);
    t.diagnostic("NOT COVERED: campaigns (no canonical table/policy found); legal_acceptances, tenant_dte_mandates, marketing_consent_events, marketing_suppressions (dependency stubs only); other billing/retention/production/certification/storage tables, RPCs, child-FK integrity, API/service_role boundaries and deployed ACL drift.");
  } finally {
    psql("postgres", `drop database if exists ${database} with (force);`);
  }
});
