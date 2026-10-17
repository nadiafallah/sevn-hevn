// Access rules and behaviour of the journal migration (articles, runs, steps, lessons).
// Run with: npm run db:test   (in-process Postgres; never touches a remote database)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { as, asUser, freshDb } from "./harness.mjs";

const KEY = "journal-test-key-0123456789abcdef0123456789abcdef";
const CONCIERGE_KEY = "test-server-key-0123456789abcdef0123456789abcdef";
const sha = (s) => createHash("sha256").update(s).digest("hex");

const OWNER = randomUUID();
const STAFF = randomUUID();

async function setup() {
  const db = await freshDb();
  await db.query("insert into private.server_keys (name, sha256_hex) values ('journal', $1), ('concierge', $2)", [sha(KEY), sha(CONCIERGE_KEY)]);
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'owner@example.test', now()), ($2, 'staff@example.test', now())`, [OWNER, STAFF]);
  await db.exec(`insert into public.staff_members (email, display_name, role) values ('owner@example.test', 'Owner', 'owner'), ('staff@example.test', 'Sara', 'staff')`);
  await asUser(db, OWNER, "select public.admin_session()");
  await asUser(db, STAFF, "select public.admin_session()");
  return db;
}

const call = async (db, fn, args) => (await as(db, "anon", `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;

const post = (over = {}) => ({
  status: "draft",
  slug: "how-to-choose-a-first-birkin",
  title: "How to choose a first Birkin",
  body_md: "An introduction.\n\n## First section\n\n" + "Text ".repeat(40),
  meta_title: "How to choose a first Birkin, calmly",
  meta_description: "A description of the right length for a search result, inviting the reader in.",
  summary: "Two sentences. For the index.",
  keywords: ["first birkin", "hermes birkin"],
  faq: [{ q: "Q?", a: "A." }],
  primary_keyword: "first birkin",
  score: 82,
  subscores: { briefFit: 17 },
  issues: [{ id: "R1", problem: "internal note" }],
  reasons: [],
  cta: { text: "Ask", href: "/chat" },
  sources: [{ url: "https://example.com", title: "Source" }],
  media: [{ type: "photo", id: "P1", piece: "Hermès Kelly", alt: "front", href: "/product/SH-0001", src: "https://x/1.jpg", width: 1200, height: 1600 }],
  ...over,
});

async function startRun(db) {
  return call(db, "journal_start_run", [KEY]);
}

test("journal functions require the journal key (not the concierge key, not none)", async () => {
  const db = await setup();
  for (const key of [null, "short", CONCIERGE_KEY, "x".repeat(48)]) {
    await assert.rejects(call(db, "journal_start_run", [key]), /not_authorized/);
    await assert.rejects(call(db, "journal_context", [key]), /not_authorized/);
  }
  const id = await startRun(db);
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test("visitors read published articles only, and only the page columns", async () => {
  const db = await setup();
  const run1 = await startRun(db);
  await call(db, "journal_save_post", [KEY, run1, post({ status: "published" })]);
  const run2 = await startRun(db);
  await call(db, "journal_save_post", [KEY, run2, post({ slug: "a-draft", status: "draft" })]);

  const rows = (await as(db, "anon", "select slug, title, meta_title, media, published_at from public.journal_posts")).rows;
  assert.deepEqual(rows.map((r) => r.slug), ["how-to-choose-a-first-birkin"]);
  assert.equal(rows[0].media[0].piece, "Hermès Kelly");
  assert.ok(rows[0].published_at);
  // Editor notes, scores and sources are not public.
  for (const col of ["issues", "score", "sources", "reasons", "subscores", "*"]) {
    await assert.rejects(as(db, "anon", `select ${col} from public.journal_posts`), /permission denied/);
  }
  for (const t of ["journal_runs", "journal_steps", "journal_lessons"]) {
    await assert.rejects(as(db, "anon", `select * from public.${t}`), /permission denied/);
  }
  // Visitors can't write.
  await assert.rejects(as(db, "anon", "insert into public.journal_posts (slug, title, body_md) values ('x', 'xxxxx', 'y')"), /permission denied/);
  await assert.rejects(as(db, "anon", "update public.journal_posts set title = 'hacked'"), /permission denied/);
});

test("the pipeline can publish only at a score of at least 75; below it, only as a draft", async () => {
  const db = await setup();
  const run = await startRun(db);
  await assert.rejects(call(db, "journal_save_post", [KEY, run, post({ status: "published", score: 74 })]), /journal_publish_gate/);
  await assert.rejects(call(db, "journal_save_post", [KEY, run, post({ status: "published", meta_title: null })]), /journal_published_meta/);
  const id = await call(db, "journal_save_post", [KEY, run, post({ status: "draft", score: 60 })]);
  assert.ok(id);
  // One article per run, unique slugs.
  await assert.rejects(call(db, "journal_save_post", [KEY, run, post({ slug: "other" })]), /duplicate key/);
  const run2 = await startRun(db);
  await assert.rejects(call(db, "journal_save_post", [KEY, run2, post()]), /duplicate key/);
  await assert.rejects(call(db, "journal_save_post", [KEY, run2, post({ slug: "Not A Slug" })]), /check constraint/);
});

test("runs: steps and results are written only while the run is open; finished runs are closed", async () => {
  const db = await setup();
  const run = await startRun(db);
  await call(db, "journal_save_step", [KEY, run, { agent: "writer", round: 1, input: { a: 1 }, output: "text", usage: null, duration_ms: 10, error: null }]);
  await assert.rejects(call(db, "journal_save_step", [KEY, run, { agent: "manager", round: 1 }]), /check constraint/);
  await call(db, "journal_finish_run", [KEY, run, { status: "draft", score: 70, rewrites: 2, cost_usd: 1.23, error: null, post_id: null, critic: null }]);
  await assert.rejects(call(db, "journal_save_step", [KEY, run, { agent: "writer", round: 2 }]), /not_found/);
  await assert.rejects(call(db, "journal_save_post", [KEY, run, post()]), /not_found/);
  await assert.rejects(call(db, "journal_save_step", [KEY, randomUUID(), { agent: "writer", round: 1 }]), /not_found/);
  const r = (await db.query("select status, score, rewrites, cost_usd from public.journal_runs where id = $1", [run])).rows[0];
  assert.deepEqual({ ...r, cost_usd: Number(r.cost_usd) }, { status: "draft", score: 70, rewrites: 2, cost_usd: 1.23 });
});

test("the context says when the last article was written (articles every N days)", async () => {
  const db = await setup();
  assert.equal((await call(db, "journal_context", [KEY])).last_post_at, null);
  const run = await startRun(db);
  await call(db, "journal_save_post", [KEY, run, post()]);
  const ctx = await call(db, "journal_context", [KEY]);
  assert.ok(ctx.last_post_at);
  assert.deepEqual(ctx.posts.map((p) => p.slug), ["how-to-choose-a-first-birkin"]);
});

test("runs are rate limited (a leaked key can't flood the database)", async () => {
  const db = await setup();
  for (let i = 0; i < 6; i++) await startRun(db);
  await assert.rejects(startRun(db), /rate_limited/);
});

test("lessons: at most 3 per run; retire and delete; deleted ones stay known to the pipeline", async () => {
  const db = await setup();
  const run = await startRun(db);
  const l = (agent, rule) => ({ agent, rule, evidence: "e" });
  await assert.rejects(call(db, "journal_apply_lessons", [KEY, run, [l("writer", "Rule one is long"), l("writer", "Rule two is long"), l("seo", "Rule three is long"), l("seo", "Rule four is long")], []]), /invalid_request/);
  await assert.rejects(call(db, "journal_apply_lessons", [KEY, run, [l("publisher", "Not an agent with lessons")], []]), /check constraint/);
  await call(db, "journal_apply_lessons", [KEY, run, [l("writer", "Rule one is long"), l("seo", "Rule two is long")], []]);
  const ids = (await db.query("select id, agent from public.journal_lessons order by agent")).rows;
  await call(db, "journal_apply_lessons", [KEY, run, [l("writer", "Rule three is long")], [ids.find((x) => x.agent === "writer").id]]);
  assert.equal(await call(db, "journal_delete_lesson", [KEY, ids.find((x) => x.agent === "seo").id]), true);
  const ctx = await call(db, "journal_context", [KEY]);
  assert.deepEqual(ctx.lessons.map((x) => [x.rule, x.status]), [["Rule two is long", "deleted"], ["Rule three is long", "active"]]);
});

test("the team reads drafts, runs and lessons; only the owner publishes, edits, deletes", async () => {
  const db = await setup();
  const run = await startRun(db);
  const id = await call(db, "journal_save_post", [KEY, run, post({ score: 60 })]);
  await call(db, "journal_apply_lessons", [KEY, run, [{ agent: "writer", rule: "A lesson to delete", evidence: "" }], []]);
  const lessonId = (await db.query("select id from public.journal_lessons")).rows[0].id;

  assert.equal((await asUser(db, STAFF, "select issues from public.journal_posts")).rows.length, 1);
  assert.equal((await asUser(db, STAFF, "select * from public.journal_runs")).rows.length, 1);
  await assert.rejects(asUser(db, STAFF, "select public.admin_journal_set_status($1, 'published')", [id]), /owner_only/);
  await assert.rejects(asUser(db, STAFF, "select public.admin_journal_delete_lesson($1)", [lessonId]), /owner_only/);
  await assert.rejects(asUser(db, STAFF, "update public.journal_posts set title = 'x'"), /permission denied/);

  // A person may publish a draft below the threshold: that is the human decision.
  await asUser(db, OWNER, "select public.admin_journal_update($1, $2)", [id, { title: "A better title", slug: "a-better-slug" }]);
  await assert.rejects(asUser(db, OWNER, "select public.admin_journal_update($1, $2)", [id, { score: 99 }]), /invalid_request/);
  await asUser(db, OWNER, "select public.admin_journal_set_status($1, 'published')", [id]);
  const p = (await db.query("select status, slug, title, published_manually, published_by is not null as by from public.journal_posts")).rows[0];
  assert.deepEqual(p, { status: "published", slug: "a-better-slug", title: "A better title", published_manually: true, by: true });
  assert.equal((await as(db, "anon", "select slug from public.journal_posts")).rows.length, 1);

  await asUser(db, OWNER, "select public.admin_journal_set_status($1, 'archived')", [id]);
  assert.equal((await as(db, "anon", "select slug from public.journal_posts")).rows.length, 0);
  await asUser(db, OWNER, "select public.admin_journal_delete_lesson($1)", [lessonId]);
  await asUser(db, OWNER, "select public.admin_journal_delete($1)", [id]);
  const actions = (await db.query("select action from public.audit_log where entity like 'journal%' order by id")).rows.map((r) => r.action);
  assert.deepEqual(actions, ["journal.updated", "journal.published", "journal.archived", "journal.lesson_deleted", "journal.deleted"]);
});
