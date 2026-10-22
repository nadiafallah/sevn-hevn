import Link from "next/link";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { select, storageSignedUrl } from "@/lib/concierge/db";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { EvidenceUpload } from "@/components/admin/EvidenceUpload";
import { QuoteFields } from "@/components/admin/QuoteForm";
import {
  channelLabels, collectionLabels, day, dutiesLabels, evidenceLabels, exceptionLabels, fulfilmentLabels, inspectionLabels, insuranceLabels,
  itemAvailabilityLabels, itemStageLabels, manualStages, money, orderStatusLabels, paymentLabels, paymentMethodLabels, paymentRowLabels,
  refundRouteLabels, refundStatusLabels, resolutionLabels, returnReasonLabels, returnStatusLabels, shipmentStatusLabels, sourcingStatusLabels,
  toDubaiLocal, vatTreatmentLabels, when,
} from "@/lib/admin/labels";
import { ORDER_EVIDENCE_BUCKET } from "@/lib/orders/server";
import {
  addSourcingTask, cancelOrder, confirmOrder, createCustomerLink, createRefund, createReturn, decideReturn, handOver, inspectReturn,
  markMessagesHandled, postUpdate, recordCheck, recordCollection, recordPayment, reopenQuote, resolvePaymentEvent, resolveReturn,
  restockReturn, returnStatus, revokeCustomerLink, saveQuote, saveShipment, sendQuote, setItemAvailability, setStage, settleRefund,
  shipmentStatus, updateOrderDetails, updateSourcing, verifyPayment,
} from "../../../order-actions";

export const metadata = { title: "Order" };

type Item = {
  id: number; description: string; brand: string | null; product_ref: string | null; sku: string | null; options: string | null; quantity: number;
  unit_amount: string | null; availability: string; stage: string; condition: string | null; condition_notes: string | null; included: string[];
};
type Order = {
  id: string; reference: string; status: string; channel: string; currency: string; subtotal_amount: string | null; discount_amount: string;
  shipping_amount: string | null; vat_amount: string | null; vat_rate_percent: string | null; prices_include_vat: boolean | null; vat_treatment: string;
  duties_treatment: string; duties_note: string | null; total_amount: string | null; amount_paid: string; amount_refunded: string; amount_source: string;
  amount_approved_by: string | null; amount_approved_at: string | null; payment_status: string; fulfilment_status: string; delivery_mode: string;
  shipping_country: string | null; shipping_address: string | null; shipping_destination: string | null; recipient_name: string | null;
  recipient_phone: string | null; sourcing_eta: string | null; transit_days_min: number | null; transit_days_max: number | null;
  delivery_estimate_from: string | null; delivery_estimate_to: string | null; delivery_estimate_note: string | null; quote_sent_at: string | null;
  quote_expires_at: string | null; accepted_at: string | null; cancellation_terms: string | null; contact_email: string | null;
  customer_note: string | null; cancel_reason: string | null; assigned_to: string | null; is_test: boolean; created_at: string; updated_at: string;
  confirmed_at: string | null; request_id: string | null; customer_id: string;
  customers: { name: string | null; phone_e164: string | null; email: string | null }; order_items: Item[];
};
type Payment = { id: string; reference: string; method: string; provider: string | null; amount: string; currency: string; status: string; succeeded_at: string | null; verification_note: string | null; failure_reason: string | null; created_at: string };
type Refund = { id: string; reference: string; payment_id: string; return_id: string | null; amount: string; currency: string; items_amount: string; shipping_amount: string; vat_amount: string; deduction_amount: string; deduction_reason: string | null; reason: string; route: string; exception_reason: string | null; status: string; failure_reason: string | null; approved_at: string; confirmed_at: string | null; confirmation_note: string | null };
type Task = { id: number; order_item_id: number; status: string; assigned_to: string | null; supplier: string | null; supplier_reference: string | null; confirm_by: string | null; expected_at: string | null; notes: string | null; failure_reason: string | null; updated_at: string };
type Check = { id: number; order_item_id: number; result: string; serial_reference: string | null; serial_matches: boolean | null; condition_confirmed: boolean; condition_notes: string | null; accessories: string[]; authenticity_notes: string | null; failure_reason: string | null; checked_by: string; checked_at: string };
type Shipment = {
  id: string; reference: string; direction: string; status: string; carrier: string | null; service: string | null; tracking_number: string | null; tracking_url: string | null;
  declared_value: string | null; declared_currency: string | null; insurance: string; insurance_reference: string | null; coverage_confirmed: boolean; coverage_note: string | null;
  delivery_requirements: string | null; packed_contents: string | null; handed_over_at: string | null; handover_evidence: string | null; delivered_at: string | null;
  delivery_evidence: string | null; delivery_note: string | null; exception_kind: string | null; exception_note: string | null; shipment_items: { order_item_id: number; quantity: number }[];
};
type Return = {
  id: string; reference: string; status: string; reason: string; description: string | null; requested_by: string; eligibility: Record<string, unknown>; decision_reason: string | null;
  support_path: string | null; collection_method: string | null; return_cost: string | null; return_cost_paid_by: string | null; return_shipment_id: string | null; received_at: string | null;
  inspection_result: string | null; identity_matches: boolean | null; inspection_notes: string | null; resolution: string | null; resolution_note: string | null; restocked_at: string | null;
  created_at: string; return_items: { order_item_id: number; quantity: number }[];
};
type Evidence = { id: number; order_item_id: number | null; shipment_id: string | null; return_id: string | null; kind: string; storage_path: string; note: string | null; from_customer: boolean; created_at: string };
type Message = { id: number; kind: string; from_customer: boolean; body: string; author_id: string | null; handled_at: string | null; created_at: string };
type Link = { id: string; expires_at: string; revoked_at: string | null; last_used_at: string | null; created_at: string };
type Event = { id: number; kind: string; from_value: string | null; to_value: string | null; reason: string | null; public_note: string | null; customer_visible: boolean; actor: string; actor_id: string | null; meta: Record<string, unknown>; created_at: string };
type PayEvent = { id: number; type: string; outcome: string; detail: string | null; received_at: string; resolved_at: string | null; resolution_note: string | null };

const dateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : "");

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { api, token, isOwner } = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const q = (extra: Record<string, string> = {}) => ({ order_id: `eq.${id}`, ...extra });
  const [rows, payments, refunds, payEvents, tasks, shipments, returns, evidence, messages, links, events, team, settings, audit] = await Promise.all([
    select<Order[]>(api, "orders", { id: `eq.${id}`, select: "*,customers(name,phone_e164,email),order_items(*)", "order_items.order": "position.asc,id.asc" }, token),
    select<Payment[]>(api, "payments", q({ order: "created_at.asc" }), token),
    select<Refund[]>(api, "refunds", q({ order: "created_at.asc" }), token),
    select<PayEvent[]>(api, "payment_events", q({ outcome: "eq.discrepancy", order: "received_at.desc" }), token),
    select<Task[]>(api, "sourcing_tasks", q({ order: "created_at.asc" }), token),
    select<Shipment[]>(api, "shipments", q({ select: "*,shipment_items(order_item_id,quantity)", order: "created_at.asc" }), token),
    select<Return[]>(api, "returns", q({ select: "*,return_items(order_item_id,quantity)", order: "created_at.asc" }), token),
    select<Evidence[]>(api, "order_evidence", q({ order: "created_at.asc", limit: "120" }), token),
    select<Message[]>(api, "order_messages", q({ order: "id.asc" }), token),
    select<Link[]>(api, "order_access_links", q({ select: "id,expires_at,revoked_at,last_used_at,created_at", order: "created_at.desc" }), token),
    select<Event[]>(api, "order_events", q({ order: "id.desc", limit: "200" }), token),
    select<{ id: string; display_name: string | null; role: string; active: boolean }[]>(api, "staff_members", { select: "id,display_name,role,active" }, token),
    select<{ vat_rate_percent: string | null }[]>(api, "shop_settings", { select: "vat_rate_percent" }, token),
    isOwner ? select<{ id: number; actor_label: string; action: string; created_at: string }[]>(api, "audit_log", { entity: "eq.order", entity_id: `eq.${id}`, order: "id.desc", limit: "40" }, token) : Promise.resolve([]),
  ]);
  const o = rows[0];
  if (!o) notFound();
  const itemIds = o.order_items.map((i) => i.id);
  const checks = itemIds.length
    ? await select<Check[]>(api, "order_item_checks", { order_item_id: `in.(${itemIds.join(",")})`, order: "checked_at.desc" }, token)
    : [];
  const urls = Object.fromEntries(
    await Promise.all(evidence.map(async (e) => [e.id, await storageSignedUrl(api, ORDER_EVIDENCE_BUCKET, e.storage_path, token, 600).catch(() => null)] as const)),
  );
  const newLink = (await cookies()).get("sevn-new-order-link")?.value;

  const names = Object.fromEntries(team.map((s) => [s.id, s.display_name ?? "Team member"]));
  const itemName = (iid: number) => o.order_items.find((i) => i.id === iid)?.description ?? `Line ${iid}`;
  const m = (v: string | number | null | undefined) => money(v, o.currency);
  const open = o.status !== "completed" && o.status !== "cancelled";
  const draft = o.status === "draft";
  const waiting = o.status === "awaiting_confirmation";
  const active = o.status === "confirmed" || o.status === "processing";
  const captured = payments.filter((p) => p.status === "succeeded");
  const balance = Math.max(0, Number(o.total_amount ?? 0) - Number(o.amount_paid));
  const refundable = Number(o.amount_paid) - Number(o.amount_refunded);
  const delivered = o.order_items.filter((i) => i.stage === "delivered" || i.stage === "collected");
  const files = (pred: (e: Evidence) => boolean) => evidence.filter(pred);

  return (
    <>
      <p className="adm-crumbs"><Link href="/admin/orders">← Orders</Link></p>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="adm-h1">{o.reference} {o.is_test && <span className="adm-badge adm-badge--test">Test</span>}</h1>
      <p className="adm-muted">
        <Link href={`/admin/customers/${o.customer_id}`}>{o.customers?.name || "Customer"}</Link>
        {o.request_id && <> · from <Link href={`/admin/requests/${o.request_id}`}>the request</Link></>} · {channelLabels[o.channel]} · created {when(o.created_at)} · updated {when(o.updated_at)}
      </p>
      <dl className="adm-stats">
        <div className="adm-stat"><dt className="adm-stat__l">Order</dt><dd className="adm-stat__n">{orderStatusLabels[o.status]}</dd></div>
        <div className="adm-stat"><dt className="adm-stat__l">Payment</dt><dd className="adm-stat__n">{paymentLabels[o.payment_status]}</dd></div>
        <div className="adm-stat"><dt className="adm-stat__l">Delivery</dt><dd className="adm-stat__n">{fulfilmentLabels[o.fulfilment_status]}</dd></div>
        {returns.some((r) => r.status !== "resolved" && r.status !== "rejected") && (
          <div className="adm-stat"><dt className="adm-stat__l">Return</dt><dd className="adm-stat__n">{returnStatusLabels[returns.find((r) => r.status !== "resolved" && r.status !== "rejected")!.status]}</dd></div>
        )}
      </dl>
      <NextStep o={o} isOwner={isOwner} balance={balance} refundable={refundable} />

      <div className="adm-grid">
        <div className="adm-col">
          <section className="adm-card">
            <h2>Amounts</h2>
            <dl className="adm-dl">
              <dt>Pieces</dt><dd>{m(o.subtotal_amount)}</dd>
              {Number(o.discount_amount) > 0 && <><dt>Discount</dt><dd>− {m(o.discount_amount)}</dd></>}
              <dt>{o.delivery_mode === "collect" ? "Collection" : "Shipping"}</dt><dd>{o.delivery_mode === "collect" ? "Collect in Dubai" : o.shipping_amount === null ? "Not quoted yet" : m(o.shipping_amount)}</dd>
              <dt>VAT</dt><dd>{vatTreatmentLabels[o.vat_treatment]}{o.vat_amount !== null && o.vat_treatment === "standard" ? ` · ${m(o.vat_amount)} (${o.vat_rate_percent}%${o.prices_include_vat ? ", included" : ", added"})` : ""}</dd>
              <dt>Import duties</dt><dd>{dutiesLabels[o.duties_treatment]}{o.duties_note ? ` · ${o.duties_note}` : ""}</dd>
              <dt>Total</dt><dd><strong>{m(o.total_amount)}</strong>{o.amount_approved_at && <span className="adm-muted adm-small"> · {o.amount_source === "catalogue" ? "catalogue prices" : `approved by ${names[o.amount_approved_by ?? ""] ?? "the owner"}`} · {when(o.amount_approved_at)}</span>}</dd>
              <dt>Paid</dt><dd>{m(o.amount_paid)}{balance > 0 && o.status !== "draft" ? ` · ${m(balance)} still to pay` : ""}</dd>
              {Number(o.amount_refunded) > 0 && <><dt>Refunded</dt><dd>{m(o.amount_refunded)}</dd></>}
            </dl>
          </section>

          <section className="adm-card">
            <h2>Pieces</h2>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th scope="col">Piece</th><th scope="col">Qty</th><th scope="col">Price</th><th scope="col">Availability</th><th scope="col">Stage</th></tr></thead>
                <tbody>
                  {o.order_items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.description}{i.brand ? ` · ${i.brand}` : ""}{i.options ? ` · ${i.options}` : ""}<br /><span className="adm-muted adm-small">{[i.product_ref, i.sku].filter(Boolean).join(" / ")}{i.condition ? ` · ${i.condition}` : ""}{i.included.length ? ` · with ${i.included.join(", ")}` : ""}</span></td>
                      <td>{i.quantity}</td>
                      <td>{m(i.unit_amount)}</td>
                      <td>{itemAvailabilityLabels[i.availability]}</td>
                      <td>{itemStageLabels[i.stage]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isOwner && (draft || waiting) && (
              <details>
                <summary>Change a line between in stock and on request</summary>
                <form action={setItemAvailability} className="adm-form">
                  <input type="hidden" name="id" value={o.id} />
                  <label>Line<select name="item_id">{o.order_items.map((i) => <option key={i.id} value={i.id}>{i.description}</option>)}</select></label>
                  <label>Availability<select name="availability"><option value="on_request">On request (source it)</option><option value="in_stock">In stock</option></select></label>
                  <label>Reason<input name="reason" required maxLength={600} /></label>
                  <button type="submit" className="adm-btn">Change</button>
                </form>
              </details>
            )}
          </section>

          {draft && isOwner && (
            <section className="adm-card" id="quote">
              <h2>Quote (draft)</h2>
              <form action={saveQuote} className="adm-form">
                <input type="hidden" name="id" value={o.id} />
                <QuoteFields lines={o.order_items} q={{ ...o, sourcing_eta: dateInput(o.sourcing_eta), delivery_estimate_from: dateInput(o.delivery_estimate_from), delivery_estimate_to: dateInput(o.delivery_estimate_to) }} vatRate={settings[0]?.vat_rate_percent ?? null} />
                <button type="submit" className="adm-btn adm-btn--dark">Save the quote</button>
              </form>
              <form action={sendQuote} className="adm-form adm-form--inline">
                <input type="hidden" name="id" value={o.id} />
                <label>Valid for (hours)<input name="valid_hours" type="number" min={1} max={720} placeholder="from Settings" /></label>
                <button type="submit" className="adm-btn adm-btn--dark">Send the quote</button>
              </form>
              <p className="adm-muted adm-small">Sending fixes the amounts and holds in-stock catalogue pieces until it expires. Then create a customer link (below) and send it to the customer.</p>
            </section>
          )}

          {waiting && (
            <section className="adm-card">
              <h2>Waiting for the customer</h2>
              <dl className="adm-dl">
                <dt>Quote sent</dt><dd>{when(o.quote_sent_at)}</dd>
                <dt>Expires</dt><dd>{when(o.quote_expires_at)}{o.quote_expires_at && new Date(o.quote_expires_at) < new Date() ? " · expired" : ""}</dd>
                <dt>Accepted</dt><dd>{o.accepted_at ? when(o.accepted_at) : "Not yet"}</dd>
              </dl>
              {isOwner && (
                <>
                  <form action={confirmOrder} className="adm-form">
                    <input type="hidden" name="id" value={o.id} />
                    <label>Reason, if you confirm before the full payment is recorded<input name="reason" maxLength={600} /></label>
                    <button type="submit" className="adm-btn adm-btn--dark">Confirm the order</button>
                  </form>
                  {Number(o.amount_paid) === 0 && (
                    <form action={reopenQuote} className="adm-form adm-form--inline">
                      <input type="hidden" name="id" value={o.id} />
                      <label>Reason<input name="reason" maxLength={600} placeholder="e.g. price changed" /></label>
                      <button type="submit" className="adm-btn">Back to draft</button>
                    </form>
                  )}
                </>
              )}
            </section>
          )}

          <section className="adm-card" id="payments">
            <h2>Payments</h2>
            {payments.length === 0 ? <p className="adm-muted adm-small">None yet.</p> : (
              <ul className="adm-notes">
                {payments.map((p) => (
                  <li key={p.id}>
                    <span className="adm-ref">{p.reference}</span> · {paymentMethodLabels[p.method]} · {money(p.amount, p.currency)} · <strong>{paymentRowLabels[p.status]}</strong>
                    {p.succeeded_at ? ` · ${when(p.succeeded_at)}` : ` · ${when(p.created_at)}`}{p.verification_note ? ` · ${p.verification_note}` : ""}{p.failure_reason ? ` · ${p.failure_reason}` : ""}
                    {isOwner && p.status === "pending" && p.method !== "hosted_checkout" && (
                      <form action={verifyPayment} className="adm-form adm-form--inline">
                        <input type="hidden" name="order_id" value={o.id} />
                        <input type="hidden" name="payment_id" value={p.id} />
                        <label>What you checked<input name="note" required maxLength={600} placeholder="Seen in the bank account on …, ref …" /></label>
                        <button type="submit" name="decision" value="accept" className="adm-btn adm-btn--dark">Funds received</button>
                        <button type="submit" name="decision" value="reject" className="adm-btn">Not received</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {payEvents.length > 0 && (
              <>
                <h3>Provider events to check</h3>
                <ul className="adm-notes adm-small">
                  {payEvents.map((e) => (
                    <li key={e.id}>
                      {when(e.received_at)} · {e.type} · {e.detail}
                      {e.resolved_at ? ` · resolved: ${e.resolution_note}` : isOwner && (
                        <form action={resolvePaymentEvent} className="adm-form adm-form--inline">
                          <input type="hidden" name="order_id" value={o.id} />
                          <input type="hidden" name="event_id" value={e.id} />
                          <label>What you found<input name="note" required maxLength={600} /></label>
                          <button type="submit" className="adm-btn">Mark resolved</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {(waiting || active) && balance > 0 && (
              <details>
                <summary>{isOwner ? "Record a bank transfer or cash payment" : "Note a payment the customer reports"}</summary>
                <form action={recordPayment} className="adm-form">
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="idempotency_key" value={randomUUID()} />
                  <div className="adm-row">
                    <label>Method<select name="method">{["bank_transfer", "cash", "card_terminal", "other"].map((k) => <option key={k} value={k}>{paymentMethodLabels[k]}</option>)}</select></label>
                    <label>Amount ({o.currency})<input name="amount" required inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" defaultValue={balance || ""} /></label>
                  </div>
                  <label>{isOwner ? "What you checked (required to count it)" : "Note (e.g. receipt sent on WhatsApp)"}<input name="note" maxLength={600} /></label>
                  {isOwner && <label className="adm-check"><input type="checkbox" name="verified" /> I have seen these funds in the account (a receipt alone is not enough)</label>}
                  <button type="submit" className="adm-btn adm-btn--dark">Record</button>
                </form>
              </details>
            )}
          </section>

          <section className="adm-card" id="refunds">
            <h2>Refunds</h2>
            {refunds.length === 0 ? <p className="adm-muted adm-small">None.</p> : (
              <ul className="adm-notes">
                {refunds.map((r) => (
                  <li key={r.id}>
                    <span className="adm-ref">{r.reference}</span> · {money(r.amount, r.currency)} · <strong>{refundStatusLabels[r.status]}</strong> · {refundRouteLabels[r.route]} · {r.reason}
                    <br /><span className="adm-muted adm-small">pieces {money(r.items_amount, r.currency)} · shipping {money(r.shipping_amount, r.currency)} · VAT {money(r.vat_amount, r.currency)}{Number(r.deduction_amount) > 0 ? ` · minus ${money(r.deduction_amount, r.currency)} (${r.deduction_reason})` : ""}{r.exception_reason ? ` · exception: ${r.exception_reason}` : ""}{r.failure_reason ? ` · failed: ${r.failure_reason}` : ""}{r.confirmation_note ? ` · ${r.confirmation_note}` : ""}</span>
                    {isOwner && ["approved", "pending"].includes(r.status) && (r.route !== "original_payment" || payments.find((p) => p.id === r.payment_id)?.method !== "hosted_checkout") && (
                      <form action={settleRefund} className="adm-form adm-form--inline">
                        <input type="hidden" name="order_id" value={o.id} />
                        <input type="hidden" name="refund_id" value={r.id} />
                        <label>Confirmation (bank reference, …)<input name="note" required maxLength={600} /></label>
                        <button type="submit" name="outcome" value="succeeded" className="adm-btn adm-btn--dark">Confirmed refunded</button>
                        <button type="submit" name="outcome" value="failed" className="adm-btn">Failed</button>
                        {r.status === "approved" && <button type="submit" name="outcome" value="cancelled" className="adm-btn">Cancel</button>}
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isOwner && captured.length > 0 && refundable > 0 && (
              <details>
                <summary>Approve a refund</summary>
                <form action={createRefund} className="adm-form">
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="idempotency_key" value={randomUUID()} />
                  <label>Against payment<select name="payment_id">{captured.map((p) => <option key={p.id} value={p.id}>{p.reference} · {paymentMethodLabels[p.method]} · {money(p.amount, p.currency)}</option>)}</select></label>
                  {returns.length > 0 && <label>For return<select name="return_id"><option value="">—</option>{returns.map((r) => <option key={r.id} value={r.id}>{r.reference}</option>)}</select></label>}
                  <div className="adm-row">
                    <label>Pieces<input name="items_amount" inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" /></label>
                    <label>Original shipping<input name="shipping_amount" inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" /></label>
                    <label>VAT<input name="vat_amount" inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" /></label>
                  </div>
                  <div className="adm-row">
                    <label>Deduction (agreed and lawful only)<input name="deduction_amount" inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" /></label>
                    <label>Reason for the deduction<input name="deduction_reason" maxLength={600} /></label>
                  </div>
                  <label>Reason for the refund<input name="reason" required maxLength={600} /></label>
                  <label>Route<select name="route">{Object.entries(refundRouteLabels).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                  <label>If not the original payment: why (documented exception)<input name="exception_reason" maxLength={600} /></label>
                  <p className="adm-muted adm-small">Up to {m(refundable)} is left to refund. An online payment is refunded through the provider and stays “sent” until the provider confirms it.</p>
                  <button type="submit" className="adm-btn adm-btn--dark">Approve the refund</button>
                </form>
              </details>
            )}
          </section>

          {tasks.length > 0 && (
            <section className="adm-card" id="sourcing">
              <h2>Sourcing</h2>
              {tasks.map((t) => (
                <div key={t.id} className="adm-card">
                  <p><strong>{itemName(t.order_item_id)}</strong> · {sourcingStatusLabels[t.status]}{t.confirm_by && ["open", "supplier_contacted"].includes(t.status) ? ` · supplier to confirm by ${when(t.confirm_by)}${new Date(t.confirm_by) < new Date() ? " (overdue)" : ""}` : ""}{t.expected_at ? ` · expected ${day(t.expected_at)}` : ""}</p>
                  {t.failure_reason && <p className="adm-danger">{t.failure_reason}</p>}
                  {!["received", "cancelled", "failed"].includes(t.status) && (
                    <form action={updateSourcing} className="adm-form">
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="task_id" value={t.id} />
                      <div className="adm-row">
                        <label>Status<select name="status" defaultValue={t.status}>{Object.entries(sourcingStatusLabels).filter(([k]) => k !== "cancelled").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                        <label>Assigned to<select name="assigned_to" defaultValue={t.assigned_to ?? ""}><option value="">—</option>{team.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.display_name ?? "Team member"}</option>)}</select></label>
                      </div>
                      <div className="adm-row">
                        <label>Supplier (internal)<input name="supplier" defaultValue={t.supplier ?? ""} maxLength={160} /></label>
                        <label>Supplier reference<input name="supplier_reference" defaultValue={t.supplier_reference ?? ""} maxLength={120} /></label>
                      </div>
                      <div className="adm-row">
                        <label>Supplier to confirm by<input name="confirm_by" type="datetime-local" defaultValue={toDubaiLocal(t.confirm_by)} /></label>
                        <label>Expected in hand<input name="expected_at" type="date" defaultValue={dateInput(t.expected_at)} /></label>
                      </div>
                      <label>Notes (internal)<textarea name="notes" rows={2} defaultValue={t.notes ?? ""} maxLength={2000} /></label>
                      <label>If the supplier can’t deliver: why<input name="failure_reason" defaultValue={t.failure_reason ?? ""} maxLength={600} /></label>
                      <button type="submit" className="adm-btn adm-btn--dark">Save</button>
                    </form>
                  )}
                  {t.status === "failed" && !tasks.some((x) => x.order_item_id === t.order_item_id && !["failed", "cancelled"].includes(x.status)) && o.order_items.find((i) => i.id === t.order_item_id)?.stage === "sourcing" && (
                    <form action={addSourcingTask} className="adm-inline">
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="item_id" value={t.order_item_id} />
                      <button type="submit" className="adm-btn">Try another supplier</button>
                    </form>
                  )}
                </div>
              ))}
            </section>
          )}

          {(active || o.status === "completed") && (
            <section className="adm-card" id="checks">
              <h2>Quality checks</h2>
              <p className="adm-muted adm-small">A person checks every piece before packing: serial or reference against the documents, condition, accessories and authenticity evidence. Passing needs at least one photo of the piece.</p>
              {o.order_items.filter((i) => i.stage !== "cancelled").map((i) => {
                const last = checks.find((c) => c.order_item_id === i.id);
                return (
                  <div key={i.id} className="adm-card">
                    <p><strong>{i.description}</strong> · {itemStageLabels[i.stage]}{last ? ` · last check ${last.result} by ${names[last.checked_by] ?? "team"} ${when(last.checked_at)}` : ""}</p>
                    {last && <p className="adm-muted adm-small">{[last.serial_reference && `serial ${last.serial_reference}${last.serial_matches === true ? " (matches)" : last.serial_matches === false ? " (doesn’t match)" : ""}`, last.accessories.length && `with ${last.accessories.join(", ")}`, last.condition_notes, last.authenticity_notes, last.failure_reason].filter(Boolean).join(" · ")}</p>}
                    <Files urls={urls} list={files((e) => e.order_item_id === i.id)} />
                    {["in_hand", "qc_failed", "qc_passed"].includes(i.stage) && (
                      <>
                        <div className="adm-actions">
                          <EvidenceUpload orderId={o.id} itemId={i.id} kind="product" label="Add photos of the piece" />
                          <EvidenceUpload orderId={o.id} itemId={i.id} kind="serial" label="Add serial / reference photos" />
                          <EvidenceUpload orderId={o.id} itemId={i.id} kind="document" label="Add documents" />
                        </div>
                        <details>
                          <summary>Record a check</summary>
                          <form action={recordCheck} className="adm-form">
                            <input type="hidden" name="order_id" value={o.id} />
                            <input type="hidden" name="item_id" value={i.id} />
                            <div className="adm-row">
                              <label>Serial / reference<input name="serial_reference" maxLength={120} /></label>
                              <label>Matches the documents and the piece offered<select name="serial_matches" defaultValue=""><option value="">No serial on this piece</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                            </div>
                            <label className="adm-check"><input type="checkbox" name="condition_confirmed" /> Condition is as described to the customer</label>
                            <label>Condition notes<input name="condition_notes" maxLength={1000} /></label>
                            <label>Accessories in hand (comma-separated)<input name="accessories" maxLength={600} defaultValue={i.included.join(", ")} /></label>
                            <label>Authenticity evidence checked<textarea name="authenticity_notes" rows={2} maxLength={2000} /></label>
                            <label>If it fails: why<input name="failure_reason" maxLength={600} /></label>
                            <div className="adm-actions">
                              <button type="submit" name="result" value="passed" className="adm-btn adm-btn--dark">Passed</button>
                              <button type="submit" name="result" value="failed" className="adm-btn">Failed</button>
                            </div>
                          </form>
                        </details>
                      </>
                    )}
                  </div>
                );
              })}
              {active && (
                <form action={setStage} className="adm-form adm-form--inline" id="stage">
                  <input type="hidden" name="id" value={o.id} />
                  <label>Stage<select name="stage" defaultValue={manualStages.includes(o.fulfilment_status) ? o.fulfilment_status : "quality_check"}>{manualStages.map((k) => <option key={k} value={k}>{fulfilmentLabels[k]}</option>)}</select></label>
                  <label>Note<input name="reason" maxLength={600} /></label>
                  <button type="submit" className="adm-btn">Set stage</button>
                </form>
              )}
            </section>
          )}

          {(active || o.status === "completed" || shipments.length > 0) && (
            <section className="adm-card" id="shipments">
              <h2>{o.delivery_mode === "collect" ? "Collection and shipments" : "Shipments"}</h2>
              {shipments.map((s) => (
                <div key={s.id} className="adm-card">
                  <p>
                    <strong>{s.reference}</strong> · {s.direction === "return" ? "Return to us" : "To the customer"} · <strong>{shipmentStatusLabels[s.status]}</strong>
                    {s.carrier ? ` · ${s.carrier}${s.service ? ` ${s.service}` : ""}` : ""}{s.tracking_number ? ` · ${s.tracking_number}` : ""}
                    {s.tracking_url && <> · <a href={s.tracking_url} target="_blank" rel="noopener noreferrer">tracking</a></>}
                  </p>
                  <p className="adm-muted adm-small">
                    {s.shipment_items.map((x) => itemName(x.order_item_id)).join(", ") || "No pieces chosen"}
                    {s.declared_value ? ` · declared ${money(s.declared_value, s.declared_currency ?? o.currency)}` : ""} · insurance: {insuranceLabels[s.insurance]}{s.coverage_confirmed ? " · cover confirmed by the carrier" : " · cover not confirmed"}
                    {s.handed_over_at ? ` · handed over ${when(s.handed_over_at)} (${s.handover_evidence === "carrier_scan" ? "carrier scan" : "signed handover"})` : ""}
                    {s.delivered_at ? ` · delivered ${when(s.delivered_at)} (${s.delivery_evidence === "carrier_proof" ? "carrier proof" : "owner exception"}: ${s.delivery_note})` : ""}
                    {s.exception_kind ? ` · ${exceptionLabels[s.exception_kind]}${s.exception_note ? `: ${s.exception_note}` : ""}` : ""}
                  </p>
                  <Files urls={urls} list={files((e) => e.shipment_id === s.id)} />
                  {["preparing", "label_created"].includes(s.status) && (
                    <>
                      <EvidenceUpload orderId={o.id} shipmentId={s.id} kind="packing" label="Add packing photos" />
                      <details>
                        <summary>Edit the shipment</summary>
                        <ShipmentForm o={o} s={s} />
                      </details>
                      <form action={handOver} className="adm-form">
                        <input type="hidden" name="order_id" value={o.id} />
                        <input type="hidden" name="shipment_id" value={s.id} />
                        <div className="adm-row">
                          <label>Proof<select name="evidence"><option value="carrier_scan">Carrier scan (tracking shows it collected)</option><option value="signed_handover">Signed handover to the courier</option></select></label>
                          <label>When<input name="at" type="datetime-local" /></label>
                        </div>
                        {!s.coverage_confirmed && isOwner && <label>Reason for sending without confirmed cover (owner)<input name="note" maxLength={600} /></label>}
                        <button type="submit" className="adm-btn adm-btn--dark">Handed to the carrier</button>
                      </form>
                    </>
                  )}
                  {!["preparing", "label_created", "delivered", "lost", "cancelled"].includes(s.status) && (
                    <details>
                      <summary>Carrier update</summary>
                      <form action={shipmentStatus} className="adm-form">
                        <input type="hidden" name="order_id" value={o.id} />
                        <input type="hidden" name="shipment_id" value={s.id} />
                        <div className="adm-row">
                          <label>Status<select name="status">{["in_transit", "out_for_delivery", "delivered", "exception", "returned_to_sender", ...(isOwner ? ["lost"] : [])].map((k) => <option key={k} value={k}>{shipmentStatusLabels[k]}</option>)}</select></label>
                          <label>When<input name="at" type="datetime-local" /></label>
                        </div>
                        <div className="adm-row">
                          <label>Delivered: proof<select name="delivery_evidence"><option value="carrier_proof">Carrier proof of delivery</option>{isOwner && <option value="owner_exception">Owner exception (documented)</option>}</select></label>
                          <label>Problem<select name="exception_kind"><option value="">—</option>{Object.entries(exceptionLabels).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                        </div>
                        <label>Note (proof reference, what happened; internal)<input name="note" maxLength={600} /></label>
                        <label>Message for the customer’s page (optional)<input name="public_note" maxLength={600} /></label>
                        <button type="submit" className="adm-btn adm-btn--dark">Save</button>
                      </form>
                    </details>
                  )}
                </div>
              ))}
              {active && o.delivery_mode === "deliver" && (
                <details>
                  <summary>New shipment</summary>
                  <ShipmentForm o={o} />
                </details>
              )}
              {returns.some((r) => r.status === "approved" || r.status === "awaiting_collection") && (
                <details>
                  <summary>New return shipment (customer → us)</summary>
                  <ShipmentForm o={o} direction="return" />
                </details>
              )}
              {active && o.delivery_mode === "collect" && (
                <form action={recordCollection} className="adm-form">
                  <input type="hidden" name="id" value={o.id} />
                  <label>What was checked at collection (ID, signature)<input name="note" required maxLength={600} /></label>
                  <button type="submit" className="adm-btn adm-btn--dark">The customer collected the pieces</button>
                </form>
              )}
            </section>
          )}

          {(returns.length > 0 || delivered.length > 0) && (
            <section className="adm-card" id="returns">
              <h2>Returns</h2>
              {returns.map((r) => (
                <div key={r.id} className="adm-card">
                  <p><strong>{r.reference}</strong> · {returnReasonLabels[r.reason]} · <strong>{returnStatusLabels[r.status]}</strong> · requested by the {r.requested_by} {when(r.created_at)}</p>
                  <p className="adm-muted adm-small">{r.return_items.map((x) => itemName(x.order_item_id)).join(", ")}{r.description ? ` · “${r.description}”` : ""}</p>
                  <p className="adm-muted adm-small">
                    Policy check (advice, not a decision): {r.eligibility.days_since_delivery !== undefined && r.eligibility.days_since_delivery !== null ? `${r.eligibility.days_since_delivery} days since delivery` : "delivery date unknown"}
                    {r.reason === "change_of_mind" ? ` · change-of-mind window ${r.eligibility.change_of_mind_days ?? "not set"} days${r.eligibility.change_of_mind_in_window === true ? " · within it" : r.eligibility.change_of_mind_in_window === false ? " · outside it" : ""}${r.eligibility.items_on_request ? " · includes a sourced piece" : ""}` : ""} · {String(r.eligibility.note ?? "")}
                  </p>
                  {r.decision_reason && <p className="adm-small">Decision: {r.decision_reason}{r.support_path ? ` · Escalation: ${r.support_path}` : ""}</p>}
                  {r.inspection_result && <p className="adm-small">Inspection: {inspectionLabels[r.inspection_result]} · same piece: {r.identity_matches ? "yes" : "no"}{r.inspection_notes ? ` · ${r.inspection_notes}` : ""}{r.restocked_at ? ` · restocked ${when(r.restocked_at)}` : ""}</p>}
                  {r.resolution && <p className="adm-small">Resolution: {resolutionLabels[r.resolution]}{r.resolution_note ? ` · ${r.resolution_note}` : ""}</p>}
                  <Files urls={urls} list={files((e) => e.return_id === r.id)} />
                  {["requested", "under_review", "rejected"].includes(r.status) && (
                    <>
                      {r.status === "requested" && (
                        <form action={returnStatus} className="adm-inline">
                          <input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="return_id" value={r.id} /><input type="hidden" name="status" value="under_review" />
                          <button type="submit" className="adm-btn">Mark under review</button>
                        </form>
                      )}
                      {r.status === "rejected" && (
                        <form action={returnStatus} className="adm-form adm-form--inline">
                          <input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="return_id" value={r.id} /><input type="hidden" name="status" value="under_review" />
                          <label>Why it is reviewed again<input name="note" required maxLength={600} /></label>
                          <button type="submit" className="adm-btn">Review again</button>
                        </form>
                      )}
                      {isOwner && r.status !== "rejected" && (
                        <details>
                          <summary>Decide (owner)</summary>
                          <form action={decideReturn} className="adm-form">
                            <input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="return_id" value={r.id} />
                            <p className="adm-muted adm-small">Check the approved returns policy and the customer’s legal rights before deciding. A rejection needs the reason and how to ask for a review; both are shown to the customer.</p>
                            <div className="adm-row">
                              <label>Collection<select name="collection_method"><option value="">—</option>{Object.entries(collectionLabels).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                              <label>Return cost<input name="return_cost" inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" /></label>
                              <label>Paid by<select name="return_cost_paid_by"><option value="">—</option><option value="shop">SEVN HEVN</option><option value="customer">The customer</option></select></label>
                            </div>
                            <label>Reason (required to reject)<input name="decision_reason" maxLength={1000} /></label>
                            <label>How to ask for a review (required to reject)<input name="support_path" maxLength={600} defaultValue="Reply on your order page or write to info@sevnhevn.ae and the owner will review it." /></label>
                            <div className="adm-actions">
                              <button type="submit" name="decision" value="approve" className="adm-btn adm-btn--dark">Approve</button>
                              <button type="submit" name="decision" value="reject" className="adm-btn adm-btn--danger">Reject</button>
                            </div>
                          </form>
                        </details>
                      )}
                    </>
                  )}
                  {["approved", "awaiting_collection", "in_transit"].includes(r.status) && (
                    <form action={returnStatus} className="adm-form adm-form--inline">
                      <input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="return_id" value={r.id} />
                      <label>Step<select name="status">{(r.status === "approved" ? ["awaiting_collection", "in_transit", "received"] : r.status === "awaiting_collection" ? ["in_transit", "received"] : ["received"]).map((k) => <option key={k} value={k}>{returnStatusLabels[k]}</option>)}</select></label>
                      <label>Return shipment<select name="return_shipment_id"><option value="">—</option>{shipments.filter((s) => s.direction === "return").map((s) => <option key={s.id} value={s.id}>{s.reference}</option>)}</select></label>
                      <button type="submit" className="adm-btn">Save</button>
                    </form>
                  )}
                  {r.status === "received" && (
                    <>
                      <EvidenceUpload orderId={o.id} returnId={r.id} kind="inspection" label="Add inspection photos" />
                      <form action={inspectReturn} className="adm-form">
                        <input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="return_id" value={r.id} />
                        <div className="adm-row">
                          <label>Result<select name="inspection_result">{Object.entries(inspectionLabels).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                          <label>Same piece (serial / reference matches)<select name="identity_matches"><option value="yes">Yes</option><option value="no">No</option></select></label>
                        </div>
                        <label>Notes<textarea name="inspection_notes" rows={2} maxLength={2000} /></label>
                        <button type="submit" className="adm-btn adm-btn--dark">Record the inspection</button>
                      </form>
                    </>
                  )}
                  {["inspected", "resolved"].includes(r.status) && r.inspection_result === "as_described" && r.identity_matches && !r.restocked_at && (
                    <form action={restockReturn} className="adm-inline">
                      <input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="return_id" value={r.id} />
                      <button type="submit" className="adm-btn">Put back into stock</button>
                    </form>
                  )}
                  {isOwner && r.status === "inspected" && (
                    <form action={resolveReturn} className="adm-form">
                      <input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="return_id" value={r.id} />
                      <div className="adm-row">
                        <label>Outcome<select name="resolution">{Object.entries(resolutionLabels).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                        <label>Note (required unless refunded)<input name="resolution_note" maxLength={1000} /></label>
                      </div>
                      <p className="adm-muted adm-small">A refund outcome needs the refund confirmed first (Refunds above).</p>
                      <button type="submit" className="adm-btn adm-btn--dark">Close the return</button>
                    </form>
                  )}
                </div>
              ))}
              {delivered.length > 0 && (
                <details>
                  <summary>Open a return for the customer</summary>
                  <form action={createReturn} className="adm-form">
                    <input type="hidden" name="id" value={o.id} />
                    {delivered.map((i) => <label key={i.id} className="adm-check"><input type="checkbox" name="item" value={i.id} /> {i.description}</label>)}
                    <label>Reason<select name="reason">{Object.entries(returnReasonLabels).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                    <label>What the customer said<textarea name="description" rows={2} maxLength={2000} /></label>
                    <button type="submit" className="adm-btn">Open the return</button>
                  </form>
                </details>
              )}
            </section>
          )}
        </div>

        <div className="adm-col">
          <section className="adm-card" id="customer">
            <h2>Customer</h2>
            <dl className="adm-dl">
              <dt>Name</dt><dd>{o.customers?.name ?? "—"}</dd>
              <dt>Phone</dt><dd className="adm-ltr">{o.customers?.phone_e164 ?? "—"}</dd>
              <dt>Order e-mail</dt><dd>{o.contact_email ?? "— (no order e-mails or chat order checks)"}</dd>
            </dl>
            <h3>Private link</h3>
            {newLink && (
              <div className="adm-flash" role="status">
                <p>New link (shown once; copy it now and send it to the customer):</p>
                <p className="adm-code adm-ltr">{newLink}</p>
              </div>
            )}
            <ul className="adm-notes adm-small">
              {links.map((l) => (
                <li key={l.id}>
                  made {when(l.created_at)} · {l.revoked_at ? `revoked ${when(l.revoked_at)}` : new Date(l.expires_at) < new Date() ? "expired" : `valid until ${day(l.expires_at)}`}{l.last_used_at ? ` · last opened ${when(l.last_used_at)}` : " · not opened yet"}
                  {!l.revoked_at && new Date(l.expires_at) > new Date() && (
                    <form action={revokeCustomerLink} className="adm-inline">
                      <input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="link_id" value={l.id} />
                      <button type="submit" className="adm-link adm-link--danger">Revoke</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {!draft && (
              <form action={createCustomerLink} className="adm-form adm-form--inline">
                <input type="hidden" name="id" value={o.id} />
                <label>Valid for (days)<input name="days" type="number" min={1} max={400} defaultValue={60} /></label>
                <button type="submit" className="adm-btn">Create a link</button>
              </form>
            )}
            <h3>Messages and updates</h3>
            {messages.length === 0 ? <p className="adm-muted adm-small">No messages.</p> : (
              <ul className="adm-notes">
                {messages.map((msg) => (
                  <li key={msg.id}>
                    <span className="adm-small adm-muted">{when(msg.created_at)} · {msg.from_customer ? "Customer" : (names[msg.author_id ?? ""] ?? "Team")}{msg.kind === "cancellation_request" ? " · asks to cancel" : ""}{msg.from_customer && !msg.handled_at ? " · waiting for a reply" : ""}</span>
                    <br /><span dir="auto">{msg.body}</span>
                  </li>
                ))}
              </ul>
            )}
            {!draft && (
              <form action={postUpdate} className="adm-form">
                <input type="hidden" name="id" value={o.id} />
                <label>Message to the customer (shown on their order page)<textarea name="body" rows={2} required maxLength={600} /></label>
                <div className="adm-actions">
                  <button type="submit" name="kind" value="reply" className="adm-btn adm-btn--dark">Send as a reply</button>
                  <button type="submit" name="kind" value="update" className="adm-btn">Post as an order update</button>
                </div>
              </form>
            )}
            {messages.some((x) => x.from_customer && !x.handled_at) && (
              <form action={markMessagesHandled} className="adm-inline">
                <input type="hidden" name="id" value={o.id} />
                <button type="submit" className="adm-link">Mark as handled without a reply</button>
              </form>
            )}
          </section>

          {open && (
            <section className="adm-card">
              <h2>Details</h2>
              <form action={updateOrderDetails} className="adm-form">
                <input type="hidden" name="id" value={o.id} />
                <label>Assigned to<select name="assigned_to" defaultValue={o.assigned_to ?? ""}><option value="">—</option>{team.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.display_name ?? "Team member"}</option>)}</select></label>
                {!draft && (
                  <>
                    <label>Ship-to label<input name="shipping_destination" defaultValue={o.shipping_destination ?? ""} maxLength={160} /></label>
                    <label>Address<input name="shipping_address" defaultValue={o.shipping_address ?? ""} maxLength={400} /></label>
                    <div className="adm-row">
                      <label>Recipient<input name="recipient_name" defaultValue={o.recipient_name ?? ""} maxLength={80} /></label>
                      <label>Recipient phone<input name="recipient_phone" defaultValue={o.recipient_phone ?? ""} maxLength={16} /></label>
                    </div>
                    <div className="adm-row">
                      <label>Piece expected in hand<input name="sourcing_eta" type="date" defaultValue={dateInput(o.sourcing_eta)} /></label>
                      <label>Delivery from<input name="delivery_estimate_from" type="date" defaultValue={dateInput(o.delivery_estimate_from)} /></label>
                      <label>Delivery to<input name="delivery_estimate_to" type="date" defaultValue={dateInput(o.delivery_estimate_to)} /></label>
                    </div>
                    <label>Estimate, in words<input name="delivery_estimate_note" defaultValue={o.delivery_estimate_note ?? ""} maxLength={300} /></label>
                    <label>Note shown to the customer<input name="customer_note" defaultValue={o.customer_note ?? ""} maxLength={600} /></label>
                    {isOwner && (
                      <>
                        <label>Order e-mail<input name="contact_email" type="email" defaultValue={o.contact_email ?? ""} maxLength={254} /></label>
                        {waiting && <label>Quote expires<input name="quote_expires_at" type="datetime-local" defaultValue={toDubaiLocal(o.quote_expires_at)} /></label>}
                      </>
                    )}
                  </>
                )}
                <label>Why (kept in the history)<input name="reason" maxLength={600} /></label>
                <button type="submit" className="adm-btn adm-btn--dark">Save</button>
              </form>
            </section>
          )}

          {isOwner && open && (
            <section className="adm-card">
              <h2>Cancel the order</h2>
              <p className="adm-muted adm-small">Only before anything has left with the carrier. Holds are released and pieces taken out of stock go back. Money already paid is refunded separately (Refunds).</p>
              <form action={cancelOrder} className="adm-form">
                <input type="hidden" name="id" value={o.id} />
                <label>Reason (internal)<input name="reason" required maxLength={600} /></label>
                <label>Message for the customer’s page (optional)<input name="public_note" maxLength={600} /></label>
                <label>Type CANCEL to confirm<input name="confirm" required pattern="CANCEL" /></label>
                <button type="submit" className="adm-btn adm-btn--danger">Cancel the order</button>
              </form>
            </section>
          )}
          {o.cancel_reason && <section className="adm-card"><h2>Cancelled</h2><p>{o.cancel_reason}</p></section>}

          <section className="adm-card">
            <h2>History</h2>
            <ul className="adm-notes adm-small">
              {events.map((e) => (
                <li key={e.id}>
                  {when(e.created_at)} · {e.actor_id ? names[e.actor_id] ?? e.actor : e.actor} · {e.kind}{e.from_value || e.to_value ? `: ${e.from_value ?? "—"} → ${e.to_value ?? "—"}` : ""}
                  {e.reason ? ` · ${e.reason}` : ""}{e.public_note ? ` · shown to the customer: “${e.public_note}”` : ""}{e.customer_visible ? "" : " · internal"}
                </li>
              ))}
            </ul>
          </section>
          {isOwner && audit.length > 0 && (
            <section className="adm-card">
              <h2>Activity log</h2>
              <ul className="adm-notes adm-small">{audit.map((a) => <li key={a.id}>{when(a.created_at)} · {a.actor_label} · {a.action}</li>)}</ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Files({ list, urls }: { list: Evidence[]; urls: Record<number, string | null> }) {
  if (!list.length) return null;
  return (
    <ul className="adm-notes adm-small">
      {list.map((e) => (
        <li key={e.id}>
          {evidenceLabels[e.kind]} · {when(e.created_at)}{e.from_customer ? " · from the customer" : ""}{e.note ? ` · ${e.note}` : ""}
          {urls[e.id] && <> · <a href={urls[e.id]!} target="_blank" rel="noopener noreferrer">open</a></>}
        </li>
      ))}
    </ul>
  );
}

/** What this order needs next, in one line. */
function NextStep({ o, isOwner, balance, refundable }: { o: Order; isOwner: boolean; balance: number; refundable: number }) {
  const text =
    o.status === "draft" ? (isOwner ? "Complete the quote and send it." : "The owner is preparing the quote.")
    : o.status === "awaiting_confirmation" ? (Number(o.amount_paid) > 0 && balance === 0 ? "Paid but not confirmed: a piece may be out of stock. Source it or cancel and refund." : "Waiting for the customer to accept and pay. Send them the private link.")
    : o.status === "cancelled" ? (refundable > 0 ? `Cancelled with ${money(refundable, o.currency)} still to refund.` : "Cancelled.")
    : o.status === "completed" ? "Completed. Returns can still be opened."
    : o.fulfilment_status === "sourcing" ? "Sourcing: follow up the supplier."
    : o.fulfilment_status === "quality_check" ? "Check every piece (photos, serial, condition), then pack."
    : o.fulfilment_status === "packed" || o.fulfilment_status === "ready_to_dispatch" ? (o.delivery_mode === "collect" ? "Ready for collection." : "Prepare the shipment, add packing photos and hand it to the carrier.")
    : o.fulfilment_status === "delivery_exception" ? "Delivery problem: contact the carrier and tell the customer."
    : "With the carrier: enter updates until delivery is confirmed.";
  return <p className="adm-hints">{text}</p>;
}

function ShipmentForm({ o, s, direction = "outbound" }: { o: Order; s?: Shipment; direction?: "outbound" | "return" }) {
  const chosen = new Set(s?.shipment_items.map((x) => x.order_item_id) ?? []);
  const eligible = o.order_items.filter((i) => (direction === "return" ? ["delivered", "collected"].includes(i.stage) : i.stage === "qc_passed" || chosen.has(i.id)));
  return (
    <form action={saveShipment} className="adm-form">
      <input type="hidden" name="order_id" value={o.id} />
      <input type="hidden" name="shipment_id" value={s?.id ?? ""} />
      <input type="hidden" name="direction" value={s?.direction ?? direction} />
      <fieldset className="adm-fieldset">
        <legend>Pieces in this parcel</legend>
        {eligible.length === 0 ? <p className="adm-muted adm-small">No piece is ready (each needs a passed check).</p> : eligible.map((i) => (
          <label key={i.id} className="adm-check"><input type="checkbox" name="item" value={i.id} defaultChecked={chosen.has(i.id)} /> {i.description}</label>
        ))}
      </fieldset>
      <div className="adm-row">
        <label>Carrier<input name="carrier" defaultValue={s?.carrier ?? ""} maxLength={80} /></label>
        <label>Service<input name="service" defaultValue={s?.service ?? ""} maxLength={80} /></label>
      </div>
      <div className="adm-row">
        <label>Tracking number<input name="tracking_number" defaultValue={s?.tracking_number ?? ""} maxLength={80} /></label>
        <label>Tracking link (https)<input name="tracking_url" type="url" defaultValue={s?.tracking_url ?? ""} maxLength={500} pattern="https://.*" /></label>
      </div>
      <div className="adm-row">
        <label>Declared value<input name="declared_value" inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" defaultValue={s?.declared_value ?? o.subtotal_amount ?? ""} /></label>
        <label>Currency<input name="declared_currency" defaultValue={s?.declared_currency ?? o.currency} maxLength={3} /></label>
        <label>Insurance<select name="insurance" defaultValue={s?.insurance ?? "unknown"}>{Object.entries(insuranceLabels).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
      </div>
      <label>Insurance reference<input name="insurance_reference" defaultValue={s?.insurance_reference ?? ""} maxLength={120} /></label>
      <label className="adm-check"><input type="checkbox" name="coverage_confirmed" defaultChecked={s?.coverage_confirmed} /> The carrier confirmed cover for this value and destination</label>
      <label>How the carrier confirmed it<input name="coverage_note" defaultValue={s?.coverage_note ?? ""} maxLength={600} /></label>
      <label>Delivery requirements (signature, ID check, …)<input name="delivery_requirements" defaultValue={s?.delivery_requirements ?? ""} maxLength={300} /></label>
      <label>Contents as packed<textarea name="packed_contents" rows={2} defaultValue={s?.packed_contents ?? ""} maxLength={1000} /></label>
      <label className="adm-check"><input type="checkbox" name="label_created" defaultChecked={s?.status === "label_created"} /> Label created (this is not shipped)</label>
      <button type="submit" className="adm-btn adm-btn--dark">{s ? "Save the shipment" : "Create the shipment"}</button>
    </form>
  );
}
