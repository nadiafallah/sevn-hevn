import Link from "next/link";
import { notFound } from "next/navigation";
import { select } from "@/lib/concierge/db";
import { requireOwner } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { createOrder } from "../../../actions";

export const metadata = { title: "New order" };

export default async function NewOrder({ searchParams }: { searchParams: SP }) {
  const { api, token } = await requireOwner();
  const sp = await searchParams;
  const customerId = one(sp.customer) ?? "";
  const requestId = one(sp.request) ?? "";
  if (!/^[0-9a-f-]{36}$/.test(customerId)) notFound();
  const [customers, requests] = await Promise.all([
    select<{ id: string; name: string | null; email: string | null }[]>(api, "customers", { id: `eq.${customerId}`, select: "id,name,email" }, token),
    /^[0-9a-f-]{36}$/.test(requestId)
      ? select<{ id: string; reference: string; summary: string; destination_label: string | null; details: Record<string, string> }[]>(api, "requests", { id: `eq.${requestId}`, select: "id,reference,summary,destination_label,details" }, token)
      : Promise.resolve([]),
  ]);
  const c = customers[0];
  if (!c) notFound();
  const r = requests[0];
  return (
    <>
      <p className="adm-crumbs"><Link href={r ? `/admin/requests/${r.id}` : `/admin/customers/${c.id}`}>← Back</Link></p>
      <Flash error={one(sp.error)} />
      <h1 className="adm-h1">New order for {c.name || "customer"}</h1>
      {r && <p className="adm-muted">From request {r.reference}: <span dir="auto">{r.summary.slice(0, 200)}</span></p>}
      <section className="adm-card adm-narrow">
        <form action={createOrder} className="adm-form">
          <input type="hidden" name="customer_id" value={c.id} />
          <input type="hidden" name="request_id" value={r?.id ?? ""} />
          <label>
            Items — one per line: <code>description | brand | quantity</code>
            <textarea name="items" rows={4} required defaultValue={r ? [[r.details?.model, r.details?.colour, r.details?.size].filter(Boolean).join(" ") || r.summary.slice(0, 120), r.details?.brand ?? "", "1"].join(" | ") : ""} />
          </label>
          <div className="adm-row">
            <label>Approved total<input name="total" required inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" /></label>
            <label>Currency<input name="currency" defaultValue="AED" maxLength={3} pattern="[A-Za-z]{3}" required /></label>
          </div>
          <label>Ship to<input name="shipping_destination" defaultValue={r?.destination_label ?? ""} maxLength={160} /></label>
          <label>Verification email (lets the customer check this order in the chat with a one-time code)<input name="contact_email" type="email" defaultValue={c.email ?? ""} maxLength={254} /></label>
          <label>Note shown to the customer (optional)<input name="customer_note" maxLength={600} /></label>
          <p className="adm-muted adm-small">The total is recorded as approved by you, with the time. Payment starts as “Unpaid” and delivery as “Not started”.</p>
          <button type="submit" className="adm-btn adm-btn--dark">Create order</button>
        </form>
      </section>
    </>
  );
}
