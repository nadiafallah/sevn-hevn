import { NextResponse } from "next/server";
import { sameOrigin, verifyBag } from "@/lib/checkout";
import { conciergeServer } from "@/lib/concierge/config";
import { DbError, rpc, select } from "@/lib/concierge/db";
import { getPaymentProvider } from "@/lib/payments";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_000;
const COUNTRY = /^[A-Z]{2}$/;

/**
 * Whether this bag can be paid online now, and exactly what the customer would pay: pieces, delivery,
 * VAT and duties, from the catalogue and the owner's settings. Online payment needs a connected
 * provider, the owner's VAT and shipping settings for the destination, and approved terms and returns
 * policy. When any is missing the answer says so, and checkout sends a purchase request instead.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ online: false, reason: "invalid_request" }, { status: 403 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ online: false, reason: "invalid_request" }, { status: 413 });
  let body: { items?: unknown; mode?: unknown; country?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ online: false, reason: "invalid_request" }, { status: 400 });
  }
  const db = conciergeServer();
  if (!getPaymentProvider() || !db) return NextResponse.json({ online: false, reason: "payments_unavailable" });
  const bag = await verifyBag(body.items);
  if (!bag.ok) return NextResponse.json({ online: false, reason: "bag_changed", issues: bag.issues ?? [] }, { status: bag.status });
  const mode = body.mode === "collect" ? "collect" : "deliver";
  const country = typeof body.country === "string" && COUNTRY.test(body.country) ? body.country : "";
  try {
    const res = await rpc<{ ok: boolean; reason?: string; quote?: Record<string, unknown> }>(db, "shop_price_bag", {
      p_key: db.serverKey,
      p_lines: bag.lines.map((l) => ({ ref: l.ref, sku: l.sku ?? null, qty: l.qty })),
      p_mode: mode,
      p_country: country,
    });
    if (!res.ok) return NextResponse.json({ online: false, reason: res.reason });
    const policies = await select<{ kind: string; version: string; title: string }[]>(db, "policy_versions", {
      select: "kind,version,title", status: "eq.approved", kind: "in.(terms_of_sale,returns)",
    });
    return NextResponse.json({ online: true, quote: res.quote, policies });
  } catch (e) {
    return NextResponse.json({ online: false, reason: e instanceof DbError && e.status === 404 ? "payments_unavailable" : "error" });
  }
}
