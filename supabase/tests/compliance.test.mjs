// Access rules and behaviour of the compliance ledger (rules, official sources, monitor runs and
// the changes waiting for the owner). Run with: npm run db:test
// (in-process Postgres; never touches a remote database)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { as, asUser, freshDb } from "./harness.mjs";

const OWNER = randomUUID();
const STAFF = randomUUID();
const OUTSIDER = randomUUID();
const seed = readFileSync(join(import.meta.dirname, "..", "seeds", "compliance_rules.sql"), "utf8");
const TABLES = ["compliance_rules", "compliance_sources", "compliance_runs", "compliance_changes"];

async function setup() {
  const db = await freshDb();
  await db.exec(seed);
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at) values
       ($1, 'owner@example.test', now()), ($2, 'staff@example.test', now()), ($3, 'outsider@example.test', now())`,
    [OWNER, STAFF, OUTSIDER],
  );
  await db.exec(`insert into public.staff_members (email, display_name, role) values ('owner@example.test', 'Owner', 'owner'), ('staff@example.test', 'Sara', 'staff')`);
  await asUser(db, OWNER, "select public.admin_session()");
  await asUser(db, STAFF, "select public.admin_session()");
  return db;
}

/** A change as the monitor writes it (with the database's own rights, like the scheduled task). */
async function addChange(db, { code = null, type = "amended", proposed = {} } = {}) {
  const r = await db.query(
    `insert into public.compliance_changes (rule_id, change_type, summary_en, summary_fa, evidence_url, proposed)
     values ((select id from public.compliance_rules where code = $1), $2, 'Summary', 'خلاصه', 'https://uaelegislation.gov.ae/en/legislations/2157', $3::jsonb)
     returning id, ref`,
    [code, type, JSON.stringify(proposed)],
  );
  return r.rows[0];
}

const decide = async (db, user, changeId, decision, note = null) =>
  (await asUser(db, user, "select public.admin_compliance_decide($1, $2::public.compliance_change_status, $3) as r", [changeId, decision, note])).rows[0].r;

const rule = async (db, code) => (await db.query("select * from public.compliance_rules where code = $1", [code])).rows[0];

test("the seed loads: 22 rules and 12 official sources, each rule with a source link", async () => {
  const db = await setup();
  const rules = (await db.query("select code, source_url, certainty from public.compliance_rules")).rows;
  assert.equal(rules.length, 22);
  assert.ok(rules.every((r) => r.source_url.startsWith("https://")));
  const sources = (await db.query("select count(*)::int as n from public.compliance_sources where active")).rows[0].n;
  assert.equal(sources, 12);
  const days = (await rule(db, "RET-NO-WARRANTY-30")).site_params.defect_window_days;
  assert.equal(days, 30);
});

test("visitors can't see the ledger, people outside the team see nothing, the team reads it", async () => {
  const db = await setup();
  await addChange(db, { code: "RET-CHANGE-OF-MIND" });
  for (const t of TABLES) {
    await assert.rejects(as(db, "anon", `select * from public.${t}`), /permission denied/);
    const outsider = await asUser(db, OUTSIDER, `select count(*)::int as n from public.${t}`);
    assert.equal(outsider.rows[0].n, 0, `${t} is hidden from non-team accounts`);
  }
  const staff = await asUser(db, STAFF, "select count(*)::int as n from public.compliance_rules");
  assert.equal(staff.rows[0].n, 22);
  const changes = await asUser(db, STAFF, "select count(*)::int as n from public.compliance_changes");
  assert.equal(changes.rows[0].n, 1);
});

test("nobody changes the ledger through the API, not even the owner", async () => {
  const db = await setup();
  for (const user of [OWNER, STAFF]) {
    await assert.rejects(asUser(db, user, "update public.compliance_rules set notes = 'x'"), /permission denied/);
    await assert.rejects(asUser(db, user, "delete from public.compliance_rules"), /permission denied/);
    await assert.rejects(
      asUser(db, user, `insert into public.compliance_changes (change_type, summary_en, summary_fa, evidence_url) values ('amended', 'a', 'b', 'https://x')`),
      /permission denied/,
    );
    await assert.rejects(asUser(db, user, "update public.compliance_changes set status = 'applied'"), /permission denied/);
  }
});

test("only the owner decides; approving an amendment updates the rule and records who decided", async () => {
  const db = await setup();
  const before = await rule(db, "RET-NO-WARRANTY-30");
  assert.equal(before.last_verified_at, null);
  const c = await addChange(db, {
    code: "RET-NO-WARRANTY-30",
    proposed: { site_params: { defect_window_days: 45, window_starts: "purchase_date" }, law_reference: "Cabinet Resolution 66/2023, Art. 25(2)" },
  });
  assert.match(c.ref, /^CHG-.{6}$/);

  await assert.rejects(decide(db, STAFF, c.id, "approved"), /owner_only/);
  await assert.rejects(as(db, "anon", "select public.admin_compliance_decide($1, 'approved', null)", [c.id]), /permission denied/);

  assert.equal(await decide(db, OWNER, c.id, "approved", "Checked with the lawyer"), "applied");
  const after = await rule(db, "RET-NO-WARRANTY-30");
  assert.equal(after.site_params.defect_window_days, 45);
  assert.equal(after.law_reference, "Cabinet Resolution 66/2023, Art. 25(2)");
  assert.equal(after.title_en, before.title_en, "fields not in the proposal stay as they were");
  assert.ok(after.last_verified_at);

  const row = (await db.query("select status, review_note, reviewed_by from public.compliance_changes where id = $1", [c.id])).rows[0];
  const owner = (await db.query("select id from public.staff_members where email = 'owner@example.test'")).rows[0];
  assert.deepEqual([row.status, row.review_note, row.reviewed_by], ["applied", "Checked with the lawyer", owner.id]);
  const audit = await db.query("select action from public.audit_log where entity = 'compliance_change' and entity_id = $1", [c.ref]);
  assert.deepEqual(audit.rows.map((r) => r.action), ["compliance.applied"]);

  await assert.rejects(decide(db, OWNER, c.id, "rejected"), /already_decided/);
});

test("rejecting leaves the rule unchanged", async () => {
  const db = await setup();
  const before = await rule(db, "RET-CHANGE-OF-MIND");
  const c = await addChange(db, { code: "RET-CHANGE-OF-MIND", proposed: { site_params: { change_of_mind_days: 14 } } });
  assert.equal(await decide(db, OWNER, c.id, "rejected"), "rejected");
  const after = await rule(db, "RET-CHANGE-OF-MIND");
  assert.deepEqual(after.site_params, before.site_params);
  assert.equal(after.last_verified_at, null);
});

test("approving a new rule adds it, a repeal retires a rule, a verification refreshes its date", async () => {
  const db = await setup();
  const added = await addChange(db, {
    type: "new_rule",
    proposed: {
      code: "RET-TEST-NEW", area: "returns", title_en: "New rule", title_fa: "قانون جدید", requirement_en: "Requirement",
      requirement_fa: "الزام", applies_to: ["pre_owned"], site_action: "Do this", site_params: { days: 10 }, law_reference: "Test law",
    },
  });
  assert.equal(await decide(db, OWNER, added.id, "approved"), "applied");
  const created = await rule(db, "RET-TEST-NEW");
  assert.deepEqual(created.applies_to, ["pre_owned"]);
  assert.equal(created.site_params.days, 10);
  assert.equal(created.source_url, "https://uaelegislation.gov.ae/en/legislations/2157", "evidence link becomes the source");
  const linked = (await db.query("select rule_id from public.compliance_changes where id = $1", [added.id])).rows[0];
  assert.equal(linked.rule_id, created.id);

  const repeal = await addChange(db, { code: "ENF-PENALTIES", type: "repealed" });
  await decide(db, OWNER, repeal.id, "approved");
  assert.equal((await rule(db, "ENF-PENALTIES")).status, "retired");

  const verify = await addChange(db, { code: "SEC-ECOM", type: "verified", proposed: { certainty: "confirmed" } });
  await decide(db, OWNER, verify.id, "approved");
  assert.ok((await rule(db, "SEC-ECOM")).last_verified_at);
});

test("the decision helper itself can't be called through the API", async () => {
  const db = await setup();
  const c = await addChange(db, { code: "SEC-ECOM" });
  const staffId = (await db.query("select id from public.staff_members where email = 'owner@example.test'")).rows[0].id;
  for (const call of [
    () => as(db, "anon", "select private.compliance_decide($1, 'approved', $2, null)", [c.id, staffId]),
    () => asUser(db, OWNER, "select private.compliance_decide($1, 'approved', $2, null)", [c.id, staffId]),
  ]) {
    await assert.rejects(call(), /permission denied/);
  }
  const still = (await db.query("select status from public.compliance_changes where id = $1", [c.id])).rows[0];
  assert.equal(still.status, "pending_review");
});
