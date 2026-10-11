// Access rules and behaviour of 360° views (20261012120000_product_360.sql).
// Run with: npm run db:test   (in-process Postgres; never touches a remote database)
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { as, asUser, freshDb } from "./harness.mjs";

const rejects = (p, pattern) => assert.rejects(p, pattern);

const OWNER = randomUUID();
const STAFF = randomUUID();

async function setup() {
  const db = await freshDb();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'owner@example.test', now()), ($2, 'staff@example.test', now())`, [OWNER, STAFF]);
  await db.exec(`insert into public.staff_members (email, display_name, role) values ('owner@example.test', 'Owner', 'owner'), ('staff@example.test', 'Sara', 'staff')`);
  await asUser(db, OWNER, "select public.admin_session()");
  await asUser(db, STAFF, "select public.admin_session()");
  const ref = (await asUser(db, OWNER, "select public.admin_save_product(null, $1) as ref", [{ name: "Kelly 28", category: "bags" }])).rows[0].ref;
  return { db, ref };
}

const path = (ref) => {
  const id = randomUUID();
  return [`${ref}/360/${id}.webp`, `${ref}/360/${id}-zoom.webp`];
};
const addMedia = (db, user, ref, kind = "frame", w = 1600, h = 2000) => {
  const [p, z] = path(ref);
  return asUser(db, user, "select public.admin_add_view_media($1, $2, $3, $4, $5, $6, $7) as id", [ref, kind, p, z, w, h, kind === "interior" ? "Inside" : null]).then((r) => r.rows[0].id);
};
const saveView = (db, user, ref, fields) => asUser(db, user, "select public.admin_save_view($1, $2)", [ref, fields]);
const view = (db, ref) => db.query("select * from public.product_views where product_ref = $1", [ref]).then((r) => r.rows[0]);

test("a spin can be switched on only with 12–72 frames of one shape", async () => {
  const { db, ref } = await setup();
  for (let i = 0; i < 11; i++) await addMedia(db, OWNER, ref);
  await rejects(saveView(db, OWNER, ref, { enabled: true, kind: "spin" }), /view_incomplete/);
  await rejects(addMedia(db, OWNER, ref, "frame", 2000, 1600), /frame_mismatch/);
  await addMedia(db, OWNER, ref);
  await saveView(db, OWNER, ref, { enabled: true, kind: "spin", start_frame: 3 });
  assert.equal((await view(db, ref)).enabled, true);
  await rejects(saveView(db, OWNER, ref, { start_frame: 12 }), /invalid_request/);
  for (let i = 12; i < 72; i++) await addMedia(db, OWNER, ref);
  await rejects(addMedia(db, OWNER, ref), /media_limit/);
});

test("removing frames below 12 switches the view off, so the website never offers a broken one", async () => {
  const { db, ref } = await setup();
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(await addMedia(db, OWNER, ref));
  await saveView(db, OWNER, ref, { enabled: true });
  const paths = (await asUser(db, OWNER, "select public.admin_delete_view_media($1) as p", [ids[0]])).rows[0].p;
  assert.equal(paths.length, 2, "both sizes are returned for deletion");
  assert.equal((await view(db, ref)).enabled, false);
  const positions = (await db.query("select position from public.product_view_media where product_ref = $1 order by position", [ref])).rows.map((r) => r.position);
  assert.deepEqual(positions, [...Array(11).keys()], "positions stay 0, 1, 2, …");
});

test("frames can be moved and reversed", async () => {
  const { db, ref } = await setup();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(await addMedia(db, OWNER, ref));
  await asUser(db, OWNER, "select public.admin_move_view_media($1, 1)", [ids[0]]);
  let order = (await db.query("select id from public.product_view_media where product_ref = $1 order by position", [ref])).rows.map((r) => Number(r.id));
  assert.deepEqual(order, [ids[1], ids[0], ids[2]].map(Number));
  await asUser(db, OWNER, "select public.admin_reverse_view_frames($1)", [ref]);
  order = (await db.query("select id from public.product_view_media where product_ref = $1 order by position", [ref])).rows.map((r) => Number(r.id));
  assert.deepEqual(order, [ids[2], ids[0], ids[1]].map(Number));
});

test("a model view needs a model; an opening animation must exist in the file", async () => {
  const { db, ref } = await setup();
  await rejects(saveView(db, OWNER, ref, { enabled: true, kind: "model" }), /view_incomplete/);
  const glb = `${ref}/360/${randomUUID()}.glb`;
  assert.equal((await asUser(db, OWNER, "select public.admin_set_view_model($1, $2, 1200000, $3) as old", [ref, glb, ["open", "spin"]])).rows[0].old, null);
  await rejects(saveView(db, OWNER, ref, { open_animation: "fly" }), /product_views_open_animation_known/);
  await saveView(db, OWNER, ref, { enabled: true, kind: "model", open_animation: "open" });
  assert.equal((await view(db, ref)).open_animation, "open");
  assert.equal((await asUser(db, OWNER, "select public.admin_clear_view_model($1) as old", [ref])).rows[0].old, glb);
  const v = await view(db, ref);
  assert.equal(v.enabled, false);
  assert.equal(v.open_animation, null);
  await rejects(asUser(db, OWNER, "select public.admin_set_view_model($1, $2, 1, '{}')", [ref, `OTHER-1/360/${randomUUID()}.glb`]), /invalid_request/);
});

test("only the owner changes views; staff and the public cannot", async () => {
  const { db, ref } = await setup();
  await rejects(addMedia(db, STAFF, ref), /owner_only/);
  await rejects(saveView(db, STAFF, ref, { enabled: true }), /owner_only/);
  await rejects(as(db, "anon", "select public.admin_save_view('SH-0001', '{}')"), /permission denied/);
  await rejects(asUser(db, STAFF, "insert into public.product_views (product_ref) values ($1)", [ref]), /permission denied/);
  await rejects(addMedia(db, OWNER, ref, "frame").then(() => asUser(db, OWNER, "select public.admin_add_view_media($1, 'frame', $2, null, 1600, 2000, null)", [ref, "../etc/passwd"])), /invalid_request/);
});

test("visitors see views of published pieces only; the team sees drafts", async () => {
  const { db, ref } = await setup();
  for (let i = 0; i < 12; i++) await addMedia(db, OWNER, ref);
  await addMedia(db, OWNER, ref, "interior");
  await saveView(db, OWNER, ref, { enabled: true });
  const anonRows = async () => (await as(db, "anon", "select count(*)::int as n from public.product_view_media")).rows[0].n;
  assert.equal(await anonRows(), 0, "draft piece: nothing public");
  assert.equal((await asUser(db, STAFF, "select count(*)::int as n from public.product_view_media")).rows[0].n, 13);
  await db.query("update public.products set published = true where ref = $1", [ref]);
  assert.equal(await anonRows(), 13);
  assert.equal((await as(db, "anon", "select count(*)::int as n from public.product_views")).rows[0].n, 1);
});

test("deleting a piece: its 360° files are listed first, then the rows go with it", async () => {
  const { db, ref } = await setup();
  for (let i = 0; i < 2; i++) await addMedia(db, OWNER, ref);
  await asUser(db, OWNER, "select public.admin_set_view_model($1, $2, 10, '{}')", [ref, `${ref}/360/${randomUUID()}.glb`]);
  const files = (await asUser(db, OWNER, "select public.admin_view_files($1) as f", [ref])).rows[0].f;
  assert.equal(files.length, 5, "two frames in two sizes, and the model");
  assert.deepEqual((await asUser(db, STAFF, "select public.admin_view_files($1) as f", [ref])).rows[0].f, [], "staff get nothing");
  await asUser(db, OWNER, "select public.admin_delete_product($1)", [ref]);
  assert.equal((await db.query("select count(*)::int as n from public.product_view_media")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int as n from public.product_views")).rows[0].n, 0);
});

test("every change is logged and refreshes the website's catalogue", async () => {
  const { db, ref } = await setup();
  await db.exec("insert into vault.store values ('catalog_revalidate_url', 'https://example.test/api/revalidate'), ('catalog_revalidate_secret', 'x')");
  const before = (await db.query("select count(*)::int as n from net.calls")).rows[0].n;
  await addMedia(db, OWNER, ref);
  assert.ok((await db.query("select count(*)::int as n from net.calls")).rows[0].n > before, "revalidation requested");
  const log = (await db.query("select action from public.audit_log where entity = 'product' and action like 'product.view%'")).rows.map((r) => r.action);
  assert.deepEqual(log, ["product.view_media_added"]);
});
