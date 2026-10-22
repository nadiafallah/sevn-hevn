import Link from "next/link";
import { rpc, select } from "@/lib/concierge/db";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { resolvePaymentEvent } from "../../order-actions";
import { fulfilmentLabels, money, orderStatusLabels, paymentLabels, returnReasonLabels, returnStatusLabels, shipmentStatusLabels, sourcingStatusLabels, when } from "@/lib/admin/labels";

export const metadata = { title: "Orders" };

type Ref = { id?: string; order_id?: string; reference: string };
interface Queues {
  awaiting_payment: (Ref & { expires_at: string | null; expired: boolean; total: string; currency: string; paid: string })[];
  paid_not_confirmed: Ref[];
  payments_to_verify: (Ref & { amount: string; currency: string; method: string; at: string })[];
  payment_discrepancies: { id: number; order_id: string | null; type: string; detail: string | null; at: string }[];
  sourcing: (Ref & { item: string; status: string; confirm_by: string | null; overdue: boolean; expected_at: string | null; late: boolean })[];
  supplier_failed: (Ref & { item: string; reason: string | null })[];
  checks_to_do: (Ref & { item: string; stage: string })[];
  overdue_dispatch: (Ref & { confirmed_at: string; stage: string })[];
  shipment_exceptions: (Ref & { status: string; kind: string | null; note: string | null })[];
  customer_messages: (Ref & { kind: string; at: string; body: string })[];
  return_reviews: (Ref & { reason: string; at: string; status: string })[];
  returns_in_progress: (Ref & { status: string })[];
  refunds_owed: (Ref & { paid: string; refunded: string; currency: string })[];
  refunds_open: (Ref & { status: string; amount: string; currency: string; since: string; reason: string | null })[];
}

const orderHref = (r: Ref) => (r.order_id ?? r.id ? `/admin/orders/${r.order_id ?? r.id}` : "/admin/orders");

function Queue<T extends Ref>({ title, rows, render, hint }: { title: string; rows: T[]; render: (r: T) => React.ReactNode; hint?: string }) {
  if (!rows.length) return null;
  return (
    <section className="adm-card">
      <h2>{title} <span className="adm-badge">{rows.length}</span></h2>
      {hint && <p className="adm-muted adm-small">{hint}</p>}
      <ul className="adm-notes">
        {rows.slice(0, 30).map((r, i) => <li key={`${r.reference}-${i}`}><Link href={orderHref(r)} className="adm-ref">{r.reference}</Link> · {render(r)}</li>)}
      </ul>
    </section>
  );
}

export default async function Orders({ searchParams }: { searchParams: SP }) {
  const { api, token, isOwner } = await requireStaff();
  const sp = await searchParams;
  const status = one(sp.status) && orderStatusLabels[one(sp.status)!] ? one(sp.status)! : null;
  const includeTest = one(sp.test) === "1";
  const query: Record<string, string> = { select: "id,reference,status,channel,currency,total_amount,payment_status,fulfilment_status,is_test,created_at,customers(name)", order: "created_at.desc", limit: "200" };
  if (status) query.status = `eq.${status}`;
  if (!includeTest) query.is_test = "is.false";
  const [rows, q] = await Promise.all([
    select<{ id: string; reference: string; status: string; channel: string; currency: string; total_amount: string | null; payment_status: string; fulfilment_status: string; is_test: boolean; created_at: string; customers: { name: string | null } }[]>(api, "orders", query, token),
    rpc<Queues>(api, "admin_work_queues", { p_include_test: includeTest }, token).catch(() => null),
  ]);
  const queued = q ? Object.values(q).reduce((n, list) => n + list.length, 0) : 0;
  return (
    <>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="adm-h1">Orders</h1>
      <p className="adm-muted adm-small">
        Website checkouts arrive here by themselves. Quotes for WhatsApp, phone and in-person sales start from a request or a customer record. Order, payment and delivery are tracked separately, with a history of every change.
      </p>

      {q && queued === 0 && <p className="adm-hints">Nothing is waiting for the team.</p>}
      {q && (
        <div className="adm-grid">
          <div className="adm-col">
            <Queue title="Paid, not confirmed" rows={q.paid_not_confirmed} hint="A piece went out of stock before the payment arrived. Source it or cancel and refund." render={() => "decide"} />
            <Queue title="Payment events to check" rows={q.payment_discrepancies.map((e) => ({ ...e, id: undefined, event_id: e.id, order_id: e.order_id ?? undefined, reference: e.order_id ? "Open the order" : "No matching order" }))}
              render={(e) => (
                <>
                  {when(e.at)} · {e.detail ?? e.type}
                  {isOwner && !e.order_id && (
                    <form action={resolvePaymentEvent} className="adm-form adm-form--inline">
                      <input type="hidden" name="event_id" value={e.event_id} />
                      <label>What you found<input name="note" required maxLength={600} /></label>
                      <button type="submit" className="adm-btn">Mark resolved</button>
                    </form>
                  )}
                </>
              )} />
            <Queue title="Payments to verify" rows={q.payments_to_verify} hint={isOwner ? "Count them only once the funds are in the account." : "The owner verifies these."} render={(p) => `${money(p.amount, p.currency)} · reported ${when(p.at)}`} />
            <Queue title="Waiting for the customer" rows={q.awaiting_payment} render={(o) => `${money(o.total, o.currency)}${Number(o.paid) > 0 ? ` · ${money(o.paid, o.currency)} paid` : ""} · ${o.expired ? "expired" : `expires ${when(o.expires_at)}`}`} />
            <Queue title="Customer messages" rows={q.customer_messages} render={(m) => `${m.kind === "cancellation_request" ? "asks to cancel · " : ""}${when(m.at)} · “${m.body}”`} />
            <Queue title="Refunds owed" rows={q.refunds_owed} hint="Cancelled orders with money still to refund." render={(o) => `${money(Number(o.paid) - Number(o.refunded), o.currency)}`} />
            <Queue title="Refunds in progress or failed" rows={q.refunds_open} render={(r) => `${money(r.amount, r.currency)} · ${r.status}${r.reason ? ` · ${r.reason}` : ""} · since ${when(r.since)}`} />
          </div>
          <div className="adm-col">
            <Queue title="Sourcing" rows={q.sourcing} render={(t) => `${t.item} · ${sourcingStatusLabels[t.status]}${t.overdue ? " · supplier confirmation overdue" : ""}${t.late ? " · late" : ""}`} />
            <Queue title="Supplier can’t deliver" rows={q.supplier_failed} render={(t) => `${t.item}${t.reason ? ` · ${t.reason}` : ""}`} />
            <Queue title="Pieces to check" rows={q.checks_to_do} render={(c) => `${c.item} · ${c.stage === "qc_failed" ? "check failed" : "in hand"}`} />
            <Queue title="Overdue dispatch" rows={q.overdue_dispatch} render={(o) => `${fulfilmentLabels[o.stage]} · confirmed ${when(o.confirmed_at)}`} />
            <Queue title="Delivery problems" rows={q.shipment_exceptions} render={(s) => `${shipmentStatusLabels[s.status]}${s.note ? ` · ${s.note}` : ""}`} />
            <Queue title="Returns to review" rows={q.return_reviews} render={(r) => `${returnReasonLabels[r.reason]} · ${when(r.at)}`} />
            <Queue title="Returns in progress" rows={q.returns_in_progress} render={(r) => returnStatusLabels[r.status]} />
          </div>
        </div>
      )}

      <h2>All orders</h2>
      <form className="adm-filters">
        <label>Status<select name="status" defaultValue={status ?? ""}><option value="">Any</option>{Object.entries(orderStatusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="adm-check"><input type="checkbox" name="test" value="1" defaultChecked={includeTest} /> Include test records</label>
        <button type="submit" className="adm-btn adm-btn--dark">Filter</button>
      </form>
      {rows.length === 0 ? <p className="adm-empty">No orders yet.</p> : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th scope="col">Created</th><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Order</th><th scope="col">Payment</th><th scope="col">Delivery</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>{when(o.created_at)}</td>
                  <td><Link href={`/admin/orders/${o.id}`} className="adm-ref">{o.reference}</Link>{o.is_test && <span className="adm-badge adm-badge--test">Test</span>}</td>
                  <td>{o.customers?.name || "—"}</td>
                  <td>{money(o.total_amount, o.currency)}</td>
                  <td>{orderStatusLabels[o.status]}</td>
                  <td>{paymentLabels[o.payment_status]}</td>
                  <td>{fulfilmentLabels[o.fulfilment_status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
