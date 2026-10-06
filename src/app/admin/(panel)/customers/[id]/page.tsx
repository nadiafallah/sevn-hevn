import Link from "next/link";
import { notFound } from "next/navigation";
import { select } from "@/lib/concierge/db";
import { formatPhone } from "@/lib/concierge/phone";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { fulfilmentLabels, methodLabels, money, paymentLabels, requestStatusLabels, requestTypeLabels, when } from "@/lib/admin/labels";
import { updateCustomer } from "../../../actions";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { api, token, isOwner } = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const rows = await select<{ id: string; name: string | null; phone_e164: string | null; email: string | null; preferred_language: string; preferred_contact: string | null; country_code: string | null; is_test: boolean; created_at: string; requests: { id: string; reference: string; type: string; status: string; summary: string; created_at: string }[]; orders: { id: string; reference: string; currency: string; total_amount: string; payment_status: string; fulfilment_status: string; created_at: string }[] }[]>(
    api, "customers",
    { id: `eq.${id}`, select: "*,requests(id,reference,type,status,summary,created_at),orders(id,reference,currency,total_amount,payment_status,fulfilment_status,created_at)", "requests.order": "created_at.desc", "orders.order": "created_at.desc" },
    token,
  );
  const c = rows[0];
  if (!c) notFound();
  return (
    <>
      <p className="adm-crumbs"><Link href="/admin/customers">← Customers</Link></p>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="adm-h1">{c.name || "Unnamed customer"} {c.is_test && <span className="adm-badge adm-badge--test">Test</span>}</h1>
      <div className="adm-grid">
        <div className="adm-col">
          <section className="adm-card">
            <h2>Contact</h2>
            <dl className="adm-dl">
              <dt>Phone</dt><dd className="adm-ltr">{c.phone_e164 ? <a href={`tel:${c.phone_e164}`}>{formatPhone(c.phone_e164)}</a> : "—"}</dd>
              <dt>Email</dt><dd>{c.email ?? "—"}</dd>
              <dt>Language</dt><dd>{c.preferred_language === "ar" ? "Arabic" : "English"}</dd>
              <dt>Prefers</dt><dd>{c.preferred_contact ? methodLabels[c.preferred_contact] : "—"}</dd>
              <dt>Country</dt><dd>{c.country_code ?? "—"}</dd>
              <dt>First contact</dt><dd>{when(c.created_at)}</dd>
            </dl>
          </section>
          {isOwner && (
            <section className="adm-card">
              <h2>Edit (owner)</h2>
              <form action={updateCustomer} className="adm-form">
                <input type="hidden" name="id" value={c.id} />
                <label>Name<input name="name" defaultValue={c.name ?? ""} maxLength={80} /></label>
                <label>Email<input name="email" type="email" defaultValue={c.email ?? ""} maxLength={254} /></label>
                <label>Language<select name="preferred_language" defaultValue={c.preferred_language}><option value="en">English</option><option value="ar">Arabic</option></select></label>
                <label>Prefers<select name="preferred_contact" defaultValue={c.preferred_contact ?? ""}><option value="">—</option>{Object.entries(methodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Country code<input name="country_code" defaultValue={c.country_code ?? ""} maxLength={2} pattern="[A-Za-z]{2}" /></label>
                <button type="submit" className="adm-btn adm-btn--dark">Save</button>
              </form>
            </section>
          )}
        </div>
        <div className="adm-col">
          <section className="adm-card">
            <h2>Requests</h2>
            <ul className="adm-notes">
              {c.requests.map((r) => (
                <li key={r.id}><Link href={`/admin/requests/${r.id}`} className="adm-ref">{r.reference}</Link> · {requestTypeLabels[r.type]} · {requestStatusLabels[r.status]} · {when(r.created_at)}<br /><span dir="auto">{r.summary.slice(0, 160)}</span></li>
              ))}
            </ul>
          </section>
          <section className="adm-card">
            <h2>Orders</h2>
            {c.orders.length === 0 ? <p className="adm-muted">No orders.</p> : (
              <ul className="adm-notes">
                {c.orders.map((o) => (
                  <li key={o.id}><Link href={`/admin/orders/${o.id}`} className="adm-ref">{o.reference}</Link> · {money(o.total_amount, o.currency)} · {paymentLabels[o.payment_status]} · {fulfilmentLabels[o.fulfilment_status]}</li>
                ))}
              </ul>
            )}
            {isOwner && <Link className="adm-btn" href={`/admin/orders/new?customer=${c.id}`}>Create an order</Link>}
          </section>
        </div>
      </div>
    </>
  );
}
