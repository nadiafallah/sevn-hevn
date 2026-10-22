// The order lifecycle (20261022120000_order_lifecycle.sql): checkout, stock holds, payment events,
// quotes, sourcing, quality checks, shipments, cancellation, returns, refunds and customer links.
// Run with: npm run db:test   (in-process Postgres; never touches a remote database)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { as, asUser, freshDb } from "./harness.mjs";

const KEY = "test-server-key-0123456789abcdef0123456789abcdef";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const rejects = (p, pattern) => assert.rejects(p, pattern);
const OWNER = randomUUID();
const STAFF = randomUUID();
const OUTSIDER = randomUUID();
const num = (v) => (v === null || v === undefined ? v : Number(v));

async function setup({ configure = true } = {}) {
  const db = await freshDb();
  await db.query("insert into private.server_keys (name, sha256_hex) values ('concierge', $1)", [sha(KEY)]);
  await db.query(
    "insert into auth.users (id, email, email_confirmed_at) values ($1, 'owner@example.test', now()), ($2, 'staff@example.test', now()), ($3, 'outsider@example.test', now())",
    [OWNER, STAFF, OUTSIDER],
  );
  await db.exec("insert into public.staff_members (email, display_name, role) values ('owner@example.test', 'Owner', 'owner'), ('staff@example.test', 'Sara', 'staff')");
  await asUser(db, OWNER, "select public.admin_session()");
  await asUser(db, STAFF, "select public.admin_session()");
  // One-off pieces, as the panel would publish them.
  await db.exec(`insert into public.products (ref, published, status, name, category, brand, price_aed, stock, delivery) values
    ('SH-0001', true, 'available', 'Kelly 25', 'bags', 'Hermès', 50000, 1, 'Ships within 2 days'),
    ('SH-0002', true, 'available', 'Classic Flap', 'bags', 'Chanel', 30000, 1, 'Ships within 2 days'),
    ('SH-0003', true, 'enquiry_only', 'Birkin 30', 'bags', 'Hermès', null, null, null)`);
  if (configure) await configureShop(db);
  return db;
}

async function configureShop(db) {
  await owner(db, "select public.admin_save_shop_settings($1)", [{ vat_rate_percent: "5", prices_include_vat: "true", change_of_mind_days: "7" }]);
  await owner(db, "select public.admin_save_shipping_zone(null, $1, $2)", [
    { name: "UAE", fee_aed: "50", transit_days_min: "1", transit_days_max: "2", vat_treatment: "standard", duties_treatment: "not_applicable" }, ["AE"]]);
  await owner(db, "select public.admin_save_shipping_zone(null, $1, $2)", [
    { name: "United Kingdom", fee_aed: "250", transit_days_min: "3", transit_days_max: "5", vat_treatment: "zero_rated", duties_treatment: "recipient_pays",
      duties_note: "Import duties and taxes are charged by the destination and paid by the recipient." }, ["GB"]]);
  for (const kind of ["terms_of_sale", "returns"]) {
    const id = (await owner(db, "select public.admin_save_policy(null, $1) as id", [{ kind, version: "2026-10", title: kind, body: `Test ${kind}` }])).rows[0].id;
    await owner(db, "select public.admin_set_policy_status($1, 'approved')", [id]);
  }
}

const owner = (db, sql, params) => asUser(db, OWNER, sql, params);
const staff = (db, sql, params) => asUser(db, STAFF, sql, params);
const anon = (db, sql, params) => as(db, "anon", sql, params);
const one = async (p) => Object.values((await p).rows[0])[0];

async function checkout(db, { phone = "+971501234567", lines = [{ ref: "SH-0001", qty: 1 }], mode = "deliver", country = "AE", idem = randomUUID(), token = randomUUID() } = {}) {
  const res = await one(anon(db, "select public.shop_start_checkout($1, $2)", [KEY, {
    idempotency_key: `checkout:${idem}`, lines, delivery_mode: mode, shipping_country: country, shipping_address: "Villa 1, Jumeirah",
    shipping_label: "Dubai, AE", contact_name: "Layla", contact_phone: phone, contact_email: "layla@example.test", contact_method: "whatsapp",
    client_hash: phone, token_hash: sha(token), provider: "test",
  }]));
  const session = `cs_${randomUUID()}`;
  if (res.created) await anon(db, "select public.payments_session_created($1, $2, $3, $4, now() + interval '30 minutes')", [KEY, res.payment_id, session, `https://pay.example.test/${session}`]);
  return { ...res, session, token, idem };
}

const event = (db, ev) => one(anon(db, "select public.payments_apply_event($1, $2)", [KEY, { provider: "test", event_id: `evt_${randomUUID()}`, ...ev }]));
const paid = (db, c, over = {}) => event(db, { type: "payment_succeeded", session_id: c.session, amount: c.amount, currency: "AED", payment_ref: `pi_${randomUUID()}`, ...over });
const order = async (db, id) => (await db.query("select * from public.orders where id = $1", [id])).rows[0];
const view = (db, token) => one(anon(db, "select public.shop_order_view($1, $2, 'client')", [KEY, sha(token)]));
const events = async (db, id) => (await db.query("select kind, from_value, to_value, actor, reason from public.order_events where order_id = $1 order by id", [id])).rows;

test("online payment stays off until the owner has set VAT, the zone and approved the policies", async () => {
  const db = await setup({ configure: false });
  const price = (mode = "deliver", country = "AE") =>
    one(anon(db, "select public.shop_price_bag($1, $2, $3, $4)", [KEY, [{ ref: "SH-0001", qty: 1 }], mode, country]));
  assert.equal((await price()).reason, "policies_unapproved");
  for (const kind of ["terms_of_sale", "returns"]) {
    const id = await one(owner(db, "select public.admin_save_policy(null, $1)", [{ kind, version: "1", title: kind, body: "x" }]));
    await owner(db, "select public.admin_set_policy_status($1, 'approved')", [id]);
  }
  assert.equal((await price()).reason, "destination_unsupported");
  const zone = await one(owner(db, "select public.admin_save_shipping_zone(null, $1, $2)", [{ name: "UAE" }, ["AE"]]));
  assert.equal((await price()).reason, "shipping_quote_needed");
  await owner(db, "select public.admin_save_shipping_zone($1, $2, null)", [zone, { fee_aed: "0" }]);
  assert.equal((await price()).reason, "vat_unconfirmed");
  await owner(db, "select public.admin_save_shipping_zone($1, $2, null)", [zone, { vat_treatment: "standard" }]);
  assert.equal((await price()).reason, "duties_unconfirmed");
  await owner(db, "select public.admin_save_shipping_zone($1, $2, null)", [zone, { duties_treatment: "not_applicable" }]);
  assert.equal((await price()).reason, "vat_unconfirmed", "the VAT rate itself is still missing");
  await owner(db, "select public.admin_save_shop_settings($1)", [{ vat_rate_percent: "5", prices_include_vat: "true" }]);
  const ok = await price();
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.quote.subtotal, ok.quote.shipping, num(ok.quote.vat), ok.quote.total], [50000, 0, 2380.95, 50000]);
  assert.equal((await price("deliver", "US")).reason, "destination_unsupported");
  // Staff can't change the rules.
  await rejects(staff(db, "select public.admin_save_shop_settings($1)", [{ vat_rate_percent: "0" }]), /owner_only/);
  await rejects(staff(db, "select public.admin_save_shipping_zone(null, $1, $2)", [{ name: "x" }, ["FR"]]), /owner_only/);
  await rejects(staff(db, "select public.admin_set_policy_status(1, 'retired')"), /owner_only/);
});

test("international checkout: zero-rated VAT, the destination's shipping fee and the duties note", async () => {
  const db = await setup();
  const q = (await one(anon(db, "select public.shop_price_bag($1, $2, 'deliver', 'GB')", [KEY, [{ ref: "SH-0002", qty: 1 }]]))).quote;
  assert.deepEqual([q.subtotal, q.shipping, q.vat, q.total, q.vat_treatment, q.duties_treatment], [30000, 250, 0, 30250, "zero_rated", "recipient_pays"]);
  assert.match(q.duties_note, /paid by the recipient/);
  const c = await checkout(db, { lines: [{ ref: "SH-0002", qty: 1 }], country: "GB" });
  const o = await order(db, c.order_id);
  assert.deepEqual([num(o.total_amount), o.vat_treatment, o.duties_treatment, o.transit_days_min, o.transit_days_max], [30250, "zero_rated", "recipient_pays", 3, 5]);
  // Browser prices never count: the bag is priced from the catalogue.
  await rejects(checkout(db, { lines: [{ ref: "SH-0003", qty: 1 }] }), /bag_changed/);
  await rejects(checkout(db, { lines: [{ ref: "SH-0001", qty: 2 }] }), /bag_changed/);
});

test("a verified payment event confirms the order, takes the piece out of stock and is applied once", async () => {
  const db = await setup();
  const c = await checkout(db);
  assert.equal(c.created, true);
  assert.equal((await order(db, c.order_id)).payment_status, "pending");
  // The customer closes the tab before the redirect: nothing depends on the browser.
  const first = await paid(db, c, { event_id: "evt_1" });
  assert.equal(first.outcome, "applied");
  const o = await order(db, c.order_id);
  assert.deepEqual([o.status, o.payment_status, num(o.amount_paid), o.fulfilment_status], ["confirmed", "paid", 50050, "quality_check"]);
  const p = (await db.query("select stock, status from public.products where ref = 'SH-0001'")).rows[0];
  assert.deepEqual(p, { stock: 0, status: "sold" });

  // The same event again (retry), and a stale failure after success, change nothing.
  assert.equal((await paid(db, c, { event_id: "evt_1" })).outcome, "duplicate");
  assert.equal((await event(db, { type: "payment_failed", session_id: c.session })).outcome, "ignored");
  assert.equal((await event(db, { type: "session_expired", session_id: c.session })).outcome, "ignored");
  assert.equal((await paid(db, c)).outcome, "ignored", "a second success event with a new ID is not paid twice");
  const after = await order(db, c.order_id);
  assert.deepEqual([after.payment_status, num(after.amount_paid)], ["paid", 50050]);
  assert.equal((await db.query("select stock from public.products where ref = 'SH-0001'")).rows[0].stock, 0);
  const notes = (await db.query("select template, recipient, channel from public.notifications where order_id = $1 order by template, recipient, channel", [c.order_id])).rows;
  assert.equal(notes.filter((n) => n.template === "order_confirmed" && n.recipient === "team").length, 2, "one team alert per channel, once");
  assert.equal(notes.filter((n) => n.recipient === "customer").length, 0, "customer e-mails stay off until the owner turns them on");

  // The history keeps who/what and why.
  const ev = await events(db, c.order_id);
  assert.ok(ev.some((e) => e.kind === "order.status" && e.to_value === "confirmed" && e.actor === "provider" && e.reason === "Paid in full"));
  assert.ok(ev.some((e) => e.kind === "order.created" && e.actor === "customer" && e.reason === "Website checkout"));
  // The same checkout submitted again returns the same order.
  const again = await checkout(db, { idem: c.idem, token: c.token });
  assert.deepEqual([again.created, again.order_id], [false, c.order_id]);
});

test("a payment that doesn't match is a discrepancy for the team, never applied silently", async () => {
  const db = await setup();
  const c = await checkout(db);
  assert.equal((await paid(db, c, { amount: 100 })).outcome, "discrepancy");
  assert.equal((await order(db, c.order_id)).payment_status, "pending");
  assert.equal((await event(db, { type: "payment_succeeded", session_id: "cs_unknown", amount: 1, currency: "AED" })).outcome, "discrepancy");
  const q = await one(staff(db, "select public.admin_work_queues()"));
  assert.equal(q.payment_discrepancies.length, 2);
  await rejects(staff(db, "select public.admin_resolve_payment_event($1, 'checked')", [q.payment_discrepancies[0].id]), /owner_only/);
  await owner(db, "select public.admin_resolve_payment_event($1, 'Checked with the provider: test payment')", [q.payment_discrepancies[0].id]);
  assert.equal((await one(staff(db, "select public.admin_work_queues()"))).payment_discrepancies.length, 1);
  // A failed attempt can be followed by a successful one in the same session.
  assert.equal((await event(db, { type: "payment_failed", session_id: c.session, failure_reason: "card_declined" })).outcome, "applied");
  assert.equal((await order(db, c.order_id)).payment_status, "failed");
  assert.equal((await paid(db, c)).outcome, "applied");
  assert.equal((await order(db, c.order_id)).status, "confirmed");
});

test("two buyers for the last unit: the hold decides, and a late payment waits for the owner", async () => {
  const db = await setup();
  const a = await checkout(db, { phone: "+971500000001" });
  await rejects(checkout(db, { phone: "+971500000002" }), /insufficient_stock/);
  // A's hold runs out without payment; B can buy and pays.
  await db.query("update public.stock_reservations set expires_at = now() - interval '1 minute' where order_id = $1", [a.order_id]);
  const b = await checkout(db, { phone: "+971500000002" });
  assert.equal((await paid(db, b)).outcome, "applied");
  assert.equal((await order(db, b.order_id)).status, "confirmed");
  // A pays after all: the money is recorded, the order isn't confirmed, the team is told.
  const late = await paid(db, a);
  assert.equal(late.outcome, "discrepancy");
  const oa = await order(db, a.order_id);
  assert.deepEqual([oa.status, oa.payment_status], ["awaiting_confirmation", "paid"]);
  assert.equal((await db.query("select stock from public.products where ref = 'SH-0001'")).rows[0].stock, 0, "never oversold");
  assert.ok((await events(db, a.order_id)).some((e) => e.kind === "stock.conflict"));
  const q = await one(staff(db, "select public.admin_work_queues()"));
  assert.equal(q.paid_not_confirmed[0].id, a.order_id);
  // The owner can't confirm it with stock gone; cancelling leaves a refund owed.
  await rejects(owner(db, "select public.admin_confirm_order($1, 'confirm')", [a.order_id]), /insufficient_stock/);
  await owner(db, "select public.admin_cancel_order($1, 'Sold to another customer first', 'We are refunding you in full.')", [a.order_id]);
  assert.equal((await one(staff(db, "select public.admin_work_queues()"))).refunds_owed[0].id, a.order_id);
});

test("an expired checkout releases the hold; a payment after expiry is still recorded", async () => {
  const db = await setup();
  const c = await checkout(db);
  await db.query("update public.orders set quote_expires_at = now() - interval '1 minute' where id = $1", [c.order_id]);
  assert.equal((await event(db, { type: "session_expired", session_id: c.session })).outcome, "applied");
  assert.equal((await db.query("select count(*)::int n from public.stock_reservations where order_id = $1 and status = 'active'", [c.order_id])).rows[0].n, 0);
  const late = await paid(db, c);
  assert.equal(late.outcome, "discrepancy", "flagged: paid after expiry");
  // The piece was still free, so the order is confirmed.
  assert.equal((await order(db, c.order_id)).status, "confirmed");
});

test("quotes for on-request pieces: complete terms first, the customer accepts, the owner records the transfer", async () => {
  const db = await setup();
  const cust = (await db.query("insert into public.customers (name, phone_e164) values ('Noor', '+971509999999') returning id")).rows[0].id;
  const { id } = await one(owner(db, "select public.admin_create_order($1)", [{
    customer_id: cust, channel: "whatsapp", delivery_mode: "deliver", shipping_country: "AE", shipping_amount: "50", vat_treatment: "standard",
    contact_email: "noor@example.test",
    items: [{ description: "Birkin 25 Gold Togo GHW", brand: "Hermès", unit_amount: "120000", availability: "on_request" }],
  }]));
  let o = await order(db, id);
  assert.deepEqual([o.status, num(o.subtotal_amount), num(o.total_amount), num(o.vat_amount)], ["draft", 120000, 120050, 5716.67]);
  await rejects(owner(db, "select public.admin_send_quote($1, 48)", [id]), /quote_incomplete/);
  await rejects(staff(db, "select public.admin_update_order($1, $2, null)", [id, { cancellation_terms: "x" }]), /owner_only/);
  await owner(db, "select public.admin_update_order($1, $2, 'Terms agreed on WhatsApp')", [id, {
    cancellation_terms: "Full refund if the supplier cannot deliver by the date below.",
  }]);
  await staff(db, "select public.admin_update_order($1, $2, null)", [id, { delivery_estimate_from: "2026-11-01", delivery_estimate_to: "2026-11-10", delivery_estimate_note: "Sourcing 7–14 days, then 1–2 days delivery" }]);
  await rejects(staff(db, "select public.admin_send_quote($1, 48)", [id]), /owner_only/);
  await owner(db, "select public.admin_send_quote($1, 48)", [id]);
  await rejects(owner(db, "select public.admin_update_order($1, $2, null)", [id, { shipping_amount: "0" }]), /quote_sent/);

  // The customer's link shows the quote; they accept it.
  const token = randomUUID();
  await staff(db, "select public.admin_create_order_link($1, $2, 30)", [id, sha(token)]);
  const v = await view(db, token);
  assert.deepEqual([v.status, num(v.total), v.cancellation_terms !== null], ["awaiting_confirmation", 120050, true]);
  await one(anon(db, "select public.shop_order_accept_quote($1, $2)", [KEY, sha(token)]));
  assert.ok((await order(db, id)).accepted_at);

  // Staff note what the customer says they paid: it waits for the owner and counts for nothing.
  const claim = await one(staff(db, "select public.admin_record_payment($1, $2)", [id, { method: "bank_transfer", amount: "120050", idempotency_key: "claim-0001", note: "Receipt sent on WhatsApp" }]));
  await rejects(staff(db, "select public.admin_record_payment($1, $2)", [id, { method: "bank_transfer", amount: "1", verified: true, idempotency_key: "claim-0002" }]), /owner_only/);
  o = await order(db, id);
  assert.deepEqual([o.status, o.payment_status, num(o.amount_paid)], ["awaiting_confirmation", "pending", 0]);
  await rejects(staff(db, "select public.admin_verify_payment($1, true, 'seen')", [claim]), /owner_only/);
  await rejects(owner(db, "select public.admin_verify_payment($1, true, '')", [claim]), /invalid_request/);
  await owner(db, "select public.admin_verify_payment($1, true, 'Seen in the bank account on 22 Oct, ref FT123')", [claim]);
  o = await order(db, id);
  assert.deepEqual([o.status, o.payment_status, o.fulfilment_status], ["confirmed", "paid", "sourcing"]);
  const task = (await db.query("select * from public.sourcing_tasks where order_id = $1", [id])).rows[0];
  assert.equal(task.status, "open");
  assert.ok(task.confirm_by > new Date());

  // The supplier can't deliver: the line stays in sourcing and shows in the queue.
  await rejects(staff(db, "select public.admin_update_sourcing_task($1, $2)", [task.id, { status: "failed" }]), /invalid_request/);
  await staff(db, "select public.admin_update_sourcing_task($1, $2)", [task.id, { status: "failed", failure_reason: "Supplier sold it elsewhere" }]);
  assert.equal((await one(staff(db, "select public.admin_work_queues()"))).supplier_failed.length, 1);
  const item = (await db.query("select id from public.order_items where order_id = $1", [id])).rows[0].id;
  const next = await one(staff(db, "select public.admin_add_sourcing_task($1)", [item]));
  await staff(db, "select public.admin_update_sourcing_task($1, $2)", [next, { status: "supplier_confirmed", supplier: "Private seller, Paris", expected_at: "2026-11-05" }]);
  await staff(db, "select public.admin_update_sourcing_task($1, $2)", [next, { status: "received" }]);
  assert.equal((await order(db, id)).fulfilment_status, "quality_check");
  // Supplier details never reach the customer.
  assert.equal(JSON.stringify(await view(db, token)).includes("Paris"), false);
});

test("quality check, packing and handover need the evidence; a label is not shipped; delivered needs proof", async () => {
  const db = await setup();
  const c = await checkout(db, { lines: [{ ref: "SH-0001", qty: 1 }, { ref: "SH-0002", qty: 1 }] });
  await paid(db, c);
  const items = (await db.query("select id from public.order_items where order_id = $1 order by position", [c.order_id])).rows.map((r) => r.id);
  const photo = (fields) => staff(db, "select public.admin_add_evidence($1, $2)", [c.order_id, { path: `${c.order_id}/${randomUUID()}.jpg`, ...fields }]);

  await rejects(staff(db, "select public.admin_record_item_check($1, $2)", [items[0], { result: "passed", condition_confirmed: true }]), /photo_required/);
  await rejects(photo({ kind: "serial", order_item_id: 999999 }), /invalid_request/);
  await photo({ kind: "serial", order_item_id: items[0] });
  await photo({ kind: "condition", order_item_id: items[1] });
  await rejects(staff(db, "select public.admin_record_item_check($1, $2)", [items[0], { result: "passed", condition_confirmed: true, serial_matches: false }]), /invalid_request/);
  await rejects(staff(db, "select public.admin_record_item_check($1, $2)", [items[1], { result: "failed", condition_confirmed: true }]), /invalid_request/);
  await staff(db, "select public.admin_record_item_check($1, $2)", [items[0], { result: "passed", condition_confirmed: true, serial_matches: true, serial_reference: "Z123", accessories: ["dust bag", "box"] }]);
  await rejects(staff(db, "select public.admin_set_fulfilment_stage($1, 'packed', null)", [c.order_id]), /checks_missing/);
  await staff(db, "select public.admin_record_item_check($1, $2)", [items[1], { result: "passed", condition_confirmed: true }]);
  await staff(db, "select public.admin_set_fulfilment_stage($1, 'packed', null)", [c.order_id]);
  await rejects(staff(db, "select public.admin_set_fulfilment_stage($1, 'ready_to_dispatch', null)", [c.order_id]), /shipment_missing/);

  // Partial shipment: one piece now.
  const sh = await one(staff(db, "select public.admin_save_shipment(null, $1, $2, $3)", [c.order_id, { carrier: "Aramex", tracking_number: "AX1", label_created: true }, [{ order_item_id: items[0] }]]));
  assert.equal((await order(db, c.order_id)).fulfilment_status, "packed", "a label alone is not shipped");
  const handover = (who, note = null) => asUser(db, who, "select public.admin_shipment_handover($1, 'carrier_scan', now(), $2)", [sh, note]);
  await rejects(handover(STAFF), /shipment_incomplete/);
  await staff(db, "select public.admin_save_shipment($1, $2, $3, null)", [sh, c.order_id, { packed_contents: "Kelly 25, dust bag, box", declared_value: "50000", declared_currency: "AED", insurance: "carrier" }]);
  await rejects(handover(STAFF), /photo_required/);
  await photo({ kind: "packing", shipment_id: sh });
  await rejects(handover(STAFF), /coverage_unconfirmed/);
  await rejects(handover(OWNER), /coverage_unconfirmed/, "the owner needs a reason too");
  await handover(OWNER, "Carrier confirmed cover by phone; written confirmation to follow");
  let o = await order(db, c.order_id);
  assert.deepEqual([o.status, o.fulfilment_status], ["processing", "shipped"]);
  await rejects(owner(db, "select public.admin_cancel_order($1, 'changed mind', null)", [c.order_id]), /already_dispatched/);

  await staff(db, "select public.admin_shipment_status($1, 'in_transit', '{}')", [sh]);
  await staff(db, "select public.admin_shipment_status($1, 'exception', $2)", [sh, { exception_kind: "address_issue", note: "Wrong villa number", public_note: "The courier needs your villa number; we will call you." }]);
  assert.equal((await order(db, c.order_id)).fulfilment_status, "delivery_exception");
  assert.equal((await one(staff(db, "select public.admin_work_queues()"))).shipment_exceptions.length, 1);
  await staff(db, "select public.admin_shipment_status($1, 'out_for_delivery', '{}')", [sh]);
  await rejects(staff(db, "select public.admin_shipment_status($1, 'delivered', '{}')", [sh]), /evidence_required/);
  await rejects(staff(db, "select public.admin_shipment_status($1, 'delivered', $2)", [sh, { delivery_evidence: "owner_exception", note: "Customer said so" }]), /owner_only/);
  await staff(db, "select public.admin_shipment_status($1, 'delivered', $2)", [sh, { delivery_evidence: "carrier_proof", note: "POD AX1 signed by L. K." }]);
  o = await order(db, c.order_id);
  assert.notEqual(o.fulfilment_status, "delivered", "the second piece hasn't been delivered");
  assert.equal(o.status, "processing");

  // The customer's page explains the delay from recorded data.
  const v = await view(db, c.token);
  assert.ok(v.events.some((e) => e.note === "The courier needs your villa number; we will call you."));
  assert.equal(JSON.stringify(v).includes("Wrong villa number"), false, "internal notes stay internal");
  assert.equal(JSON.stringify(v).includes("Z123"), false, "serial numbers stay internal");
});

test("refunds: owner only, against a captured payment, never more than is left, pending until confirmed", async () => {
  const db = await setup();
  const c = await checkout(db);
  await paid(db, c);
  const pay = (await db.query("select id from public.payments where order_id = $1", [c.order_id])).rows[0].id;
  const refund = (who, fields) => asUser(db, who, "select public.admin_create_refund($1, $2)", [c.order_id, { payment_id: pay, reason: "Goodwill", idempotency_key: randomUUID(), ...fields }]);
  await rejects(refund(STAFF, { items_amount: "10" }), /owner_only/);
  await rejects(refund(OWNER, { items_amount: "50001", shipping_amount: "50" }), /refund_exceeds_payment/);
  await rejects(refund(OWNER, { items_amount: "100", deduction_amount: "10" }), /invalid_request/, "a deduction needs a reason");
  await rejects(refund(OWNER, { items_amount: "100", route: "bank_transfer" }), /invalid_request/, "another route is an exception with a reason");

  const idem = randomUUID();
  const r1 = await one(refund(OWNER, { items_amount: "20000", idempotency_key: idem }));
  assert.equal(await one(refund(OWNER, { items_amount: "20000", idempotency_key: idem })), r1, "a double click is one refund");
  assert.equal((await order(db, c.order_id)).payment_status, "refund_pending");
  await rejects(refund(OWNER, { items_amount: "30001", shipping_amount: "50" }), /refund_exceeds_payment/, "approved refunds count against what is left");
  // A provider refund is never settled by hand, and stays pending until the provider confirms it.
  await rejects(owner(db, "select public.admin_settle_refund($1, 'succeeded', 'sent')", [r1]), /invalid_request/);
  const todo = await one(anon(db, "select public.payments_refunds_to_submit($1)", [KEY]));
  assert.equal(todo[0].id, r1);
  await anon(db, "select public.payments_refund_submitted($1, $2, 're_1', null)", [KEY, r1]);
  assert.equal((await db.query("select status from public.refunds where id = $1", [r1])).rows[0].status, "pending");
  assert.equal((await event(db, { type: "refund_succeeded", refund_ref: "re_1", amount: 20000, currency: "AED", event_id: "evt_r1" })).outcome, "applied");
  assert.equal((await event(db, { type: "refund_succeeded", refund_ref: "re_1", amount: 20000, currency: "AED", event_id: "evt_r1" })).outcome, "duplicate");
  let o = await order(db, c.order_id);
  assert.deepEqual([o.payment_status, num(o.amount_refunded)], ["partially_refunded", 20000]);

  // A refund that fails is visible, and doesn't count.
  const r2 = await one(refund(OWNER, { items_amount: "30000", shipping_amount: "50" }));
  await anon(db, "select public.payments_refund_submitted($1, $2, 're_2', null)", [KEY, r2]);
  await event(db, { type: "refund_failed", refund_ref: "re_2", failure_reason: "account_closed" });
  o = await order(db, c.order_id);
  assert.deepEqual([o.payment_status, num(o.amount_refunded)], ["refund_failed", 20000]);
  assert.equal((await one(staff(db, "select public.admin_work_queues()"))).refunds_open.length, 1);
  // Retried as a documented bank transfer and confirmed by the owner.
  const r3 = await one(refund(OWNER, { items_amount: "30000", shipping_amount: "50", route: "bank_transfer", exception_reason: "Card account closed; customer asked for a transfer" }));
  await owner(db, "select public.admin_settle_refund($1, 'succeeded', 'Transfer FT999 sent and confirmed by the bank')", [r3]);
  o = await order(db, c.order_id);
  assert.deepEqual([o.payment_status, num(o.amount_refunded)], ["refunded", 50050]);
  await rejects(refund(OWNER, { items_amount: "1" }), /refund_exceeds_payment/);
});

test("returns: the customer asks, the owner decides, inspection before restock, a refund closes it", async () => {
  const db = await setup();
  const c = await checkout(db);
  await paid(db, c);
  const item = (await db.query("select id from public.order_items where order_id = $1", [c.order_id])).rows[0].id;
  const photo = (fields) => staff(db, "select public.admin_add_evidence($1, $2)", [c.order_id, { path: `${c.order_id}/${randomUUID()}.jpg`, ...fields }]);
  const ask = (over = {}) => one(anon(db, "select public.shop_order_request_return($1, $2, $3)", [KEY, sha(c.token), {
    idempotency_key: randomUUID(), reason: "change_of_mind", description: "Colour is not for me", items: [{ order_item_id: item }], ...over }]));
  await rejects(ask(), /invalid_request/, "nothing delivered yet");

  // Deliver it.
  await photo({ kind: "product", order_item_id: item });
  await staff(db, "select public.admin_record_item_check($1, $2)", [item, { result: "passed", condition_confirmed: true }]);
  const sh = await one(staff(db, "select public.admin_save_shipment(null, $1, $2, $3)", [c.order_id, {
    carrier: "Aramex", tracking_number: "AX9", packed_contents: "Kelly 25", declared_value: "50000", insurance: "carrier", coverage_confirmed: true }, [{ order_item_id: item }]]));
  await photo({ kind: "packing", shipment_id: sh });
  await staff(db, "select public.admin_shipment_handover($1, 'signed_handover', now(), null)", [sh]);
  await staff(db, "select public.admin_shipment_status($1, 'delivered', $2)", [sh, { delivery_evidence: "carrier_proof", note: "POD AX9" }]);
  assert.deepEqual([(await order(db, c.order_id)).status, (await order(db, c.order_id)).fulfilment_status], ["completed", "delivered"]);

  const idem = randomUUID();
  const req = await ask({ idempotency_key: idem });
  assert.equal(req.created, true);
  assert.equal((await ask({ idempotency_key: idem })).reference, req.reference);
  await rejects(ask(), /invalid_request/, "the piece is already in a return");
  const ret = (await db.query("select * from public.returns where reference = $1", [req.reference])).rows[0];
  assert.equal(ret.eligibility.change_of_mind_in_window, true);
  assert.equal(ret.eligibility.change_of_mind_days, 7);
  assert.equal((await one(staff(db, "select public.admin_work_queues()"))).return_reviews.length, 1);

  await rejects(staff(db, "select public.admin_decide_return($1, $2)", [ret.id, { approve: true }]), /owner_only/);
  await rejects(owner(db, "select public.admin_decide_return($1, $2)", [ret.id, { approve: false, decision_reason: "Worn" }]), /invalid_request/, "a rejection needs the escalation path");
  await owner(db, "select public.admin_decide_return($1, $2)", [ret.id, { approve: false, decision_reason: "Outside the policy", support_path: "Reply on your order page or write to info@sevnhevn.ae for a review by the owner." }]);
  let v = await view(db, c.token);
  assert.equal(v.returns[0].status, "rejected");
  assert.match(v.returns[0].support_path, /review/);
  // Reopened on review and approved.
  await staff(db, "select public.admin_return_status($1, 'under_review', $2)", [ret.id, { note: "Customer asked for a review" }]);
  await owner(db, "select public.admin_decide_return($1, $2)", [ret.id, { approve: true, collection_method: "courier_collection", return_cost: "120", return_cost_paid_by: "shop" }]);
  await staff(db, "select public.admin_return_status($1, 'awaiting_collection', '{}')", [ret.id]);
  await staff(db, "select public.admin_return_status($1, 'received', '{}')", [ret.id]);
  await rejects(staff(db, "select public.admin_restock_return($1)", [ret.id]), /not_restockable/, "never before inspection");
  await rejects(staff(db, "select public.admin_inspect_return($1, $2)", [ret.id, { inspection_result: "as_described", identity_matches: true }]), /photo_required/);
  await photo({ kind: "inspection", return_id: ret.id });
  await staff(db, "select public.admin_inspect_return($1, $2)", [ret.id, { inspection_result: "as_described", identity_matches: true, inspection_notes: "Serial matches; unused" }]);
  await staff(db, "select public.admin_restock_return($1)", [ret.id]);
  await rejects(staff(db, "select public.admin_restock_return($1)", [ret.id]), /not_restockable/, "restocked once");
  assert.equal((await db.query("select stock from public.products where ref = 'SH-0001'")).rows[0].stock, 1);

  await rejects(owner(db, "select public.admin_resolve_return($1, $2)", [ret.id, { resolution: "refund" }]), /refund_not_confirmed/);
  const pay = (await db.query("select id from public.payments where order_id = $1", [c.order_id])).rows[0].id;
  const rf = await one(owner(db, "select public.admin_create_refund($1, $2)", [c.order_id, { payment_id: pay, return_id: ret.id, items_amount: "50000", reason: "Approved return", idempotency_key: randomUUID() }]));
  // The original delivery fee is tracked apart from the piece; here the owner refunds the piece only.
  await anon(db, "select public.payments_refund_submitted($1, $2, 're_ret', null)", [KEY, rf]);
  await event(db, { type: "refund_succeeded", refund_ref: "re_ret", amount: 50000, currency: "AED" });
  await owner(db, "select public.admin_resolve_return($1, $2)", [ret.id, { resolution: "refund" }]);
  v = await view(db, c.token);
  assert.deepEqual([v.returns[0].status, v.payment_status, num(v.refunded), num(v.paid)], ["resolved", "partially_refunded", 50000, 50050]);
});

test("cancellation before dispatch puts the piece back and leaves the refund to the owner", async () => {
  const db = await setup();
  const c = await checkout(db);
  await paid(db, c);
  assert.equal((await db.query("select stock from public.products where ref = 'SH-0001'")).rows[0].stock, 0);
  await one(anon(db, "select public.shop_order_message($1, $2, 'cancellation_request', 'Please cancel, I found it elsewhere')", [KEY, sha(c.token)]));
  assert.equal((await one(staff(db, "select public.admin_work_queues()"))).customer_messages[0].kind, "cancellation_request");
  await rejects(staff(db, "select public.admin_cancel_order($1, 'asked', null)", [c.order_id]), /owner_only/);
  await rejects(owner(db, "select public.admin_cancel_order($1, '', null)", [c.order_id]), /reason_required/);
  await owner(db, "select public.admin_cancel_order($1, 'Customer asked on the order page', 'Cancelled as you asked. Your refund follows.')", [c.order_id]);
  const o = await order(db, c.order_id);
  assert.deepEqual([o.status, o.payment_status], ["cancelled", "paid"], "cancelling doesn't pretend a refund happened");
  assert.equal((await db.query("select stock from public.products where ref = 'SH-0001'")).rows[0].stock, 1);
  assert.equal((await one(staff(db, "select public.admin_work_queues()"))).refunds_owed.length, 1);
  await staff(db, "select public.admin_post_order_update($1, 'Your refund has been approved.', true)", [c.order_id]);
  assert.equal((await one(staff(db, "select public.admin_work_queues()"))).customer_messages.length, 0);
});

test("customer links: one order only, never from the number alone; revoked and draft links show nothing", async () => {
  const db = await setup();
  const a = await checkout(db, { phone: "+971500000011" });
  const b = await checkout(db, { phone: "+971500000012", lines: [{ ref: "SH-0002", qty: 1 }] });
  assert.equal((await view(db, a.token)).reference, a.reference);
  assert.equal((await view(db, b.token)).reference, b.reference);
  assert.equal(await view(db, randomUUID()), null);
  assert.equal(await one(anon(db, "select public.shop_order_view($1, $2, 'c')", [KEY, a.reference])), null, "the reference is not a key");
  await rejects(anon(db, "select public.shop_order_view('wrong-key', $1, 'c')", [sha(a.token)]), /not_authorized|invalid/);
  const link = (await db.query("select id from public.order_access_links where order_id = $1", [a.order_id])).rows[0].id;
  await staff(db, "select public.admin_revoke_order_link($1)", [link]);
  assert.equal(await view(db, a.token), null);
  // A staff link to a draft quote can't be made.
  const cust = (await db.query("select customer_id from public.orders where id = $1", [a.order_id])).rows[0].customer_id;
  const { id } = await one(owner(db, "select public.admin_create_order($1)", [{ customer_id: cust, items: [{ description: "x", unit_amount: "1" }] }]));
  await rejects(staff(db, "select public.admin_create_order_link($1, $2, 30)", [id, sha("t")]), /invalid_request/);
  // Nothing internal in the view.
  const v = JSON.stringify(await view(db, b.token));
  for (const secret of ["token_hash", "supplier", "verification_note", "+971500000012", "client_hash", "Villa 1"]) assert.equal(v.includes(secret), false, secret);
});

test("access: the public and non-team accounts see no order data; staff read but never write directly", async () => {
  const db = await setup();
  const c = await checkout(db);
  await paid(db, c);
  const tables = ["payments", "refunds", "payment_events", "stock_reservations", "sourcing_tasks", "order_item_checks", "shipments",
    "returns", "order_evidence", "order_messages", "order_access_links", "order_events", "shop_settings", "shipping_zones"];
  for (const t of tables) {
    await rejects(anon(db, `select * from public.${t}`), /permission denied/, t);
    assert.equal((await asUser(db, OUTSIDER, `select count(*)::int n from public.${t}`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n, 0, t);
    await rejects(staff(db, `delete from public.${t}`), /permission denied/, t);
  }
  assert.ok((await staff(db, "select count(*)::int n from public.payments")).rows[0].n > 0);
  await rejects(staff(db, "select token_hash from public.order_access_links"), /permission denied/);
  await rejects(staff(db, "update public.orders set payment_status = 'refunded'"), /permission denied/);
  await rejects(asUser(db, OUTSIDER, "select public.admin_work_queues()"), /not_authorized/);
  await rejects(anon(db, "select public.admin_create_refund($1, '{}')", [c.order_id]), /permission denied/);
  // Approved policies are public; drafts aren't.
  await owner(db, "select public.admin_save_policy(null, $1)", [{ kind: "shipping", version: "draft-1", title: "Shipping", body: "draft" }]);
  const pub = (await anon(db, "select kind, status from public.policy_versions order by kind")).rows;
  assert.deepEqual(pub.map((r) => r.status), ["approved", "approved"]);
});

test("order status changes follow the allowed path", async () => {
  const db = await setup();
  const c = await checkout(db);
  await rejects(db.query("update public.orders set status = 'completed' where id = $1", [c.order_id]), /invalid_transition/);
  await rejects(db.query("update public.orders set status = 'cancelled' where id = $1", [c.order_id]), /reason_required/);
  await paid(db, c);
  await rejects(db.query("update public.orders set status = 'completed' where id = $1", [c.order_id]), /not_delivered/);
  await rejects(db.query("update public.orders set status = 'draft' where id = $1", [c.order_id]), /invalid_transition/);
});

test("the rollback restores the first panel's orders and keeps existing orders", async () => {
  const db = await setup();
  const c = await checkout(db);
  await paid(db, c);
  await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text)");
  await db.exec(readFileSync(join(import.meta.dirname, "..", "rollbacks", "20261022120000_order_lifecycle.down.sql"), "utf8"));
  const o = (await db.query("select status::text, payment_status::text, fulfilment_status::text from public.orders where id = $1", [c.order_id])).rows[0];
  assert.deepEqual(o, { status: "open", payment_status: "paid", fulfilment_status: "preparing" });
  const cust = (await db.query("select customer_id from public.orders where id = $1", [c.order_id])).rows[0].customer_id;
  await owner(db, "select public.admin_create_order($1, null, 'AED', 1000, $2, null, null, null)", [cust, JSON.stringify([{ description: "x" }])]);
  await owner(db, "select public.admin_update_order($1, $2)", [c.order_id, { payment_status: "refunded" }]);
  assert.equal((await db.query("select to_regclass('public.payments') is null as gone")).rows[0].gone, true);
});

test("customer e-mails: only when switched on, with the address only in customer messages, and a fresh link each time", async () => {
  const db = await setup();
  await owner(db, "select public.admin_save_shop_settings($1)", [{ customer_emails_enabled: "true" }]);
  const c = await checkout(db);
  await paid(db, c);
  const claimed = await one(anon(db, "select public.concierge_claim_notifications($1, array['email'], null, 25)", [KEY]));
  const customer = claimed.find((n) => n.recipient === "customer");
  const team = claimed.find((n) => n.recipient === "team" && n.template === "order_confirmed");
  assert.equal(customer.template, "order_confirmed");
  assert.equal(customer.order.email, "layla@example.test");
  assert.equal(team.order.email, null, "team alerts never carry the customer's address");
  const token = randomUUID();
  await rejects(anon(db, "select public.concierge_issue_customer_link($1, $2, $3)", [KEY, team.id, sha(token)]), /invalid_request/);
  await anon(db, "select public.concierge_issue_customer_link($1, $2, $3)", [KEY, customer.id, sha(token)]);
  assert.equal((await view(db, token)).reference, c.reference);
  await anon(db, "select public.concierge_finish_notification($1, $2, 'sent', null, 'msg-1')", [KEY, customer.id]);
  await rejects(anon(db, "select public.concierge_issue_customer_link($1, $2, $3)", [KEY, customer.id, sha(randomUUID())]), /invalid_request/, "only while sending");
});
