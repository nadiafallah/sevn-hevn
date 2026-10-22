import Link from "next/link";
import { notFound } from "next/navigation";
import { select } from "@/lib/concierge/db";
import { requireOwner } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { QuoteFields } from "@/components/admin/QuoteForm";
import { createOrder } from "../../../order-actions";

export const metadata = { title: "New order" };

export default async function NewOrder({ searchParams }: { searchParams: SP }) {
  const { api, token } = await requireOwner();
  const sp = await searchParams;
  const customerId = one(sp.customer) ?? "";
  const requestId = one(sp.request) ?? "";
  if (!/^[0-9a-f-]{36}$/.test(customerId)) notFound();
  const [customers, requests, settings] = await Promise.all([
    select<{ id: string; name: string | null; email: string | null; country_code: string | null }[]>(api, "customers", { id: `eq.${customerId}`, select: "id,name,email,country_code" }, token),
    /^[0-9a-f-]{36}$/.test(requestId)
      ? select<{ id: string; reference: string; type: string; summary: string; destination_country: string | null; destination_label: string | null; details: Record<string, unknown> }[]>(
          api, "requests", { id: `eq.${requestId}`, select: "id,reference,type,summary,destination_country,destination_label,details" }, token)
      : Promise.resolve([]),
    select<{ vat_rate_percent: string | null }[]>(api, "shop_settings", { select: "vat_rate_percent" }, token).catch(() => []),
  ]);
  const c = customers[0];
  if (!c) notFound();
  const r = requests[0];
  const d = (r?.details ?? {}) as Record<string, unknown>;
  // A website purchase request carries its verified lines; a sourcing request becomes one on-request line.
  const fromBag = Array.isArray(d.lines)
    ? (d.lines as { ref: string; sku?: string; brand?: string; name: string; options?: string; qty: number; unitAED: number }[]).map((l) => ({
        description: l.name, brand: l.brand, product_ref: l.ref, sku: l.sku, options: l.options, quantity: l.qty, unit_amount: l.unitAED, availability: "in_stock",
      }))
    : null;
  const lines = fromBag ?? (r ? [{
    description: [d.model, d.colour, d.size].filter(Boolean).join(" ") || r.summary.slice(0, 120),
    brand: typeof d.brand === "string" ? d.brand : null,
    availability: r.type === "sourcing" ? "on_request" : "in_stock",
  }] : []);
  const delivery = (d.delivery ?? {}) as Record<string, string | null>;
  return (
    <>
      <p className="adm-crumbs"><Link href={r ? `/admin/requests/${r.id}` : `/admin/customers/${c.id}`}>← Back</Link></p>
      <Flash error={one(sp.error)} />
      <h1 className="adm-h1">New quote for {c.name || "customer"}</h1>
      {r && <p className="adm-muted">From request {r.reference}: <span dir="auto">{r.summary.slice(0, 200)}</span></p>}
      <section className="adm-card">
        <p className="adm-muted adm-small">
          This creates a draft quote. Nothing is sent or held until you press “Send the quote” on the order. The customer pays the full amount before sourcing starts.
        </p>
        <form action={createOrder} className="adm-form">
          <input type="hidden" name="customer_id" value={c.id} />
          <input type="hidden" name="request_id" value={r?.id ?? ""} />
          <QuoteFields
            lines={lines}
            vatRate={settings[0]?.vat_rate_percent ?? null}
            q={{
              channel: r?.type === "purchase" ? "website" : "panel",
              delivery_mode: delivery.mode === "collect" ? "collect" : "deliver",
              shipping_country: delivery.country ?? r?.destination_country ?? c.country_code,
              shipping_address: delivery.address ?? null,
              shipping_destination: r?.destination_label ?? null,
              contact_email: c.email,
              duties_treatment: (delivery.country ?? r?.destination_country ?? c.country_code) === "AE" ? "not_applicable" : "unknown",
            }}
          />
          <button type="submit" className="adm-btn adm-btn--dark">Create the draft quote</button>
        </form>
      </section>
    </>
  );
}
