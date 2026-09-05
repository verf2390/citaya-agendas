import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "migrations/202609050001_cit65_storage_policy_hardening.sql";
const migration = readFileSync(migrationPath, "utf8");

test("CIT-65 migration validates policies before making changes", () => {
  const publicReadValidationIndex = migration.indexOf(
    "CIT65_UNEXPECTED_PUBLIC_READ_POLICY",
  );
  const unknownPolicyValidationIndex = migration.indexOf(
    "CIT65_UNREVIEWED_NEGATIVE_STORAGE_POLICY:",
  );
  const publicReadDropIndex = migration.indexOf(
    'drop policy if exists "Public read"',
  );

  assert.ok(publicReadValidationIndex >= 0);
  assert.ok(unknownPolicyValidationIndex > publicReadValidationIndex);
  assert.ok(publicReadDropIndex > unknownPolicyValidationIndex);
  assert.match(
    migration,
    /drop policy if exists "Public read" on storage\.objects/i,
  );
  assert.match(migration, /cmd is distinct from 'SELECT'/);
  assert.match(
    migration,
    /roles is distinct from array\['public'\]::name\[\]/,
  );
  assert.match(migration, /permissive is distinct from 'PERMISSIVE'/);
  assert.match(migration, /bucket_id\(::text\)\?<>'{2}dte-production-private/);
  assert.match(migration, /cmd in \('SELECT', 'ALL'\)/);
  assert.match(migration, /policyname <> 'Public read'/);
  assert.match(
    migration,
    /CIT65_UNREVIEWED_NEGATIVE_STORAGE_POLICY:/,
  );
  assert.doesNotMatch(
    migration,
    /execute[\s\S]*drop policy if exists %I/i,
  );
  assert.match(migration, /update storage\.buckets[\s\S]*public = false[\s\S]*id = 'dte-production-private'/i);
  assert.match(migration, /for all to service_role/i);
  assert.match(
    migration,
    /with check \(bucket_id = 'dte-production-private'\)/i,
  );
  assert.doesNotMatch(
    migration,
    /create\s+policy[\s\S]*?for\s+select[\s\S]*?bucket_id\s*(?:<>|!=)/i,
  );
  assert.doesNotMatch(migration, /delete\s+from|truncate|drop\s+(?:table|schema)/i);
});

test("PostgreSQL removes the expected historical Public read policy", () => {
  const database = `citaya_cit65_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync(
    "docker",
    [
      "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
      "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
      `create database ${database}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(create.status, 0, create.stderr);

  const bootstrap = `
    begin;
    create schema storage;
    create table storage.buckets(
      id text primary key,
      name text not null,
      public boolean not null default false
    );
    create table storage.objects(
      id bigint primary key,
      bucket_id text not null,
      name text not null
    );
    alter table storage.objects enable row level security;
    alter role service_role bypassrls;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select, insert, update, delete on storage.objects
      to anon, authenticated, service_role;

    insert into storage.buckets(id, name, public) values
      ('dte-production-private', 'dte-production-private', true),
      ('tenant-private-assets', 'tenant-private-assets', false),
      ('campaign-assets', 'campaign-assets', false);
    insert into storage.objects(id, bucket_id, name) values
      (1, 'dte-production-private', 'tenant-a/document.xml'),
      (2, 'tenant-private-assets', 'tenant-a/private.txt'),
      (3, 'campaign-assets', 'campaigns/tenant-a/drafts/image.png');

    create policy "Public read" on storage.objects
      for select to public
      using (bucket_id <> 'dte-production-private');
  `;

  const assertions = `
    do $$
    declare
      negative_policy_count integer;
      service_policy_count integer;
      dte_bucket_is_public boolean;
    begin
      select count(*) into negative_policy_count
        from pg_catalog.pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and cmd in ('SELECT', 'ALL')
         and pg_catalog.regexp_replace(
               pg_catalog.lower(coalesce(qual, '')),
               '[[:space:]()]', '', 'g'
             ) ~ 'bucket_id(<>|!=)|not(bucket_id|[a-z_][a-z0-9_]*\\.bucket_id)=|(bucket_id|[a-z_][a-z0-9_]*\\.bucket_id)isdistinctfrom';
      if negative_policy_count <> 0 then
        raise exception 'CIT65_NEGATIVE_SELECT_POLICY_REMAINS';
      end if;

      select count(*) into service_policy_count
        from pg_catalog.pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and policyname = 'dte_production_service_role_only'
         and cmd = 'ALL'
         and roles = array['service_role']::name[]
         and qual like '%bucket_id%=%dte-production-private%'
         and with_check like '%bucket_id%=%dte-production-private%';
      if service_policy_count <> 1 then
        raise exception 'CIT65_SERVICE_ROLE_POLICY_MISSING';
      end if;

      select public into dte_bucket_is_public
        from storage.buckets where id = 'dte-production-private';
      if dte_bucket_is_public is distinct from false then
        raise exception 'CIT65_DTE_BUCKET_NOT_PRIVATE';
      end if;
    end;
    $$;

    set local role anon;
    do $$
    begin
      if (select count(*) from storage.objects) <> 0 then
        raise exception 'CIT65_ANON_HAS_GLOBAL_READ';
      end if;
      if (select count(*) from storage.objects
           where bucket_id = 'tenant-private-assets') <> 0 then
        raise exception 'CIT65_ANON_READ_PRIVATE_NON_DTE';
      end if;
      if (select count(*) from storage.objects
           where bucket_id = 'dte-production-private') <> 0 then
        raise exception 'CIT65_ANON_READ_PRIVATE_DTE';
      end if;
    end;
    $$;
    reset role;

    set local role authenticated;
    do $$
    begin
      if (select count(*) from storage.objects) <> 0 then
        raise exception 'CIT65_AUTHENTICATED_HAS_GLOBAL_READ';
      end if;
      if (select count(*) from storage.objects
           where bucket_id = 'dte-production-private') <> 0 then
        raise exception 'CIT65_AUTHENTICATED_READ_PRIVATE_DTE';
      end if;
    end;
    $$;
    reset role;

    set local role service_role;
    do $$
    begin
      if (select count(*) from storage.objects
           where bucket_id = 'dte-production-private') <> 1 then
        raise exception 'CIT65_SERVICE_ROLE_CANNOT_READ_DTE';
      end if;
      if (select count(*) from storage.objects) <> 3 then
        raise exception 'CIT65_SERVICE_ROLE_BYPASSRLS_NOT_MODELED';
      end if;
    end;
    $$;
    reset role;
    rollback;
  `;

  try {
    const run = spawnSync(
      "docker",
      [
        "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-v", "ON_ERROR_STOP=1",
      ],
      {
        input: `${bootstrap}\n${migration}\n${assertions}`,
        encoding: "utf8",
      },
    );
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

    const verify = spawnSync(
      "docker",
      [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-Atc", "select to_regclass('storage.objects') is null",
      ],
      { encoding: "utf8" },
    );
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(
      verify.stdout.trim(),
      "t",
      "the local test transaction did not roll back",
    );
  } finally {
    const drop = spawnSync(
      "docker",
      [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
        `drop database if exists ${database}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(drop.status, 0, drop.stderr);
  }
});

test("PostgreSQL applies CIT-65 when Public read is already absent", () => {
  const database = `citaya_cit65_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync(
    "docker",
    [
      "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
      "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
      `create database ${database}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(create.status, 0, create.stderr);

  const bootstrap = `
    create schema storage;
    create table storage.buckets(
      id text primary key,
      name text not null,
      public boolean not null default false
    );
    create table storage.objects(
      id bigint primary key,
      bucket_id text not null,
      name text not null
    );
    alter table storage.objects enable row level security;
    insert into storage.buckets(id, name, public) values
      ('dte-production-private', 'dte-production-private', true);
  `;

  try {
    const run = spawnSync(
      "docker",
      [
        "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-v", "ON_ERROR_STOP=1",
      ],
      { input: `${bootstrap}\n${migration}\n${migration}`, encoding: "utf8" },
    );
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

    const applied = spawnSync(
      "docker",
      [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-Atc",
        `select
           (select public from storage.buckets
             where id = 'dte-production-private'),
           (select count(*) from pg_catalog.pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and policyname = 'dte_production_service_role_only')`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(applied.stdout.trim(), "f|1");
  } finally {
    const drop = spawnSync(
      "docker",
      [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
        `drop database if exists ${database}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(drop.status, 0, drop.stderr);
  }
});

test("PostgreSQL rejects a different policy named Public read without changes", () => {
  const database = `citaya_cit65_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync(
    "docker",
    [
      "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
      "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
      `create database ${database}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(create.status, 0, create.stderr);

  const bootstrap = `
    create schema storage;
    create table storage.buckets(
      id text primary key,
      name text not null,
      public boolean not null default false
    );
    create table storage.objects(
      id bigint primary key,
      bucket_id text not null,
      name text not null
    );
    alter table storage.objects enable row level security;
    insert into storage.buckets(id, name, public) values
      ('dte-production-private', 'dte-production-private', true);
    create policy "Public read" on storage.objects
      for select to public
      using (bucket_id = 'campaign-assets');
    create policy retained_positive_policy on storage.objects
      for select to authenticated
      using (bucket_id = 'tenant-private-assets');
  `;

  try {
    const setup = spawnSync(
      "docker",
      [
        "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-v", "ON_ERROR_STOP=1",
      ],
      { input: bootstrap, encoding: "utf8" },
    );
    assert.equal(setup.status, 0, `${setup.stdout}\n${setup.stderr}`);

    const run = spawnSync(
      "docker",
      [
        "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-v", "ON_ERROR_STOP=1",
      ],
      { input: migration, encoding: "utf8" },
    );
    assert.notEqual(run.status, 0, run.stdout);
    assert.match(
      `${run.stdout}\n${run.stderr}`,
      /CIT65_UNEXPECTED_PUBLIC_READ_POLICY/,
    );

    const unchanged = spawnSync(
      "docker",
      [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-Atc",
        `select
           (select count(*) from pg_catalog.pg_policies
             where schemaname = 'storage' and tablename = 'objects'),
           (select public from storage.buckets
             where id = 'dte-production-private'),
           (select count(*) from pg_catalog.pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and policyname = 'dte_production_service_role_only')`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.equal(unchanged.stdout.trim(), "2|t|0");
  } finally {
    const drop = spawnSync(
      "docker",
      [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
        `drop database if exists ${database}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(drop.status, 0, drop.stderr);
  }
});

test("PostgreSQL rejects restrictive Public read without changes", () => {
  const database = `citaya_cit65_${randomUUID().replaceAll("-", "")}`;
  const create = spawnSync(
    "docker",
    [
      "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
      "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
      `create database ${database}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(create.status, 0, create.stderr);

  const bootstrap = `
    create schema storage;
    create table storage.buckets(
      id text primary key,
      name text not null,
      public boolean not null default false
    );
    create table storage.objects(
      id bigint primary key,
      bucket_id text not null,
      name text not null
    );
    alter table storage.objects enable row level security;
    insert into storage.buckets(id, name, public) values
      ('dte-production-private', 'dte-production-private', true);
    create policy "Public read" on storage.objects
      as restrictive
      for select to public
      using (bucket_id <> 'dte-production-private');
  `;

  try {
    const setup = spawnSync(
      "docker",
      [
        "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-v", "ON_ERROR_STOP=1",
      ],
      { input: bootstrap, encoding: "utf8" },
    );
    assert.equal(setup.status, 0, `${setup.stdout}\n${setup.stderr}`);

    const run = spawnSync(
      "docker",
      [
        "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-v", "ON_ERROR_STOP=1",
      ],
      { input: migration, encoding: "utf8" },
    );
    assert.notEqual(run.status, 0, run.stdout);
    assert.match(
      `${run.stdout}\n${run.stderr}`,
      /CIT65_UNEXPECTED_PUBLIC_READ_POLICY/,
    );

    const unchanged = spawnSync(
      "docker",
      [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", database, "-Atc",
        `select
           (select count(*) from pg_catalog.pg_policies
             where schemaname = 'storage' and tablename = 'objects'),
           (select public from storage.buckets
             where id = 'dte-production-private'),
           (select count(*) from pg_catalog.pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and policyname = 'dte_production_service_role_only'),
           (select permissive from pg_catalog.pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and policyname = 'Public read')`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.equal(unchanged.stdout.trim(), "1|t|0|RESTRICTIVE");
  } finally {
    const drop = spawnSync(
      "docker",
      [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
        `drop database if exists ${database}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(drop.status, 0, drop.stderr);
  }
});

for (const [policyName, qualification] of [
  ["unknown_not_equal_angle", "bucket_id <> 'dte-production-private'"],
  ["unknown_not_equal_bang", "bucket_id != 'dte-production-private'"],
  ["unknown_not_bucket_equal", "not bucket_id = 'dte-production-private'"],
  [
    "unknown_is_distinct_from",
    "bucket_id is distinct from 'dte-production-private'",
  ],
]) {
  test(`PostgreSQL fails closed without modifying unknown policy ${policyName}`, () => {
    const database = `citaya_cit65_${randomUUID().replaceAll("-", "")}`;
    const create = spawnSync(
      "docker",
      [
        "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
        "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
        `create database ${database}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(create.status, 0, create.stderr);

    const bootstrap = `
      create schema storage;
      create table storage.buckets(
        id text primary key,
        name text not null,
        public boolean not null default false
      );
      create table storage.objects(
        id bigint primary key,
        bucket_id text not null,
        name text not null
      );
      alter table storage.objects enable row level security;
      insert into storage.buckets(id, name, public) values
        ('dte-production-private', 'dte-production-private', true);
      create policy "Public read" on storage.objects
        for select to public
        using (bucket_id <> 'dte-production-private');
      create policy ${policyName} on storage.objects
        for select to authenticated
        using (${qualification});
    `;

    try {
      const setup = spawnSync(
        "docker",
        [
          "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
          "-d", database, "-v", "ON_ERROR_STOP=1",
        ],
        { input: bootstrap, encoding: "utf8" },
      );
      assert.equal(setup.status, 0, `${setup.stdout}\n${setup.stderr}`);

      const run = spawnSync(
        "docker",
        [
          "exec", "-i", "citaya-dte-sqltest", "psql", "-U", "postgres",
          "-d", database, "-v", "ON_ERROR_STOP=1",
        ],
        { input: migration, encoding: "utf8" },
      );
      assert.notEqual(run.status, 0, run.stdout);
      assert.match(
        `${run.stdout}\n${run.stderr}`,
        new RegExp(`CIT65_UNREVIEWED_NEGATIVE_STORAGE_POLICY:${policyName}`),
      );

      const unchanged = spawnSync(
        "docker",
        [
          "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
          "-d", database, "-Atc",
          `select
             (select count(*) from pg_catalog.pg_policies
               where schemaname = 'storage' and tablename = 'objects'),
             (select public from storage.buckets
               where id = 'dte-production-private'),
             (select count(*) from pg_catalog.pg_policies
               where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'dte_production_service_role_only')`,
        ],
        { encoding: "utf8" },
      );
      assert.equal(unchanged.status, 0, unchanged.stderr);
      assert.equal(unchanged.stdout.trim(), "2|t|0");
    } finally {
      const drop = spawnSync(
        "docker",
        [
          "exec", "citaya-dte-sqltest", "psql", "-U", "postgres",
          "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
          `drop database if exists ${database}`,
        ],
        { encoding: "utf8" },
      );
      assert.equal(drop.status, 0, drop.stderr);
    }
  });
}
