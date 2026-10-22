import { NextResponse } from "next/server";
import { after } from "next/server";
import { parseCheckoutDetails, sameOrigin, verifyBag } from "@/lib/checkout";
import { clientHash, conciergeServer } from "@/lib/concierge/config";
import { DbError, rpc } from "@/lib/concierge/db";
import { processNotifications } from "@/lib/concierge/notify";
import { ORDER_TOKEN, hostedPaymentUrl, orderLink, tokenHash, type StartedPayment } from "@/lib/orders/server";
import { getPaymentProvider } from "@/lib/payments";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_000;
const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => NextResponse.json({ code, ...extra }, { status });

/**
 * Online payment: creates the order (waiting for payment), holds the pieces, and sends the customer to
 * the provider's secure page. Nothing here marks the order paid; only the provider's verified event
 * does (/api/payments/webhook). The browser keeps one idempotency key and one order token per bag, so
 * a retry or double click returns the same order and the same payment page.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, "invalid_request");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, "invalid_request");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "invalid_request");
  }
  if (!body || typeof body !== "object") return fail(400, "invalid_request");
  if (typeof body.website === "string" && body.website.trim()) return fail(400, "invalid_request");

  const provider = getPaymentProvider();
  const db = conciergeServer();
  if (!provider || !db) return fail(503, "payments_unavailable");
  const bag = await verifyBag(body.items);
  if (!bag.ok) return fail(bag.status, bag.status === 409 ? "bag_changed" : "invalid_request", bag.issues ? { issues: bag.issues } : {});
  const details = parseCheckoutDetails(body);
  if (!details.ok) return fail(400, "invalid_details", { fields: details.fields });
  const token = typeof body.orderToken === "string" && ORDER_TOKEN.test(body.orderToken) ? body.orderToken : "";
  if (!token) return fail(400, "invalid_request");

  let started: StartedPayment & { order_id: string; created: boolean; status: string; payment_status: string };
  try {
    started = await rpc(db, "shop_start_checkout", {
      p_key: db.serverKey,
      p_order: {
        idempotency_key: `checkout:${details.idem}`,
        lines: bag.lines.map((l) => ({ ref: l.ref, sku: l.sku ?? null, qty: l.qty })),
        delivery_mode: details.mode,
        shipping_country: details.mode === "deliver" ? details.country : null,
        shipping_address: details.mode === "deliver" ? [details.address, details.city, details.country].join(", ") : null,
        shipping_label: details.mode === "deliver" ? `${details.city}, ${details.country}` : null,
        contact_name: details.name,
        contact_phone: details.phone,
        contact_email: details.email || null,
        contact_method: details.method,
        client_hash: clientHash(request, db.serverKey),
        token_hash: tokenHash(token),
        provider: provider.name,
      },
    });
  } catch (e) {
    const code = e instanceof DbError ? e.code : "error";
    if (code === "rate_limited") return fail(429, code);
    if (["bag_changed", "insufficient_stock", "not_for_sale"].includes(code)) return fail(409, "bag_changed", { issues: [] });
    if (["policies_unapproved", "destination_unsupported", "shipping_quote_needed", "vat_unconfirmed", "duties_unconfirmed"].includes(code)) {
      return fail(409, "online_unavailable", { reason: code });
    }
    console.error(`[checkout] could not start (${code})`);
    return fail(502, "not_started");
  }
  if (!started.created && started.status !== "awaiting_confirmation") {
    // Already paid (or closed): show the order instead of paying again.
    return NextResponse.json({ reference: started.reference, orderUrl: orderLink(token) });
  }
  if (!started.created && !["created", "pending"].includes(started.payment_status)) {
    return NextResponse.json({ reference: started.reference, orderUrl: orderLink(token) });
  }
  after(() => processNotifications().catch(() => {}));
  try {
    const redirectUrl = await hostedPaymentUrl(db, provider, started, {
      lines: bag.lines.map((l) => ({ name: [l.brand, l.name, l.options].filter(Boolean).join(" "), quantity: l.qty, unitAmount: l.unitAED })),
      email: details.email || null,
      token,
    });
    return NextResponse.json({ reference: started.reference, redirectUrl, orderUrl: orderLink(token) });
  } catch (e) {
    console.error(`[checkout] provider session failed (${e instanceof Error ? e.message.slice(0, 80) : "error"})`);
    // The order and the hold exist; the customer can retry from the order page.
    return fail(502, "provider_unavailable", { reference: started.reference, orderUrl: orderLink(token) });
  }
}
