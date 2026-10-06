import Link from "next/link";
import { notFound } from "next/navigation";
import { select } from "@/lib/concierge/db";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { fulfilmentLabels, money, orderStatusLabels, paymentLabels, when } from "@/lib/admin/labels";
import { updateOrder } from "../../../actions";

export const metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { api, token, isOwner } = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const [rows, audit, team] = await Promise.all([
    select<{ id: string; reference: string; status: string; currency: string; total_amount: string; amount_approved_by: string; amount_approved_at: string; payment_status: string; fulfilment_status: string; shipping_destination: string | null; carrier: string | null; tracking_number: string | null; tracking_url: string | null; contact_email: string | null; customer_note: string | null; is_test: boolean; created_at: string; updated_at: string; request_id: string | null; customer_id: string; customers: { name: string | null; phone_e164: string | null }; order_items: { id: number; description: string; brand: string | null; quantity: number; unit_amount: string | null }[] }[]>(
      api, "orders", { id: `eq.${id}`, select: "*,customers(name,phone_e164),order_items(*)", "order_items.order": "position.asc,id.asc" }, token,
    ),
    isOwner ? select<{ id: number; actor_label: string; action: string; before: unknown; after: unknown; created_at: string }[]>(api, "audit_log", { entity: "eq.order", entity_id: `eq.${id}`, order: "id.desc", limit: "40" }, token) : Promise.resolve([]),
    select<{ id: string; display_name: string | null }[]>(api, "staff_members", { select: "id,display_name" }, token),
  ]);
  const o = rows[0];
  if (!o) notFound();
  const names = Object.fromEntries(team.map((s) => [s.id, s.display_name ?? "Team member"]));
  return (
    <>
      <p className="adm-crumbs"><Link href="/admin/orders">← Orders</Link></p>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="adm-h1">{o.reference} {o.is_test && <span className="adm-badge adm-badge--test">Test</span>}</h1>
      <p className="adm-muted">
        <Link href={`/admin/customers/${o.customer_id}`}>{o.customers?.name || "Customer"}</Link>
        {o.request_id && <> · from <Link href={`/admin/requests/${o.request_id}`}>the request</Link></>} · created {when(o.created_at)} · updated {when(o.updated_at)}
      </p>
      <div className="adm-grid">
        <div className="adm-col">
          <section className="adm-card">
            <h2>Order</h2>
            <dl className="adm-dl">
              <dt>Total</dt><dd>{money(o.total_amount, o.currency)}<br /><span className="adm-muted adm-small">Approved by {names[o.amount_approved_by] ?? "owner"} · {when(o.amount_approved_at)}</span></dd>
              <dt>Status</dt><dd>{orderStatusLabels[o.status]}</dd>
              <dt>Payment</dt><dd>{paymentLabels[o.payment_status]}</dd>
              <dt>Delivery</dt><dd>{fulfilmentLabels[o.fulfilment_status]}</dd>
              <dt>Ship to</dt><dd>{o.shipping_destination ?? "—"}</dd>
              <dt>Tracking</dt><dd>{[o.carrier, o.tracking_number].filter(Boolean).join(" ") || "—"}{o.tracking_url && <> · <a href={o.tracking_url} target="_blank" rel="noopener noreferrer">link</a></>}</dd>
              <dt>Verification email</dt><dd>{o.contact_email ?? "— (the customer can’t check this order in the chat)"}</dd>
              <dt>Note shown to the customer</dt><dd>{o.customer_note ?? "—"}</dd>
            </dl>
            <h3>Items</h3>
            <ul className="adm-notes">
              {o.order_items.map((i) => <li key={i.id}>{i.description}{i.brand ? ` (${i.brand})` : ""}{i.quantity > 1 ? ` × ${i.quantity}` : ""}{i.unit_amount ? ` · ${money(i.unit_amount, o.currency)}` : ""}</li>)}
            </ul>
          </section>
        </div>
        <div className="adm-col">
          <section className="adm-card">
            <h2>Update</h2>
            <form action={updateOrder} className="adm-form">
              <input type="hidden" name="id" value={o.id} />
              <fieldset>
                <legend>Delivery (team)</legend>
                <label>Delivery status<select name="fulfilment_status" defaultValue={o.fulfilment_status}>{Object.entries(fulfilmentLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Ship to<input name="shipping_destination" defaultValue={o.shipping_destination ?? ""} maxLength={160} /></label>
                <div className="adm-row">
                  <label>Carrier<input name="carrier" defaultValue={o.carrier ?? ""} maxLength={80} /></label>
                  <label>Tracking number<input name="tracking_number" defaultValue={o.tracking_number ?? ""} maxLength={80} /></label>
                </div>
                <label>Tracking link (https)<input name="tracking_url" type="url" defaultValue={o.tracking_url ?? ""} maxLength={500} pattern="https://.*" /></label>
              </fieldset>
              {isOwner && (
                <fieldset>
                  <legend>Owner only</legend>
                  <label>Order status<select name="status" defaultValue={o.status}>{Object.entries(orderStatusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Payment status<select name="payment_status" defaultValue={o.payment_status}>{Object.entries(paymentLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <div className="adm-row">
                    <label>Total<input name="total_amount" inputMode="decimal" defaultValue={o.total_amount} pattern="[0-9,]+(\.[0-9]{1,2})?" /></label>
                    <label>Currency<input name="currency" defaultValue={o.currency} maxLength={3} pattern="[A-Za-z]{3}" /></label>
                  </div>
                  <label>Verification email (codes for the chat order check)<input name="contact_email" type="email" defaultValue={o.contact_email ?? ""} maxLength={254} /></label>
                  <label>Note shown to the customer<input name="customer_note" defaultValue={o.customer_note ?? ""} maxLength={600} /></label>
                </fieldset>
              )}
              <button type="submit" className="adm-btn adm-btn--dark">Save</button>
            </form>
          </section>
          {isOwner && (
            <section className="adm-card">
              <h2>History</h2>
              <ul className="adm-notes adm-small">
                {audit.map((a) => <li key={a.id}>{when(a.created_at)} · {a.actor_label} · {a.action}{a.after ? <code className="adm-code">{JSON.stringify(a.before ?? {})} → {JSON.stringify(a.after)}</code> : null}</li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
