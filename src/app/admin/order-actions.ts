"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DbError, rpc } from "@/lib/concierge/db";
import { processNotifications } from "@/lib/concierge/notify";
import { isEmail } from "@/lib/concierge/phone";
import { requireOwner, requireStaff } from "@/lib/admin/session";
import { newOrderToken, orderLink, submitApprovedRefunds, tokenHash } from "@/lib/orders/server";

/**
 * Panel actions for the order lifecycle. Every one goes through an admin_* database function that
 * checks the person's role and records who did what and why; the checks here only catch typing
 * mistakes early.
 */

const str = (f: FormData, k: string, max = 2000) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INT = /^[0-9]{1,18}$/;
const uuid = (f: FormData, k = "id") => {
  const v = str(f, k, 40);
  if (!UUID.test(v)) redirect("/admin/orders?error=invalid_request");
  return v;
};
const intId = (f: FormData, k: string) => {
  const v = str(f, k, 20);
  if (!INT.test(v)) redirect("/admin/orders?error=invalid_request");
  return Number(v);
};
/** "12,500.50" → "12500.50"; empty stays empty (the database treats it as "not set"). */
const amount = (f: FormData, k: string) => str(f, k, 20).replace(/[,\s]/g, "");
const checked = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";

function back(orderId: string | null, flash: { ok?: string; error?: string }, anchor = ""): never {
  const q = new URLSearchParams(flash as Record<string, string>);
  redirect(`${orderId ? `/admin/orders/${orderId}` : "/admin/orders"}?${q}${anchor}`);
}

async function run(orderId: string | null, fn: () => Promise<unknown>, ok = "saved", anchor = ""): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DbError) back(orderId, { error: e.code }, anchor);
    throw e;
  }
  // Anything the change queued (customer e-mail, team alert) goes out now; the daily job retries.
  await processNotifications().catch(() => {});
  back(orderId, { ok }, anchor);
}

// ── Lines and amounts ───────────────────────────────────────────────────────────────

/** Line rows of the order form: item_description_0, item_brand_0, … (blank rows are skipped). */
function itemsFrom(form: FormData) {
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < 30; i++) {
    const description = str(form, `item_description_${i}`, 300);
    if (!description) continue;
    const qty = Number(str(form, `item_quantity_${i}`, 3) || "1");
    items.push({
      description,
      brand: str(form, `item_brand_${i}`, 80),
      product_ref: str(form, `item_ref_${i}`, 40),
      sku: str(form, `item_sku_${i}`, 48),
      options: str(form, `item_options_${i}`, 200),
      quantity: Number.isInteger(qty) && qty > 0 ? Math.min(qty, 50) : 1,
      unit_amount: amount(form, `item_unit_${i}`),
      availability: str(form, `item_availability_${i}`, 12) === "on_request" ? "on_request" : "in_stock",
      condition: str(form, `item_condition_${i}`, 40),
      condition_notes: str(form, `item_condition_notes_${i}`, 500),
      included: str(form, `item_included_${i}`, 400).split(",").map((x) => x.trim()).filter(Boolean),
    });
  }
  return items;
}

const QUOTE_FIELDS = [
  "channel", "delivery_mode", "shipping_country", "shipping_address", "shipping_destination", "recipient_name", "recipient_phone",
  "vat_treatment", "duties_treatment", "duties_note", "cancellation_terms", "sourcing_eta", "transit_days_min", "transit_days_max",
  "delivery_estimate_from", "delivery_estimate_to", "delivery_estimate_note", "customer_note", "contact_email",
] as const;

export async function createOrder(form: FormData) {
  const ctx = await requireOwner();
  const customer = uuid(form, "customer_id");
  const request = str(form, "request_id", 40);
  const backTo = `/admin/orders/new?customer=${customer}${UUID.test(request) ? `&request=${request}` : ""}`;
  const items = itemsFrom(form);
  const email = str(form, "contact_email", 254);
  if (!items.length || (email && !isEmail(email))) redirect(`${backTo}&error=invalid_request`);
  const order: Record<string, unknown> = {
    customer_id: customer,
    request_id: UUID.test(request) ? request : null,
    currency: (str(form, "currency", 3) || "AED").toUpperCase(),
    discount_amount: amount(form, "discount_amount"),
    shipping_amount: amount(form, "shipping_amount"),
    items,
  };
  for (const k of QUOTE_FIELDS) order[k] = str(form, k, 1000);
  let created: { id: string } | null = null;
  try {
    created = await rpc<{ id: string }>(ctx.api, "admin_create_order", { p_order: order }, ctx.token);
  } catch (e) {
    if (e instanceof DbError) redirect(`${backTo}&error=${e.code}`);
    throw e;
  }
  back(created!.id, { ok: "order_created" });
}

/** The quote form (owner, draft): lines, amounts, delivery, VAT and duties, terms. */
export async function saveQuote(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form);
  const changes: Record<string, unknown> = {
    items: itemsFrom(form),
    currency: (str(form, "currency", 3) || "AED").toUpperCase(),
    discount_amount: amount(form, "discount_amount"),
    shipping_amount: amount(form, "shipping_amount"),
  };
  for (const k of QUOTE_FIELDS) if (form.has(k)) changes[k] = str(form, k, 1000);
  if (!(changes.items as unknown[]).length) back(oid, { error: "invalid_request" });
  await run(oid, () => rpc(ctx.api, "admin_update_order", { p_id: oid, p_changes: changes, p_reason: str(form, "reason", 600) || "Quote edited" }, ctx.token));
}

/** Operational fields any team member may change (and, for the owner, terms and contact e-mail). */
export async function updateOrderDetails(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form);
  const staffKeys = ["assigned_to", "shipping_address", "shipping_destination", "recipient_name", "recipient_phone", "sourcing_eta",
    "delivery_estimate_from", "delivery_estimate_to", "delivery_estimate_note", "customer_note"];
  const ownerKeys = ["contact_email", "cancellation_terms", "transit_days_min", "transit_days_max"];
  const changes: Record<string, unknown> = {};
  for (const k of staffKeys) if (form.has(k)) changes[k] = str(form, k, 600);
  if (ctx.isOwner) for (const k of ownerKeys) if (form.has(k)) changes[k] = str(form, k, 1000);
  if (ctx.isOwner && form.has("quote_expires_at")) {
    const v = str(form, "quote_expires_at", 20);
    changes.quote_expires_at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00+04:00`).toISOString() : "";
  }
  const email = changes.contact_email as string | undefined;
  if (email && !isEmail(email)) back(oid, { error: "invalid_request" });
  await run(oid, () => rpc(ctx.api, "admin_update_order", { p_id: oid, p_changes: changes, p_reason: str(form, "reason", 600) || null }, ctx.token));
}

export async function sendQuote(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form);
  const hours = Number(str(form, "valid_hours", 4));
  await run(oid, () => rpc(ctx.api, "admin_send_quote", { p_id: oid, p_valid_hours: Number.isInteger(hours) && hours > 0 ? hours : null }, ctx.token), "quote_sent");
}

export async function reopenQuote(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form);
  await run(oid, () => rpc(ctx.api, "admin_reopen_quote", { p_id: oid, p_reason: str(form, "reason", 600) }, ctx.token));
}

export async function confirmOrder(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form);
  await run(oid, () => rpc(ctx.api, "admin_confirm_order", { p_id: oid, p_reason: str(form, "reason", 600) || null }, ctx.token), "order_confirmed");
}

export async function cancelOrder(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form);
  if (str(form, "confirm", 10) !== "CANCEL") back(oid, { error: "confirm_cancel" });
  await run(oid, () => rpc(ctx.api, "admin_cancel_order", { p_id: oid, p_reason: str(form, "reason", 600), p_public_note: str(form, "public_note", 600) || null }, ctx.token), "order_cancelled");
}

export async function setItemAvailability(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form);
  await run(oid, () => rpc(ctx.api, "admin_set_item_availability", { p_item: intId(form, "item_id"), p_availability: str(form, "availability", 12), p_reason: str(form, "reason", 600) }, ctx.token));
}

// ── Payments and refunds ────────────────────────────────────────────────────────────

export async function recordPayment(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form);
  const verified = ctx.isOwner && checked(form, "verified");
  await run(oid, () => rpc(ctx.api, "admin_record_payment", {
    p_order: oid,
    p_fields: { method: str(form, "method", 20), amount: amount(form, "amount"), note: str(form, "note", 600), verified, idempotency_key: str(form, "idempotency_key", 64) || randomUUID() },
  }, ctx.token), verified ? "payment_recorded" : "payment_noted", "#payments");
}

export async function verifyPayment(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form, "order_id");
  await run(oid, () => rpc(ctx.api, "admin_verify_payment", { p_payment: uuid(form, "payment_id"), p_accept: str(form, "decision", 10) === "accept", p_note: str(form, "note", 600) }, ctx.token), "saved", "#payments");
}

export async function resolvePaymentEvent(form: FormData) {
  const ctx = await requireOwner();
  const oid = str(form, "order_id", 40);
  await run(UUID.test(oid) ? oid : null, () => rpc(ctx.api, "admin_resolve_payment_event", { p_id: intId(form, "event_id"), p_note: str(form, "note", 600) }, ctx.token));
}

export async function createRefund(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form);
  try {
    await rpc(ctx.api, "admin_create_refund", {
      p_order: oid,
      p_fields: {
        payment_id: uuid(form, "payment_id"),
        return_id: str(form, "return_id", 40) || null,
        items_amount: amount(form, "items_amount"),
        shipping_amount: amount(form, "shipping_amount"),
        vat_amount: amount(form, "vat_amount"),
        deduction_amount: amount(form, "deduction_amount"),
        deduction_reason: str(form, "deduction_reason", 600),
        reason: str(form, "reason", 600),
        route: str(form, "route", 20) || "original_payment",
        exception_reason: str(form, "exception_reason", 600),
        idempotency_key: str(form, "idempotency_key", 64) || randomUUID(),
      },
    }, ctx.token);
  } catch (e) {
    if (e instanceof DbError) back(oid, { error: e.code }, "#refunds");
    throw e;
  }
  // Provider refunds go out now (and again from the daily job if this fails). They stay pending
  // until the provider confirms them.
  await submitApprovedRefunds().catch(() => {});
  await processNotifications().catch(() => {});
  back(oid, { ok: "refund_approved" }, "#refunds");
}

export async function settleRefund(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form, "order_id");
  await run(oid, () => rpc(ctx.api, "admin_settle_refund", { p_refund: uuid(form, "refund_id"), p_outcome: str(form, "outcome", 12), p_note: str(form, "note", 600) }, ctx.token), "saved", "#refunds");
}

// ── Sourcing, checks, shipments ─────────────────────────────────────────────────────

export async function setStage(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form);
  await run(oid, () => rpc(ctx.api, "admin_set_fulfilment_stage", { p_id: oid, p_stage: str(form, "stage", 30), p_reason: str(form, "reason", 600) || null }, ctx.token));
}

export async function updateSourcing(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form, "order_id");
  const changes: Record<string, unknown> = {};
  for (const k of ["status", "assigned_to", "supplier", "supplier_reference", "expected_at", "notes", "failure_reason"]) if (form.has(k)) changes[k] = str(form, k, 2000);
  if (form.has("confirm_by")) {
    const v = str(form, "confirm_by", 20);
    changes.confirm_by = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00+04:00`).toISOString() : "";
  }
  await run(oid, () => rpc(ctx.api, "admin_update_sourcing_task", { p_id: intId(form, "task_id"), p_changes: changes }, ctx.token), "saved", "#sourcing");
}

export async function addSourcingTask(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form, "order_id");
  await run(oid, () => rpc(ctx.api, "admin_add_sourcing_task", { p_item: intId(form, "item_id") }, ctx.token), "saved", "#sourcing");
}

export async function recordCheck(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form, "order_id");
  const result = str(form, "result", 10) === "failed" ? "failed" : "passed";
  const serial = str(form, "serial_matches", 10);
  await run(oid, () => rpc(ctx.api, "admin_record_item_check", {
    p_item: intId(form, "item_id"),
    p_fields: {
      result,
      serial_reference: str(form, "serial_reference", 120),
      serial_matches: serial === "yes" ? true : serial === "no" ? false : null,
      condition_confirmed: checked(form, "condition_confirmed"),
      condition_notes: str(form, "condition_notes", 1000),
      accessories: str(form, "accessories", 600).split(",").map((x) => x.trim()).filter(Boolean),
      authenticity_notes: str(form, "authenticity_notes", 2000),
      failure_reason: str(form, "failure_reason", 600),
    },
  }, ctx.token), "check_recorded", "#checks");
}

export async function saveShipment(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form, "order_id");
  const sid = str(form, "shipment_id", 40);
  const fields: Record<string, unknown> = {};
  for (const k of ["carrier", "service", "tracking_number", "tracking_url", "declared_value", "declared_currency", "insurance", "insurance_reference",
    "coverage_note", "delivery_requirements", "packed_contents"]) if (form.has(k)) fields[k] = k === "declared_value" ? amount(form, k) : str(form, k, 1000);
  if (!UUID.test(sid)) fields.direction = str(form, "direction", 10) === "return" ? "return" : "outbound";
  fields.coverage_confirmed = checked(form, "coverage_confirmed");
  fields.label_created = checked(form, "label_created");
  const url = fields.tracking_url as string | undefined;
  if (url && !/^https:\/\/\S+$/.test(url)) back(oid, { error: "invalid_request" }, "#shipments");
  const items = form.getAll("item").map(String).filter((v) => INT.test(v)).map((v) => ({ order_item_id: Number(v) }));
  await run(oid, () => rpc(ctx.api, "admin_save_shipment", { p_id: UUID.test(sid) ? sid : null, p_order: oid, p_fields: fields, p_items: items.length ? items : null }, ctx.token), "saved", "#shipments");
}

export async function handOver(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form, "order_id");
  const at = str(form, "at", 20);
  await run(oid, () => rpc(ctx.api, "admin_shipment_handover", {
    p_id: uuid(form, "shipment_id"),
    p_evidence: str(form, "evidence", 20),
    p_at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? new Date(`${at}:00+04:00`).toISOString() : null,
    p_note: str(form, "note", 600) || null,
  }, ctx.token), "handed_over", "#shipments");
}

export async function shipmentStatus(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form, "order_id");
  const at = str(form, "at", 20);
  await run(oid, () => rpc(ctx.api, "admin_shipment_status", {
    p_id: uuid(form, "shipment_id"),
    p_status: str(form, "status", 30),
    p_fields: {
      delivery_evidence: str(form, "delivery_evidence", 20),
      exception_kind: str(form, "exception_kind", 20),
      note: str(form, "note", 600),
      public_note: str(form, "public_note", 600),
      at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? new Date(`${at}:00+04:00`).toISOString() : "",
    },
  }, ctx.token), "saved", "#shipments");
}

export async function recordCollection(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form);
  await run(oid, () => rpc(ctx.api, "admin_record_collection", { p_id: oid, p_note: str(form, "note", 600) }, ctx.token));
}

// ── Returns ─────────────────────────────────────────────────────────────────────────

export async function createReturn(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form);
  const items = form.getAll("item").map(String).filter((v) => INT.test(v)).map((v) => ({ order_item_id: Number(v), quantity: 1 }));
  await run(oid, () => rpc(ctx.api, "admin_create_return", { p_order: oid, p_fields: { reason: str(form, "reason", 30), description: str(form, "description", 2000), items } }, ctx.token), "saved", "#returns");
}

export async function decideReturn(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form, "order_id");
  await run(oid, () => rpc(ctx.api, "admin_decide_return", {
    p_id: uuid(form, "return_id"),
    p_fields: {
      approve: str(form, "decision", 10) === "approve",
      decision_reason: str(form, "decision_reason", 1000),
      support_path: str(form, "support_path", 600),
      collection_method: str(form, "collection_method", 30),
      return_cost: amount(form, "return_cost"),
      return_cost_paid_by: str(form, "return_cost_paid_by", 10),
    },
  }, ctx.token), "saved", "#returns");
}

export async function returnStatus(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form, "order_id");
  await run(oid, () => rpc(ctx.api, "admin_return_status", {
    p_id: uuid(form, "return_id"), p_status: str(form, "status", 30), p_fields: { note: str(form, "note", 600), return_shipment_id: str(form, "return_shipment_id", 40) },
  }, ctx.token), "saved", "#returns");
}

export async function inspectReturn(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form, "order_id");
  const identity = str(form, "identity_matches", 5);
  await run(oid, () => rpc(ctx.api, "admin_inspect_return", {
    p_id: uuid(form, "return_id"),
    p_fields: { inspection_result: str(form, "inspection_result", 30), identity_matches: identity === "yes" ? true : identity === "no" ? false : null, inspection_notes: str(form, "inspection_notes", 2000) },
  }, ctx.token), "saved", "#returns");
}

export async function restockReturn(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form, "order_id");
  await run(oid, () => rpc(ctx.api, "admin_restock_return", { p_id: uuid(form, "return_id") }, ctx.token), "restocked", "#returns");
}

export async function resolveReturn(form: FormData) {
  const ctx = await requireOwner();
  const oid = uuid(form, "order_id");
  await run(oid, () => rpc(ctx.api, "admin_resolve_return", {
    p_id: uuid(form, "return_id"), p_fields: { resolution: str(form, "resolution", 30), resolution_note: str(form, "resolution_note", 1000) },
  }, ctx.token), "saved", "#returns");
}

// ── The customer ────────────────────────────────────────────────────────────────────

export async function postUpdate(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form);
  await run(oid, () => rpc(ctx.api, "admin_post_order_update", { p_order: oid, p_public_note: str(form, "body", 600), p_reply: str(form, "kind", 10) === "reply" }, ctx.token), "update_posted", "#customer");
}

export async function markMessagesHandled(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form);
  await run(oid, () => rpc(ctx.api, "admin_mark_messages_handled", { p_order: oid }, ctx.token), "saved", "#customer");
}

/**
 * A private link for the customer. The token is shown once on the next page view (a short-lived,
 * httpOnly cookie scoped to this order's page), never put in a URL, and only its hash is stored.
 */
export async function createCustomerLink(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form);
  const days = Number(str(form, "days", 3));
  const token = newOrderToken();
  try {
    await rpc(ctx.api, "admin_create_order_link", { p_order: oid, p_token_hash: tokenHash(token), p_days: Number.isInteger(days) && days > 0 ? days : 60 }, ctx.token);
  } catch (e) {
    if (e instanceof DbError) back(oid, { error: e.code }, "#customer");
    throw e;
  }
  (await cookies()).set("sevn-new-order-link", orderLink(token), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: `/admin/orders/${oid}`, maxAge: 120 });
  back(oid, { ok: "link_created" }, "#customer");
}

export async function revokeCustomerLink(form: FormData) {
  const ctx = await requireStaff();
  const oid = uuid(form, "order_id");
  await run(oid, () => rpc(ctx.api, "admin_revoke_order_link", { p_id: uuid(form, "link_id") }, ctx.token), "saved", "#customer");
}

// ── Settings (owner) ────────────────────────────────────────────────────────────────

function backSettings(flash: { ok?: string; error?: string }): never {
  redirect(`/admin/settings?${new URLSearchParams(flash as Record<string, string>)}#shop`);
}

async function runSettings(fn: () => Promise<unknown>): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DbError) backSettings({ error: e.code });
    throw e;
  }
  backSettings({ ok: "saved" });
}

export async function saveShopSettings(form: FormData) {
  const ctx = await requireOwner();
  const changes: Record<string, string> = {};
  for (const k of ["reservation_minutes", "quote_valid_hours", "vat_trn", "vat_rate_percent", "prices_include_vat", "change_of_mind_days", "dispatch_alert_days", "supplier_alert_days"]) {
    if (form.has(k)) changes[k] = str(form, k, 20);
  }
  changes.customer_emails_enabled = checked(form, "customer_emails_enabled") ? "true" : "false";
  await runSettings(() => rpc(ctx.api, "admin_save_shop_settings", { p_changes: changes }, ctx.token));
}

export async function saveShippingZone(form: FormData) {
  const ctx = await requireOwner();
  const zid = str(form, "zone_id", 20);
  const fields: Record<string, string | boolean> = {};
  for (const k of ["name", "fee_aed", "transit_days_min", "transit_days_max", "vat_treatment", "duties_treatment", "duties_note", "carrier_note"]) {
    if (form.has(k)) fields[k] = k === "fee_aed" ? amount(form, k) : str(form, k, 600);
  }
  fields.active = checked(form, "active");
  const countries = str(form, "countries", 1200).toUpperCase().split(/[\s,]+/).filter(Boolean);
  await runSettings(() => rpc(ctx.api, "admin_save_shipping_zone", { p_id: INT.test(zid) ? Number(zid) : null, p_fields: fields, p_countries: countries }, ctx.token));
}

export async function savePolicy(form: FormData) {
  const ctx = await requireOwner();
  const pid = str(form, "policy_id", 20);
  await runSettings(() => rpc(ctx.api, "admin_save_policy", {
    p_id: INT.test(pid) ? Number(pid) : null,
    p_fields: { kind: str(form, "kind", 20), version: str(form, "version", 40), title: str(form, "title", 160), body: str(form, "body", 40000) },
  }, ctx.token));
}

export async function setPolicyStatus(form: FormData) {
  const ctx = await requireOwner();
  await runSettings(() => rpc(ctx.api, "admin_set_policy_status", { p_id: intId(form, "policy_id"), p_status: str(form, "status", 10) }, ctx.token));
}
