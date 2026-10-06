// Shared test harness: applies every migration in supabase/migrations to an in-process Postgres 17
// (PGlite) with small stand-ins for Supabase's roles, Auth, Storage, Vault and pg_net.
// Never touches a remote database.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const dir = join(import.meta.dirname, "..", "migrations");

const platformStandIns = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create schema storage;
  create schema vault;
  create schema net;
  create schema auth;
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null,
    owner uuid, created_at timestamptz default now(), unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  create table vault.store (name text primary key, decrypted_secret text);
  create view vault.decrypted_secrets as select name, decrypted_secret from vault.store;
  create table net.calls (url text, headers jsonb, body jsonb);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language sql as $$ insert into net.calls values (url, headers, body); select 1::bigint $$;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
  -- Same definition as Supabase (reads the legacy claim setting or the JSON claims set by PostgREST).
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  -- Supabase grants table privileges to the API roles by default; RLS and revokes must hold regardless.
  grant usage on schema public, storage, auth to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export async function freshDb() {
  const db = new PGlite();
  await db.exec(platformStandIns);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    // pg_net is a platform extension; the stand-in above provides net.http_post instead.
    const sql = readFileSync(join(dir, file), "utf8").replace(/create extension if not exists pg_net[^;]*;/i, "");
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
  }
  return db;
}

/** Runs one statement as a database role (anon, authenticated, service_role). */
export async function as(db, role, sql, params) {
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

/** Runs one statement as a signed-in user (role authenticated with the given auth.uid()). */
export async function asUser(db, userId, sql, params) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await as(db, "authenticated", sql, params);
  } finally {
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
