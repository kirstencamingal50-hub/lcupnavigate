import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { test } from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20261113230000_initial_navigate_schema.sql', import.meta.url);
const routeMigrationUrl = new URL('../supabase/migrations/20261114230000_route_save_rpc.sql', import.meta.url);
const migration = `${await readFile(migrationUrl, 'utf8')}\n${await readFile(routeMigrationUrl, 'utf8')}`;

test('Supabase schema applies, preserves data model coverage, and protects role assignment', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create schema storage;
      create role anon;
      create role authenticated;
      create role service_role;
      create table auth.users (
        id uuid primary key,
        email text,
        email_confirmed_at timestamptz,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (bucket_id text not null, name text not null);
    `);
    await db.exec(migration);

    const tables = await db.query(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `);
    const tableNames = new Set(tables.rows.map(row => row.table_name));
    for (const name of [
      'admin_profiles', 'categories', 'locations', 'rooms', 'facility_photos',
      'map_nodes', 'map_markers', 'map_connections', 'campus_routes',
      'campus_route_points', 'campus_route_segments', 'floor_plans',
      'announcements', 'favorites', 'audit_logs'
    ]) assert.ok(tableNames.has(name), `Missing table ${name}`);

    const relationships = await db.query(`
      select conname from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace
    `);
    const relationshipNames = new Set(relationships.rows.map(row => row.conname));
    for (const name of [
      'locations_parent_building_id_fkey', 'rooms_building_id_fkey', 'map_markers_location_id_fkey',
      'campus_routes_start_marker_id_fkey', 'campus_routes_destination_marker_id_fkey',
      'campus_route_points_route_id_fkey', 'floor_plans_building_id_fkey',
      'audit_logs_admin_legacy_id_fkey'
    ]) assert.ok(relationshipNames.has(name), `Missing PostgREST relationship ${name}`);

    const policies = await db.query(`
      select count(*)::int as count from pg_policies
      where schemaname = 'public'
    `);
    assert.ok(policies.rows[0].count >= 14, 'Expected RLS policies for public tables');

    await db.exec(`
      insert into auth.users (id, email, raw_user_meta_data)
      values ('10000000-0000-4000-8000-000000000001', 'editor@example.test',
              '{"role":"admin","active":true,"username":"editor"}');
    `);
    const signupProfile = await db.query(`
      select role, active, username from public.admin_profiles
      where id = '10000000-0000-4000-8000-000000000001'
    `);
    assert.deepEqual(signupProfile.rows[0], {
      role: 'editor',
      active: false,
      username: 'editor'
    });

    await db.exec(`
      insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
      values ('10000000-0000-4000-8000-000000000002', 'first-admin@example.test', now(),
              '{"role":"admin","active":false,"username":"first-admin"}');
    `);
    const bootstrap = await db.query(`
      select public.bootstrap_first_admin('10000000-0000-4000-8000-000000000002') as promoted
    `);
    assert.equal(bootstrap.rows[0].promoted, true);
    const promoted = await db.query(`
      select role, active from public.admin_profiles
      where id = '10000000-0000-4000-8000-000000000002'
    `);
    assert.deepEqual(promoted.rows[0], { role: 'admin', active: true });

    const secondBootstrap = await db.query(`
      select public.bootstrap_first_admin('10000000-0000-4000-8000-000000000001') as promoted
    `);
    assert.equal(secondBootstrap.rows[0].promoted, false);

    const buckets = await db.query('select id, public from storage.buckets order by id');
    assert.deepEqual(buckets.rows, [
      { id: 'campus-photos', public: false },
      { id: 'floor-plans', public: false }
    ]);
  } finally {
    await db.close();
  }
});

test('route save RPC atomically creates graph points and connections', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create schema storage;
      create role anon;
      create role authenticated;
      create role service_role;
      create table auth.users (
        id uuid primary key,
        email text,
        email_confirmed_at timestamptz,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (bucket_id text not null, name text not null);
    `);
    await db.exec(migration);
    await db.exec(`
      insert into public.locations (name, accessibility_status)
      values ('North Hall', true), ('South Hall', true), ('East Hall', true), ('West Hall', true);
      insert into public.map_markers (location_id, x, y, accessibility_status)
      values (1, 10, 20, true), (2, 40, 60, true), (3, 100, 120, true), (4, 130, 160, true);
    `);

    const saved = await db.query(`
      select public.save_campus_route(
        null, 'North to South', 1, 2, 'active', false, null, '[]'::jsonb, null
      ) as result
    `);
    assert.deepEqual(saved.rows[0].result, {
      id: 1,
      distance_map_units: 50,
      accessibility_status: false
    });
    const graph = await db.query(`
      select
        (select count(*)::int from public.campus_route_points) as points,
        (select count(*)::int from public.campus_route_segments) as segments,
        (select count(*)::int from public.map_connections) as connections
    `);
    assert.deepEqual(graph.rows[0], { points: 2, segments: 1, connections: 1 });

    await assert.rejects(
      db.query(`select public.save_campus_route(
        null, 'Duplicate', 1, 2, 'active', false, null, '[]'::jsonb, null
      )`),
      /identical route already exists/
    );
    await assert.rejects(
      db.query(`select public.save_campus_route(
        1, 'North to South', 1, 2, 'active', false, null,
        '[{"x":2000,"y":1,"floor_number":0}]'::jsonb, null
      )`),
      /outside the campus map bounds/
    );
    await assert.rejects(
      db.query(`select public.save_campus_route(
        null, 'Unverified accessible route', 3, 4, 'active', true, null, '[]'::jsonb, null
      )`),
      /Accessible routes require/
    );
    const routeCount = await db.query('select count(*)::int as count from public.campus_routes');
    assert.equal(routeCount.rows[0].count, 1, 'a rejected duplicate leaves no partial route');
    const graphAfterRejectedWrites = await db.query(`
      select
        (select count(*)::int from public.campus_route_points) as points,
        (select count(*)::int from public.campus_route_segments) as segments,
        (select count(*)::int from public.map_connections) as connections
    `);
    assert.deepEqual(graphAfterRejectedWrites.rows[0], { points: 2, segments: 1, connections: 1 });
  } finally {
    await db.close();
  }
});

test('schema migration contains no destructive data statements', () => {
  assert.doesNotMatch(migration, /^\s*drop\s+(table|database|schema)\b/im);
  assert.doesNotMatch(migration, /^\s*truncate\b/im);
  const deletes = migration.match(/^\s*delete\s+from\b[^;]*;/gim) || [];
  assert.ok(deletes.every(statement => /\bwhere\b/i.test(statement)), 'all deletes must be row-scoped');
});
