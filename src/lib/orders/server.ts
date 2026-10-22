import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { site } from "@/config/site";
import { conciergeServer } from "@/lib/concierge/config";
import { DbError, rpc } from "@/lib/concierge/db";
import { getPaymentProvider, type CheckoutLine, type PaymentProvider } from "@/lib/payments";

/** Private Storage bucket for order photos and documents (team only). */
export const ORDER_EVIDENCE_BUCKET = "order-evidence";

/**
 * Customer order links. The link carries a random token after "#", so it never reaches a server log
 * or a Referer header; the page posts it to /api/order. The database keeps only its SHA-256 hash.
 */
export const ORDER_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const newOrderToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const orderLink = (token: string) => `${site.url}/order#t=${token}`;

type Db = NonNullable<ReturnType<typeof conciergeServer>>;

export interface StartedPayment {
  payment_id: string;
  amount: number | string;
  currency: string;
  session_id: string | null;
  redirect_url: string | null;
  expires_at: string | null;
  reference: string;
}

/**
 * Sends the customer to the provider's hosted page for a payment row, creating the session the first
 * time and reusing it on a retry (double click, back button), so one payment never becomes two.
 */
export async function hostedPaymentUrl(
  db: Db,
  provider: PaymentProvider,
  pay: StartedPayment,
  input: { lines: CheckoutLine[]; email?: string | null; token: string },
): Promise<string> {
  if (pay.session_id && pay.redirect_url) return pay.redirect_url;
  const session = await provider.createCheckoutSession({
    paymentId: pay.payment_id,
    reference: pay.reference,
    lines: input.lines,
    amount: Number(pay.amount),
    currency: pay.currency,
    customerEmail: input.email ?? null,
    successUrl: `${orderLink(input.token)}&paid=1`,
    cancelUrl: orderLink(input.token),
    expiresAt: pay.expires_at ?? new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  await rpc(db, "payments_session_created", {
    p_key: db.serverKey, p_payment: pay.payment_id, p_session: session.sessionId, p_redirect_url: session.redirectUrl, p_expires_at: session.expiresAt ?? null,
  });
  return session.redirectUrl;
}

/**
 * Refunds the owner approved go to the provider here (from the panel straight away, and again from
 * the daily job in case that failed). Each stays pending until the provider's event confirms it.
 */
export async function submitApprovedRefunds() {
  const db = conciergeServer();
  const provider = getPaymentProvider();
  if (!db || !provider) return { submitted: 0 };
  const todo = await rpc<{ id: string; reference: string; amount: string; currency: string; provider: string; provider_payment_id: string; idempotency_key: string }[]>(
    db, "payments_refunds_to_submit", { p_key: db.serverKey },
  );
  let submitted = 0;
  for (const r of todo.filter((t) => t.provider === provider.name)) {
    let refundRef: string | null = null;
    let error: string | null = null;
    try {
      refundRef = (await provider.createRefund({
        paymentRef: r.provider_payment_id, amount: Number(r.amount), currency: r.currency, idempotencyKey: r.idempotency_key, reference: r.reference,
      })).refundRef;
    } catch (e) {
      error = (e instanceof Error ? e.message : "refund_failed").slice(0, 300);
    }
    try {
      await rpc(db, "payments_refund_submitted", { p_key: db.serverKey, p_refund: r.id, p_provider_refund_id: refundRef, p_error: error });
      submitted++;
    } catch (e) {
      console.error(`[refunds] could not record ${r.reference} (${e instanceof DbError ? e.code : "error"})`);
    }
  }
  return { submitted };
}
