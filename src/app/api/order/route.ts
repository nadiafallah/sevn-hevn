import { NextResponse, after } from "next/server";
import { sameOrigin } from "@/lib/checkout";
import { clientHash, conciergeServer } from "@/lib/concierge/config";
import { DbError, rpc } from "@/lib/concierge/db";
import { processNotifications } from "@/lib/concierge/notify";
import { ORDER_TOKEN, hostedPaymentUrl, tokenHash, type StartedPayment } from "@/lib/orders/server";
import { getPaymentProvider } from "@/lib/payments";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_000;
const IDEM = /^[A-Za-z0-9-]{16,64}$/;
const REASONS = ["change_of_mind", "defective", "damaged_in_transit", "not_authentic", "wrong_item", "not_as_described", "other"];
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });

/**
 * The customer's order page (/order#t=…). The token arrives in the body, never in a URL, and only
 * its hash is looked up. The same answer is given for an unknown, revoked or expired link.
 *
 * Actions: view, accept (a sent quote), pay (online, when a provider is connected), message (a
 * question or a cancellation request) and return (a return request for delivered pieces).
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "invalid_request" }, 403);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return reply({ error: "invalid_request" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ error: "invalid_request" }, 400);
  }
  const token = typeof body.token === "string" && ORDER_TOKEN.test(body.token) ? body.token : "";
  if (!token) return reply({ error: "not_found" }, 404);
  const db = conciergeServer();
  if (!db) return reply({ error: "unavailable" }, 503);
  const hash = tokenHash(token);
  const provider = getPaymentProvider();

  try {
    switch (body.action) {
      case "view": {
        const view = await rpc<Record<string, unknown> | null>(db, "shop_order_view", { p_key: db.serverKey, p_token_hash: hash, p_client_hash: clientHash(request, db.serverKey) });
        if (!view) return reply({ error: "not_found" }, 404);
        return reply({ order: view, canPayOnline: !!provider });
      }
      case "accept": {
        const view = await rpc(db, "shop_order_accept_quote", { p_key: db.serverKey, p_token_hash: hash });
        after(() => processNotifications().catch(() => {}));
        return reply({ order: view, canPayOnline: !!provider });
      }
      case "pay": {
        if (!provider) return reply({ error: "payments_unavailable" }, 409);
        const pay = await rpc<StartedPayment>(db, "shop_order_payment", { p_key: db.serverKey, p_token_hash: hash, p_provider: provider.name });
        const redirectUrl = await hostedPaymentUrl(db, provider, pay, {
          lines: [{ name: `Order ${pay.reference}`, quantity: 1, unitAmount: Number(pay.amount) }],
          token,
        });
        return reply({ redirectUrl });
      }
      case "message": {
        const kind = body.kind === "cancellation_request" ? "cancellation_request" : "message";
        const text = typeof body.body === "string" ? body.body.trim().slice(0, 2000) : "";
        if (!text) return reply({ error: "invalid_request" }, 400);
        await rpc(db, "shop_order_message", { p_key: db.serverKey, p_token_hash: hash, p_kind: kind, p_body: text });
        after(() => processNotifications().catch(() => {}));
        return reply({ ok: true });
      }
      case "return": {
        const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
        const reason = typeof body.reason === "string" && REASONS.includes(body.reason) ? body.reason : "";
        const idem = typeof body.idempotencyKey === "string" && IDEM.test(body.idempotencyKey) ? body.idempotencyKey : "";
        if (!items.length || !reason || !idem) return reply({ error: "invalid_request" }, 400);
        const res = await rpc<{ reference: string }>(db, "shop_order_request_return", {
          p_key: db.serverKey,
          p_token_hash: hash,
          p_request: {
            idempotency_key: idem,
            reason,
            description: typeof body.description === "string" ? body.description.trim().slice(0, 2000) : null,
            items: items.map((i) => ({ order_item_id: Number((i as { id?: unknown }).id), quantity: Number((i as { quantity?: unknown }).quantity ?? 1) })),
          },
        });
        after(() => processNotifications().catch(() => {}));
        return reply({ reference: res.reference });
      }
      default:
        return reply({ error: "invalid_request" }, 400);
    }
  } catch (e) {
    const code = e instanceof DbError ? e.code : "error";
    if (code === "not_found") return reply({ error: "not_found" }, 404);
    if (code === "rate_limited") return reply({ error: code }, 429);
    if (["invalid_request", "invalid_transition", "quote_expired", "quote_not_accepted", "insufficient_stock", "not_for_sale", "policies_unapproved"].includes(code)) {
      return reply({ error: code }, 409);
    }
    console.error(`[order] ${String(body.action).slice(0, 12)} failed (${code})`);
    return reply({ error: "server_error" }, 502);
  }
}
