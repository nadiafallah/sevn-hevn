import { NextResponse } from "next/server";
import { verifyBag, sameOrigin } from "@/lib/checkout";
import { clientHash, conciergeServer } from "@/lib/concierge/config";
import { DbError, rpc } from "@/lib/concierge/db";
import { isEmail, parsePhone } from "@/lib/concierge/phone";
import { en } from "@/i18n/dictionaries/en";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_000;
const COUNTRY = /^[A-Z]{2}$/;
const IDEM = /^[A-Za-z0-9-]{16,64}$/;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => NextResponse.json({ code, ...extra }, { status });

/**
 * A purchase request from the checkout page (guest checkout; no account). The bag is verified again
 * on the server, then stored as a request in the private panel (/admin) with the customer's details,
 * through a database function that only the website's server key can call. No payment is taken:
 * online payment is not connected, and an order is created by the team once they confirm it.
 *
 * - Duplicate submissions (double click, retry, reload) carry the same idempotency key and return
 *   the same reference instead of a second request.
 * - Where requests can't be stored (preview deployments, local development, or a database that
 *   hasn't had the shop migration yet) it answers 503 with the verified bag, and the page offers
 *   WhatsApp instead. It never pretends a request was sent.
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
  // Honeypot: real visitors never see or fill this field.
  if (str(body.website, 200)) return fail(400, "invalid_request");

  const bag = await verifyBag(body.items);
  if (!bag.ok) return fail(bag.status, bag.status === 409 ? "bag_changed" : "invalid_request", bag.issues ? { issues: bag.issues } : {});

  const c = (body.customer ?? {}) as Record<string, unknown>;
  const d = (body.delivery ?? {}) as Record<string, unknown>;
  const name = str(c.name, 80);
  const email = str(c.email, 254).toLowerCase();
  const method = c.method === "call" || c.method === "email" ? c.method : "whatsapp";
  const phone = parsePhone(str(c.phone, 30));
  const mode = d.mode === "collect" ? "collect" : "deliver";
  const country = str(d.country, 2).toUpperCase();
  const city = str(d.city, 80);
  const address = str(d.address, 300);
  const notes = str(d.notes, 600);
  const idem = str(body.idempotencyKey, 64);

  const errors: string[] = [];
  if (!name) errors.push("name");
  if (!phone.ok) errors.push("phone");
  if (email && !isEmail(email)) errors.push("email");
  if (method === "email" && !email) errors.push("emailNeeded");
  if (mode === "deliver") {
    if (!COUNTRY.test(country)) errors.push("country");
    if (!city) errors.push("city");
    if (!address) errors.push("address");
  }
  if (body.consent !== true) errors.push("consent");
  if (!IDEM.test(idem)) errors.push("invalid_request");
  if (errors.length) return fail(400, "invalid_details", { fields: errors });

  const verified = { lines: bag.lines, subtotalAED: bag.subtotalAED, subtotalLabel: bag.subtotalLabel };
  const db = conciergeServer();
  if (!db) return fail(503, "requests_unavailable", { verified });

  const summary = [
    "Purchase request from the website:",
    ...bag.lines.map((l) => `${l.brand ?? ""} ${l.name}${l.options ? ` (${l.options})` : ""} — ${l.sku && l.sku !== l.ref ? `${l.ref} / ${l.sku}` : l.ref} — ${l.qty} × AED ${l.unitAED.toLocaleString("en-US")}`.trim()),
    `Subtotal: ${bag.subtotalLabel}. Delivery and VAT to be confirmed. Not paid.`,
  ].join("\n");

  try {
    const res = await rpc<{ reference: string; created: boolean }>(db, "shop_submit_purchase", {
      p_key: db.serverKey,
      p_request: {
        idempotency_key: `checkout:${idem}`,
        locale: "en",
        contact_name: name,
        contact_phone: phone.ok ? phone.phone.e164 : null,
        contact_email: email || null,
        contact_method: method,
        destination_country: mode === "deliver" ? country : "AE",
        destination_label: mode === "deliver" ? `${city}, ${country}` : "Collect in Dubai",
        consent_text: en.ui.shop.checkout.consent,
        client_hash: clientHash(request, db.serverKey),
        summary: summary.slice(0, 2000),
        details: {
          lines: bag.lines,
          subtotal_aed: bag.subtotalAED,
          currency: "AED",
          payment: "not_connected",
          delivery: { mode, country: mode === "deliver" ? country : null, city: mode === "deliver" ? city : null, address: mode === "deliver" ? address : null },
          notes: notes || null,
        },
      },
    });
    return NextResponse.json({ reference: res.reference, created: res.created, verified }, { status: res.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof DbError && e.code === "rate_limited") return fail(429, "rate_limited", { verified });
    // The function doesn't exist until the shop migration has been run (PostgREST answers 404).
    if (e instanceof DbError && (e.status === 404 || e.code === "unreachable")) return fail(503, "requests_unavailable", { verified });
    console.error(`[purchase-request] could not be stored (${e instanceof DbError ? e.code : "error"})`);
    return fail(502, "not_stored", { verified });
  }
}
