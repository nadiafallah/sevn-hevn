// Runs every migration in supabase/migrations against an in-process Postgres 17 (PGlite) with
// small stand-ins for Supabase's roles, Storage, Vault and pg_net, then checks the access rules.
// Run with: npm run db:test   (no Docker, no network, never touches a remote database)
import { test } from "node:test";
import assert from "node:assert/strict";
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
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table vault.store (name text primary key, decrypted_secret text);
  create view vault.decrypted_secrets as select name, decrypted_secret from vault.store;
  create table net.calls (url text, headers jsonb, body jsonb);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language sql as $$ insert into net.calls values (url, headers, body); select 1::bigint $$;
  -- Supabase grants table privileges to the API roles by default; RLS and revokes must hold regardless.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

async function freshDb() {
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

async function as(db, role, sql, params) {
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

const rejects = (p, pattern) => assert.rejects(p, pattern);

test("migrations apply cleanly, twice in separate databases", async () => {
  await freshDb();
  await freshDb();
});

test("public can read only published products and their images", async () => {
  const db = await freshDb();
  await db.exec(`
    insert into public.products (ref, published, status, name, category) values
      ('SH-0001', true, 'enquiry_only', 'Published piece', 'bags'),
      ('SH-0002', false, 'enquiry_only', 'Draft piece', 'bags');
    insert into public.product_images (product_ref, storage_path, alt) values
      ('SH-0001', 'SH-0001/front.jpg', 'Front'),
      ('SH-0002', 'SH-0002/front.jpg', 'Front');
  `);
  for (const role of ["anon", "authenticated"]) {
    const p = await as(db, role, "select ref from public.products order by ref");
    assert.deepEqual(p.rows.map((r) => r.ref), ["SH-0001"]);
    const i = await as(db, role, "select product_ref from public.product_images");
    assert.deepEqual(i.rows.map((r) => r.product_ref), ["SH-0001"]);
  }
});

test("public cannot insert, update or delete catalogue rows", async () => {
  const db = await freshDb();
  await db.exec(`insert into public.products (ref, published, name, category) values ('SH-0001', true, 'Piece', 'bags')`);
  for (const role of ["anon", "authenticated"]) {
    await rejects(as(db, role, `insert into public.products (ref, name, category) values ('X-1', 'x', 'bags')`), /permission denied/);
    await rejects(as(db, role, `update public.products set price_aed = 1 where ref = 'SH-0001'`), /permission denied/);
    await rejects(as(db, role, `delete from public.products where ref = 'SH-0001'`), /permission denied/);
    await rejects(as(db, role, `insert into public.product_images (product_ref, storage_path, alt) values ('SH-0001', 'a.jpg', 'a')`), /permission denied/);
  }
  const still = await db.query(`select price_aed from public.products where ref = 'SH-0001'`);
  assert.equal(still.rows[0].price_aed, null);
});

test("public cannot read or write enquiries; the server can insert", async () => {
  const db = await freshDb();
  const insert = `insert into public.enquiries (kind, contact_method, contact_value, message) values ('sourcing', 'email', 'a@b.co', 'Hello') returning reference`;
  for (const role of ["anon", "authenticated"]) {
    await rejects(as(db, role, "select * from public.enquiries"), /permission denied/);
    await rejects(as(db, role, insert), /permission denied/);
  }
  const r = await as(db, "service_role", insert);
  assert.match(r.rows[0].reference, /^[0-9A-F]{8}$/);
});

test("product states follow the brief", async () => {
  const db = await freshDb();
  const add = (cols) =>
    db.query(`insert into public.products (ref, name, category, status, price_aed, stock, delivery, brand)
              values ($1, 'x', 'bags', $2, $3, $4, $5, $6)`, cols);
  await rejects(add(["A-1", "available", null, 1, "Dubai", null]), /available_needs_price_stock_delivery/);
  await rejects(add(["A-2", "available", 1000, 0, "Dubai", null]), /available_needs_price_stock_delivery/);
  await rejects(add(["A-3", "available", 1000, 1, "  ", null]), /available_needs_price_stock_delivery/);
  await add(["A-4", "available", 1000, 1, "Dubai", "Hermès"]);
  await add(["A-5", "enquiry_only", null, null, null, "Rolex"]);
  await add(["A-6", "sold", 1000, 0, null, null]);
  await rejects(add(["E-1", "editorial_preview", 1000, null, null, null]), /editorial_preview_is_not_inventory/);
  await rejects(add(["E-2", "editorial_preview", null, null, null, "Gucci"]), /editorial_preview_is_not_inventory/);
  await rejects(add(["A-0", "enquiry_only", 0, null, null, null]), /price_aed_check/);
  await rejects(add(["bad ref", "enquiry_only", null, null, null, null]), /products_ref_check/);
  await rejects(add(["a-4", "enquiry_only", null, null, null, null]), /products_ref_upper_key/);
  await rejects(db.query(`insert into public.products (ref, name, category) values ('C-1', 'x', 'cars')`), /products_category_check/);
});

test("image paths cannot escape the bucket folder", async () => {
  const db = await freshDb();
  await db.exec(`insert into public.products (ref, name, category) values ('SH-1', 'x', 'bags')`);
  for (const bad of ["../secret.jpg", "/abs.jpg", "a/../../b.jpg", "https://evil.example/x.jpg"]) {
    await rejects(db.query(`insert into public.product_images (product_ref, storage_path, alt) values ('SH-1', $1, 'a')`, [bad]), /check/);
  }
});

test("enquiries are rate limited per sender", async () => {
  const db = await freshDb();
  const insert = `insert into public.enquiries (kind, contact_method, contact_value, message, client_hash) values ('viewing', 'phone', '+971500000000', 'Hi', 'h1')`;
  for (let i = 0; i < 5; i++) await as(db, "service_role", insert);
  await rejects(as(db, "service_role", insert), /rate_limited/);
  await as(db, "service_role", insert.replace("'h1'", "'h2'"));
});

test("catalogue changes notify the website only when Vault is configured", async () => {
  const db = await freshDb();
  await db.exec(`insert into public.products (ref, name, category) values ('SH-1', 'x', 'bags')`);
  assert.equal((await db.query("select count(*)::int as n from net.calls")).rows[0].n, 0);
  await db.exec(`insert into vault.store values ('catalog_revalidate_url', 'https://example.test/api/revalidate'), ('catalog_revalidate_secret', 's3cret')`);
  await as(db, "service_role", `update public.products set published = true where ref = 'SH-1'`);
  const calls = (await db.query("select url, headers from net.calls")).rows;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.test/api/revalidate");
  assert.equal(calls[0].headers["x-revalidate-secret"], "s3cret");
  // The trigger function must not be callable by the public roles.
  await rejects(as(db, "anon", "select public.notify_catalog_change()"), /permission denied|trigger functions can only be called as triggers/);
});

test("storage bucket is public-read with image-only uploads", async () => {
  const db = await freshDb();
  const b = (await db.query("select * from storage.buckets where id = 'product-images'")).rows[0];
  assert.equal(b.public, true);
  assert.deepEqual(b.allowed_mime_types, ["image/jpeg", "image/png", "image/webp", "image/avif"]);
});
