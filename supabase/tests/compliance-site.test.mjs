// Compliance step 6 (migration 20261030120000): what the public website may read from the ledger,
// the origin and Arabic composition fields, and condition notes before publishing a pre-owned piece.
// Run with: npm run db:test   (in-process Postgres; never touches a remote database)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { as, asUser, freshDb } from "./harness.mjs";

const OWNER = randomUUID();
const STAFF = randomUUID();
const seed = readFileSync(join(import.meta.dirname, "..", "seeds", "compliance_rules.sql"), "utf8");

async function setup() {
  const db = await freshDb();
  await db.exec(seed);
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'owner@example.test', now()), ($2, 'staff@example.test', now())`, [OWNER, STAFF]);
  await db.exec(`insert into public.staff_members (email, display_name, role) values ('owner@example.test', 'Owner', 'owner'), ('staff@example.test', 'Sara', 'staff')`);
  await asUser(db, OWNER, "select public.admin_session()");
  await asUser(db, STAFF, "select public.admin_session()");
  return db;
}

const piece = (over = {}) => ({ ref: "SH-0001", published: false, status: "enquiry_only", name: "Kelly 28", category: "bags", brand: "Hermès", condition: null, condition_notes: null, ...over });
async function addPiece(db, over) {
  const p = piece(over);
  await db.query(
    `insert into public.products (ref, published, status, name, category, brand, condition, condition_notes) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [p.ref, p.published, p.status, p.name, p.category, p.brand, p.condition, p.condition_notes],
  );
}

test("visitors read the rules' website settings only, never the ledger itself", async () => {
  const db = await setup();
  const settings = (await as(db, "anon", "select public.compliance_site_settings() as s")).rows[0].s;
  assert.equal(settings["RET-CHANGE-OF-MIND"].params.change_of_mind_days, 7);
  assert.equal(settings["RET-NO-WARRANTY-30"].params.defect_window_days, 30);
  assert.equal(settings["DIS-PRE-ORDER"].params.require_terms_checkbox, true);
  for (const value of Object.values(settings)) assert.deepEqual(Object.keys(value).sort(), ["certainty", "params", "verified"]);
  assert.equal(Object.keys(settings).length, 22);
  await assert.rejects(as(db, "anon", "select * from public.compliance_rules"), /permission denied/);

  await db.exec(`update public.compliance_rules set status = 'retired' where code = 'ENF-PENALTIES'`);
  const after = (await as(db, "anon", "select public.compliance_site_settings() as s")).rows[0].s;
  assert.equal(after["ENF-PENALTIES"], undefined, "retired rules are not read by the website");
});

test("only the owner saves a piece's origin and Arabic composition; empty clears", async () => {
  const db = await setup();
  await addPiece(db);
  const save = (user, fields) => asUser(db, user, "select public.admin_save_product_compliance('SH-0001', $1::jsonb)", [JSON.stringify(fields)]);

  await save(OWNER, { country_of_origin: "France", composition_ar: "جلد توغو" });
  let row = (await db.query("select country_of_origin, composition_ar from public.products where ref = 'SH-0001'")).rows[0];
  assert.deepEqual(row, { country_of_origin: "France", composition_ar: "جلد توغو" });

  await assert.rejects(save(STAFF, { country_of_origin: "Italy" }), /owner_only/);
  await assert.rejects(as(db, "anon", "select public.admin_save_product_compliance('SH-0001', '{}'::jsonb)"), /permission denied/);
  await assert.rejects(save(OWNER, { price_aed: "1" }), /invalid_request/);
  await assert.rejects(save(OWNER, { country_of_origin: "x".repeat(81) }), /invalid_request/);

  await save(OWNER, { country_of_origin: "" });
  row = (await db.query("select country_of_origin, composition_ar from public.products where ref = 'SH-0001'")).rows[0];
  assert.deepEqual(row, { country_of_origin: null, composition_ar: "جلد توغو" });
  const audit = await db.query("select count(*)::int as n from public.audit_log where entity = 'product' and entity_id = 'SH-0001'");
  assert.equal(audit.rows[0].n, 2);
});

test("a pre-owned piece is published only with condition notes", async () => {
  const db = await setup();
  await assert.rejects(addPiece(db, { published: true, condition: "excellent" }), /condition_notes_needed/);
  await addPiece(db, { ref: "SH-0002", published: true, condition: "good", condition_notes: "Light wear on the corners" });
  await addPiece(db, { ref: "SH-0003", published: true, condition: "new" });
  await addPiece(db, { ref: "SH-0004", published: false, condition: "fair" });
  await assert.rejects(db.exec(`update public.products set published = true where ref = 'SH-0004'`), /condition_notes_needed/);
  await assert.rejects(db.exec(`update public.products set condition_notes = ' ' where ref = 'SH-0002'`), /condition_notes_needed/);
  // Hiding a piece is always possible.
  await db.exec(`update public.products set published = false, condition_notes = null where ref = 'SH-0002'`);
});

test("a new rule approved as unverified is not marked as checked against the official text", async () => {
  const db = await setup();
  const c = (
    await db.query(
      `insert into public.compliance_changes (change_type, summary_en, summary_fa, evidence_url, proposed)
       values ('new_rule', 's', 'خ', 'https://example.com', $1::jsonb) returning id`,
      [JSON.stringify({ code: "VAT-TEST", area: "vat", title_en: "t", title_fa: "ت", requirement_en: "r", requirement_fa: "ر", site_action: "a", law_reference: "l", certainty: "unverified" })],
    )
  ).rows[0];
  await asUser(db, OWNER, "select public.admin_compliance_decide($1, 'approved', null)", [c.id]);
  const rule = (await db.query("select certainty, last_verified_at, applies_to from public.compliance_rules where code = 'VAT-TEST'")).rows[0];
  assert.equal(rule.certainty, "unverified");
  assert.equal(rule.last_verified_at, null);
  assert.deepEqual(rule.applies_to, ["all"], "no applies_to in the proposal means all sales");
});
