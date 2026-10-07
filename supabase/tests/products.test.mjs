// Access rules and behaviour of products in the private panel (20261007120000_panel_products.sql).
// Run with: npm run db:test   (in-process Postgres; never touches a remote database)
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { as, asUser, freshDb } from "./harness.mjs";

const rejects = (p, pattern) => assert.rejects(p, pattern);

const OWNER = randomUUID();
const STAFF = randomUUID();
const OUTSIDER = randomUUID();
const photo = (ref) => `${ref}/${randomUUID()}.jpg`;

async function setup() {
  const db = await freshDb();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at) values
       ($1, 'owner@example.test', now()), ($2, 'staff@example.test', now()), ($3, 'outsider@example.test', now())`,
    [OWNER, STAFF, OUTSIDER],
  );
  await db.exec(`insert into public.staff_members (email, display_name, role) values
    ('owner@example.test', 'Owner', 'owner'), ('staff@example.test', 'Sara', 'staff')`);
  await asUser(db, OWNER, "select public.admin_session()");
  await asUser(db, STAFF, "select public.admin_session()");
  return db;
}

const save = (db, user, ref, fields) => asUser(db, user, "select public.admin_save_product($1, $2) as ref", [ref, fields]).then((r) => r.rows[0].ref);
const addPhoto = (db, user, ref, path = photo(ref)) =>
  asUser(db, user, "select public.admin_add_product_image($1, $2, 1600, 2000, 'Front view') as id", [ref, path]).then((r) => r.rows[0].id);

test("the owner adds a piece: next SH reference, saved as an unpublished draft, logged", async () => {
  const db = await setup();
  const ref = await save(db, OWNER, null, { name: "Kelly 28", category: "bags", brand: "Hermès", price_aed: "85000", included: ["Box", " ", "Dust bag"] });
  assert.equal(ref, "SH-0001");
  assert.equal(await save(db, OWNER, null, { name: "Royal Oak", category: "watches" }), "SH-0002");
  const [p] = (await db.query("select * from public.products where ref = 'SH-0001'")).rows;
  assert.equal(p.published, false);
  assert.equal(p.status, "enquiry_only");
  assert.equal(p.price_aed, 85000);
  assert.deepEqual(p.included, ["Box", "Dust bag"]);
  const log = await db.query("select action, entity_id from public.audit_log where entity = 'product' order by id");
  assert.deepEqual(log.rows.map((r) => r.action), ["product.created", "product.created"]);
});

test("only the four active categories and the real-piece states can be chosen", async () => {
  const db = await setup();
  await rejects(save(db, OWNER, null, { name: "Ring", category: "jewellery" }), /invalid_request/);
  await rejects(save(db, OWNER, null, { name: "Bag", category: "bags", status: "editorial_preview" }), /invalid_request/);
  await rejects(save(db, OWNER, null, { name: "Bag", category: "bags", secret_note: "x" }), /invalid_request/);
  await rejects(save(db, OWNER, null, { name: " ", category: "bags" }), /invalid_request/);
  await rejects(save(db, OWNER, null, { name: "Bag", category: "bags", price_aed: "0" }), /invalid_request/);
  await rejects(save(db, OWNER, null, { name: "Bag", category: "bags", price_aed: "lots" }), /invalid_request/);
  for (const c of ["bags", "watches", "shoes", "accessories"]) await save(db, OWNER, null, { name: c, category: c });
});

test("staff and other accounts cannot change products; the public cannot call the functions", async () => {
  const db = await setup();
  const ref = await save(db, OWNER, null, { name: "Kelly 28", category: "bags" });
  await rejects(save(db, STAFF, null, { name: "x", category: "bags" }), /owner_only/);
  await rejects(save(db, STAFF, ref, { price_aed: "1" }), /owner_only/);
  await rejects(addPhoto(db, STAFF, ref), /owner_only/);
  await rejects(asUser(db, STAFF, "select public.admin_delete_product($1)", [ref]), /owner_only/);
  await rejects(save(db, OUTSIDER, ref, { price_aed: "1" }), /owner_only/);
  await rejects(as(db, "anon", "select public.admin_save_product(null, '{\"name\":\"x\",\"category\":\"bags\"}')"), /permission denied/);
  await rejects(asUser(db, STAFF, "update public.products set price_aed = 1"), /permission denied/);
  await rejects(as(db, "anon", "select private.next_product_ref()"), /permission denied/);
});

test("the team sees drafts; other accounts and the public see published pieces only", async () => {
  const db = await setup();
  const draft = await save(db, OWNER, null, { name: "Draft", category: "bags" });
  const live = await save(db, OWNER, null, { name: "Live", category: "shoes" });
  await addPhoto(db, OWNER, live);
  await save(db, OWNER, live, { published: true });
  const refs = async (fn) => (await fn("select ref from public.products order by ref")).rows.map((r) => r.ref);
  assert.deepEqual(await refs((q) => asUser(db, STAFF, q)), [draft, live]);
  assert.deepEqual(await refs((q) => asUser(db, OWNER, q)), [draft, live]);
  assert.deepEqual(await refs((q) => asUser(db, OUTSIDER, q)), [live]);
  assert.deepEqual(await refs((q) => as(db, "anon", q)), [live]);
});

test("publishing needs a photo; 'available' needs a price, stock and delivery details", async () => {
  const db = await setup();
  const ref = await save(db, OWNER, null, { name: "Daytona", category: "watches" });
  await rejects(save(db, OWNER, ref, { published: true }), /needs_photo/);
  await rejects(save(db, OWNER, null, { name: "x", category: "bags", published: true }), /needs_photo/);
  await addPhoto(db, OWNER, ref);
  await save(db, OWNER, ref, { published: true });
  await rejects(save(db, OWNER, ref, { status: "available" }), /available_incomplete/);
  await save(db, OWNER, ref, { status: "available", price_aed: "120000", stock: "1", delivery: "Dubai: same day" });
  const [p] = (await db.query("select status, published from public.products where ref = $1", [ref])).rows;
  assert.deepEqual(p, { status: "available", published: true });
  // An empty value clears an optional field.
  await save(db, OWNER, ref, { status: "enquiry_only", price_aed: "" });
  assert.equal((await db.query("select price_aed from public.products where ref = $1", [ref])).rows[0].price_aed, null);
});

test("photos: kept in the piece's folder, at most 12, main photo first, last photo of a live piece stays", async () => {
  const db = await setup();
  const ref = await save(db, OWNER, null, { name: "Loafers", category: "shoes" });
  await rejects(addPhoto(db, OWNER, ref, `SH-9999/${randomUUID()}.jpg`), /invalid_request/);
  await rejects(addPhoto(db, OWNER, ref, `${ref}/../x.jpg`), /invalid_request/);
  const a = await addPhoto(db, OWNER, ref);
  const b = await addPhoto(db, OWNER, ref);
  const c = await addPhoto(db, OWNER, ref);
  await asUser(db, OWNER, "select public.admin_set_main_product_image($1)", [c]);
  const order = async () => (await db.query("select id, position from public.product_images where product_ref = $1 order by position", [ref])).rows;
  assert.deepEqual((await order()).map((r) => [String(r.id), r.position]), [[String(c), 0], [String(a), 1], [String(b), 2]]);
  const path = (await asUser(db, OWNER, "select public.admin_delete_product_image($1) as p", [a])).rows[0].p;
  assert.match(path, new RegExp(`^${ref}/`));
  assert.deepEqual((await order()).map((r) => r.position), [0, 1]);
  for (let i = 0; i < 10; i++) await addPhoto(db, OWNER, ref);
  await rejects(addPhoto(db, OWNER, ref), /photo_limit/);
  // A published piece keeps at least one photo.
  const solo = await save(db, OWNER, null, { name: "Belt", category: "accessories" });
  const only = await addPhoto(db, OWNER, solo);
  await save(db, OWNER, solo, { published: true });
  await rejects(asUser(db, OWNER, "select public.admin_delete_product_image($1)", [only]), /needs_photo/);
});

test("photo files: only the owner may upload or delete them; nobody can list them publicly", async () => {
  const db = await setup();
  const ins = (who, name) => (who === "anon" ? as(db, "anon", "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [name])
    : asUser(db, who, "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [name]));
  await ins(OWNER, "SH-0001/a.jpg");
  await rejects(ins(STAFF, "SH-0001/b.jpg"), /row-level security/);
  await rejects(ins(OUTSIDER, "SH-0001/c.jpg"), /row-level security/);
  await rejects(ins("anon", "SH-0001/d.jpg"), /row-level security/);
  assert.equal((await as(db, "anon", "select name from storage.objects where bucket_id = 'product-images'")).rows.length, 0);
  assert.equal((await asUser(db, STAFF, "delete from storage.objects where bucket_id = 'product-images' returning name")).rows.length, 0);
  assert.equal((await asUser(db, OWNER, "delete from storage.objects where bucket_id = 'product-images' returning name")).rows.length, 1);
});

test("deleting a piece removes its photo rows and returns the file paths, logged", async () => {
  const db = await setup();
  const ref = await save(db, OWNER, null, { name: "Scarf", category: "accessories" });
  const p1 = photo(ref);
  await addPhoto(db, OWNER, ref, p1);
  const paths = (await asUser(db, OWNER, "select public.admin_delete_product($1) as p", [ref])).rows[0].p;
  assert.deepEqual(paths, [p1]);
  assert.equal((await db.query("select count(*)::int as n from public.product_images where product_ref = $1", [ref])).rows[0].n, 0);
  const log = await db.query("select action from public.audit_log where entity_id = $1 order by id", [ref]);
  assert.deepEqual(log.rows.map((r) => r.action), ["product.created", "product.photo_added", "product.deleted"]);
});
