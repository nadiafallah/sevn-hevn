// The shop rules (20261013120000_shop_four_categories.sql): four categories, permitted houses
// (as changed by 20261028120000_shop_houses.sql), versions of a piece, and purchase requests from
// the checkout.
// Run with: npm run db:test   (in-process Postgres; never touches a remote database)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { applyMigration, as, asUser, freshDb } from "./harness.mjs";

const KEY = "test-server-key-0123456789abcdef0123456789abcdef";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const rejects = (p, pattern) => assert.rejects(p, pattern);
const OWNER = randomUUID();
const STAFF = randomUUID();

async function setup(db) {
  db ??= await freshDb();
  await db.query("insert into private.server_keys (name, sha256_hex) values ('concierge', $1) on conflict do nothing", [sha(KEY)]);
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'owner@example.test', now()), ($2, 'staff@example.test', now())`, [OWNER, STAFF]);
  await db.exec(`insert into public.staff_members (email, display_name, role) values ('owner@example.test', 'Owner', 'owner'), ('staff@example.test', 'Sara', 'staff')`);
  await asUser(db, OWNER, "select public.admin_session()");
  await asUser(db, STAFF, "select public.admin_session()");
  return db;
}

const save = (db, ref, fields, user = OWNER) => asUser(db, user, "select public.admin_save_product($1, $2) as ref", [ref, fields]).then((r) => r.rows[0].ref);
const addPhoto = (db, ref) => asUser(db, OWNER, "select public.admin_add_product_image($1, $2, 1600, 2000, 'Front') as id", [ref, `${ref}/${randomUUID()}.jpg`]).then((r) => r.rows[0].id);
const product = async (db, ref) => (await db.query("select * from public.products where ref = $1", [ref])).rows[0];

test("houses: spellings are normalised, and only permitted houses are accepted per category", async () => {
  const db = await setup();
  const kelly = await save(db, null, { name: "Kelly Dépêches 25", category: "bags", brand: "HERMES" });
  assert.equal((await product(db, kelly)).brand, "Hermès");
  const slides = await save(db, null, { name: "Matelassé slides", category: "shoes", brand: "miu-miu" });
  assert.equal((await product(db, slides)).brand, "Miu Miu");
  const pocket = await save(db, null, { name: "Extra Pocket L19", category: "bags", brand: "LORO PIANA" });
  assert.equal((await product(db, pocket)).brand, "Loro Piana");
  assert.equal((await product(db, await save(db, null, { name: "Coco Crush ring", category: "jewellery", brand: "chanel" }))).brand, "Chanel");

  // A house the shop doesn't hold, or a bags-and-shoes house anywhere else, is refused.
  for (const brand of ["Louis Vuitton", "Gucci", "Cartier", "Van Cleef & Arpels", "Bvlgari"]) {
    await rejects(save(db, null, { name: "x", category: "jewellery", brand }), /brand_not_allowed/, brand);
  }
  await rejects(save(db, null, { name: "Bracelet", category: "jewellery", brand: "Miu Miu" }), /brand_not_allowed/);
  await rejects(save(db, null, { name: "Watch", category: "watches", brand: "Loro Piana" }), /brand_not_allowed/);
  await rejects(save(db, null, { name: "No house", category: "shoes" }), /brand_not_allowed/);
  // Moving a bags-and-shoes piece into another category is refused too.
  await rejects(save(db, slides, { category: "watches" }), /brand_not_allowed/);
  // Types must belong to the category; familiar names become their id.
  await rejects(save(db, null, { name: "x", category: "bags", brand: "Chanel", subcategory: "Rings" }), /invalid_request/);
  const case_ = await save(db, null, { name: "Bride-à-Brac", category: "bags", brand: "Hermès", subcategory: "Toiletry case" });
  assert.equal((await product(db, case_)).subcategory, "pouches");
  const oz = await save(db, null, { name: "Oz mules", category: "shoes", brand: "Hermès", subcategory: "Mules", size: "40.5", size_system: "EU" });
  const row = await product(db, oz);
  assert.equal(row.subcategory, "loafers");
  assert.equal(row.size_system, "EU");
  await rejects(save(db, oz, { size_system: "XX" }), /invalid_request/);
  await rejects(save(db, null, { name: "Watch", category: "watches", brand: "Hermès", case_diameter_mm: "500" }), /invalid_request/);
  const watch = await save(db, null, { name: "Arceau", category: "watches", brand: "Hermès", case_diameter_mm: "36", movement: "automatic", audience: "unisex" });
  assert.equal(Number((await product(db, watch)).case_diameter_mm), 36);
});

test("imports and dashboard edits can't publish outside the shop; drafts can be kept and hidden", async () => {
  const db = await setup();
  // As the server / dashboard would write (bypassing the panel functions).
  await as(db, "service_role", `insert into public.products (ref, name, category, brand) values ('IM-1', 'Imported', 'bags', 'Gucci')`);
  await rejects(as(db, "service_role", `update public.products set published = true where ref = 'IM-1'`), /out_of_scope/);
  await rejects(as(db, "service_role", `insert into public.products (ref, published, name, category, brand) values ('IM-2', true, 'Belt', 'accessories', 'Hermès')`), /out_of_scope/);
  await rejects(as(db, "service_role", `insert into public.products (ref, published, name, category, brand) values ('IM-3', true, 'Santos', 'watches', 'Cartier')`), /out_of_scope/);
  await as(db, "service_role", `insert into public.products (ref, published, name, category, brand) values ('IM-4', true, 'Constance', 'bags', 'hermes')`);
  assert.equal((await product(db, "IM-4")).brand, "Hermès");
  // An out-of-scope draft can still be edited to fix it, or simply stay hidden.
  await save(db, "IM-1", { published: false });
  await save(db, "IM-1", { brand: "Chanel", name: "Classic Flap" });
  assert.equal((await product(db, "IM-1")).brand, "Chanel");
});

test("running the migration hides out-of-scope rows without deleting anything, and leaves orders alone", async () => {
  const db = await freshDb({ before: "20261013120000" });
  await setup(db);
  await db.exec(`
    insert into public.products (ref, published, name, category, brand, subcategory) values
      ('OLD-1', true, 'Belt', 'accessories', 'Hermès', 'Belts'),
      ('OLD-2', true, 'Extra Pocket', 'bags', 'Loro Piana', 'Handbags'),
      ('OLD-3', true, 'Santos', 'watches', 'Cartier', null),
      ('OLD-4', true, 'Kelly 28', 'bags', 'Hermes', 'Handbags'),
      ('OLD-5', false, 'Draft', 'shoes', 'Gucci', 'Mules');
    insert into public.customers (id, name, phone_e164) values ('00000000-0000-4000-8000-000000000001', 'Client', '+971500000001');
  `);
  const owner = (await db.query("select id from public.staff_members where role = 'owner'")).rows[0].id;
  await db.query(`insert into public.orders (reference, customer_id, currency, total_amount, amount_approved_by) values ('ORD-KEEP1', '00000000-0000-4000-8000-000000000001', 'AED', 52000, $1)`, [owner]);
  await applyMigration(db, "20261013120000");
  const rows = Object.fromEntries((await db.query("select ref, published, brand, subcategory from public.products order by ref")).rows.map((r) => [r.ref, r]));
  assert.equal(Object.keys(rows).length, 5, "nothing deleted");
  assert.equal(rows["OLD-1"].published, false);
  assert.equal(rows["OLD-2"].published, false);
  assert.equal(rows["OLD-3"].published, false);
  assert.equal(rows["OLD-4"].published, true);
  assert.equal(rows["OLD-4"].brand, "Hermès");
  assert.equal(rows["OLD-4"].subcategory, "handbags");
  assert.equal(rows["OLD-5"].subcategory, "loafers");
  const orders = (await db.query("select reference, total_amount from public.orders")).rows;
  assert.deepEqual(orders.map((o) => [o.reference, Number(o.total_amount)]), [["ORD-KEEP1", 52000]]);
});

test("the houses update unpublishes pieces of houses the shop no longer holds, deleting nothing", async () => {
  const db = await freshDb({ before: "20261028120000" });
  await as(db, "service_role", `
    insert into public.products (ref, published, name, category, brand) values
      ('H-1', true, 'Speedy', 'bags', 'Louis Vuitton'),
      ('H-2', true, 'Love bracelet', 'jewellery', 'Cartier'),
      ('H-3', true, 'Kelly 28', 'bags', 'Hermès'),
      ('H-4', true, 'Classic Flap', 'bags', 'Chanel')`);
  await applyMigration(db, "20261028120000");
  const rows = Object.fromEntries((await db.query("select ref, published from public.products")).rows.map((r) => [r.ref, r.published]));
  assert.deepEqual(rows, { "H-1": false, "H-2": false, "H-3": true, "H-4": true });
  await as(db, "service_role", `insert into public.products (ref, published, name, category, brand) values ('H-5', true, 'Slides', 'shoes', 'Miu Miu')`);
  await rejects(as(db, "service_role", `update public.products set published = true where ref = 'H-1'`), /out_of_scope/);
});

test("versions: public only with a published piece, own codes, own photos, owner-only changes", async () => {
  const db = await setup();
  const ref = await save(db, null, { name: "Oran sandals", category: "shoes", brand: "Hermès" });
  const photoA = await addPhoto(db, ref);
  const other = await save(db, null, { name: "Other", category: "shoes", brand: "Chanel" });
  const foreign = await addPhoto(db, other);
  const add = (fields, user = OWNER) => asUser(db, user, "select public.admin_save_variant($1, null, $2) as id", [ref, fields]).then((r) => r.rows[0].id);
  const v1 = await add({ sku: "SH-OR-38", size: "38", colour: "Gold", price_aed: "3900", stock: "1", image_id: String(photoA) });
  await add({ size: "39", colour: "Gold" });
  await rejects(add({ sku: "sh-or-38", size: "40" }), /duplicate/);
  await rejects(add({ size: "41", image_id: String(foreign) }), /invalid_request/);
  await rejects(add({ price_aed: "100" }), /invalid_request/); // a version needs at least one option
  await rejects(add({ size: "42" }, STAFF), /owner_only/);
  await rejects(as(db, "anon", "select public.admin_save_variant('x', null, '{}')"), /permission denied/);
  const skus = (await db.query("select sku from public.product_variants where product_ref = $1 order by position", [ref])).rows.map((r) => r.sku);
  assert.deepEqual(skus, ["SH-OR-38", `${ref}-2`]);

  // Not visible until the piece is published.
  assert.equal((await as(db, "anon", "select count(*)::int n from public.product_variants")).rows[0].n, 0);
  assert.equal((await asUser(db, STAFF, "select count(*)::int n from public.product_variants")).rows[0].n, 2, "the team sees them");
  await save(db, ref, { published: true });
  assert.equal((await as(db, "anon", "select count(*)::int n from public.product_variants")).rows[0].n, 2);
  await rejects(as(db, "anon", "update public.product_variants set price_aed = 1"), /permission denied/);

  await asUser(db, OWNER, "select public.admin_save_variant($1, $2, $3)", [ref, v1, { stock: "0" }]);
  assert.equal((await db.query("select stock from public.product_variants where id = $1", [v1])).rows[0].stock, 0);
  await asUser(db, OWNER, "select public.admin_delete_variant($1)", [v1]);
  const log = (await db.query("select action from public.audit_log where entity_id = $1 and action like 'product.variant%' order by id", [ref])).rows.map((r) => r.action);
  assert.deepEqual(log, ["product.variant_added", "product.variant_added", "product.variant_updated", "product.variant_removed"]);
});

const purchase = (over = {}) => ({
  idempotency_key: `checkout:${randomUUID()}`,
  locale: "ar",
  contact_name: "Test client",
  contact_phone: "+447700900123",
  contact_email: "client@example.test",
  contact_method: "whatsapp",
  destination_country: "AE",
  destination_label: "Dubai, AE",
  consent_text: "I agree that SEVN HEVN may contact me about this request.",
  client_hash: "h-1",
  summary: "Purchase request from the website: Hermès Kelly Dépêches 25 — SH-0001 — 1 × AED 52,000",
  details: { lines: [{ ref: "SH-0001", name: "Kelly Dépêches 25", qty: 1, unitAED: 52000, lineAED: 52000 }], subtotal_aed: 52000, currency: "AED", payment: "not_connected" },
  ...over,
});
const submit = (db, payload, key = KEY) => as(db, "anon", "select public.shop_submit_purchase($1, $2) as res", [key, payload]).then((r) => r.rows[0].res);

test("purchase requests: server key only, stored once per key, in the panel as a purchase, no payment recorded", async () => {
  const db = await setup();
  const payload = purchase();
  await rejects(submit(db, payload, "wrong-key-0123456789abcdef0123456789abcdef"), /not_authorized/);
  await rejects(as(db, "authenticated", "select public.shop_submit_purchase($1, $2)", [KEY, payload]), /permission denied/);
  const first = await submit(db, payload);
  assert.equal(first.created, true);
  assert.match(first.reference, /^REQ-/);
  const again = await submit(db, payload);
  assert.deepEqual([again.created, again.reference], [false, first.reference], "a retry returns the same request");

  const [req] = (await db.query("select * from public.requests where reference = $1", [first.reference])).rows;
  assert.equal(req.type, "purchase");
  assert.equal(req.source, "checkout");
  assert.equal(req.status, "new");
  assert.equal(req.needs_review, "availability");
  assert.equal(req.locale, "ar");
  assert.equal(req.is_test, true, "Ofcom test numbers are marked as test data");
  assert.equal(req.details.lines[0].ref, "SH-0001");
  assert.equal((await db.query("select count(*)::int n from public.orders")).rows[0].n, 0, "no order or payment is created");
  assert.equal((await db.query("select count(*)::int n from public.notifications where request_id = $1", [req.id])).rows[0].n, 2);
  // The team reads it in the panel; the public can't.
  assert.equal((await asUser(db, STAFF, "select count(*)::int n from public.requests where type = 'purchase'")).rows[0].n, 1);
  await rejects(as(db, "anon", "select * from public.requests"), /permission denied/);

  await rejects(submit(db, purchase({ idempotency_key: "nope" })), /invalid_request/);
  await rejects(submit(db, purchase({ details: { lines: [] } })), /invalid_request/);
  await rejects(submit(db, purchase({ contact_phone: "12345" })), /check/);
});

test("purchase requests are rate limited per sender", async () => {
  const db = await setup();
  for (let i = 0; i < 5; i++) await submit(db, purchase({ client_hash: "same" }));
  await rejects(submit(db, purchase({ client_hash: "same" })), /rate_limited/);
  await submit(db, purchase({ client_hash: "other" }));
});
