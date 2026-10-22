import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Payment integration boundary.
 *
 * No payment provider is connected to the live site: `getPaymentProvider()` returns null there and
 * checkout stores a purchase request instead. To go live, implement `PaymentProvider` for the
 * provider the business holds a merchant account with (a hosted checkout from Stripe, Network
 * International, Checkout.com, Tap, …) and return it below when its server-side secrets are set.
 *
 * - Hosted checkout only. Card data never touches this server.
 * - Secrets live in server-only environment variables (never NEXT_PUBLIC_*).
 * - An order counts as paid only after a verified provider event (webhook signature checked), never
 *   because of a redirect. The database applies each event ID once (payments_apply_event).
 * - Refunds go back through the provider against the original payment. They stay pending until the
 *   provider confirms them.
 * - Start in the provider's test mode.
 *
 * The "test" provider below exists for the local test stack only. It is refused on any Vercel
 * deployment.
 */

/** What a provider event means for us; anything else in a webhook is acknowledged and ignored. */
export type ProviderEvent =
  | { id: string; type: "payment_succeeded"; sessionId: string; amount: number; currency: string; paymentRef?: string; occurredAt?: string }
  | { id: string; type: "payment_failed"; sessionId: string; failureReason?: string; occurredAt?: string }
  | { id: string; type: "session_expired"; sessionId: string; occurredAt?: string }
  | { id: string; type: "refund_succeeded"; refundRef: string; amount: number; currency: string; occurredAt?: string }
  | { id: string; type: "refund_failed"; refundRef: string; failureReason?: string; occurredAt?: string };

export interface CheckoutLine {
  name: string;
  quantity: number;
  /** In the order's currency, as stored (e.g. 50000.00 AED). Providers convert to minor units. */
  unitAmount: number;
}

export interface PaymentProvider {
  /** Stored with each payment (payments.provider). */
  name: string;
  createCheckoutSession(input: {
    paymentId: string;
    reference: string;
    lines: CheckoutLine[];
    amount: number;
    currency: string;
    customerEmail?: string | null;
    successUrl: string;
    cancelUrl: string;
    expiresAt: string;
  }): Promise<{ sessionId: string; redirectUrl: string; expiresAt?: string }>;
  /** Must verify the signature and throw on failure. Returns the events it carries that we act on. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<ProviderEvent[]>;
  /** Asks the provider to refund part or all of a captured payment. Pending until the provider's event. */
  createRefund(input: { paymentRef: string; amount: number; currency: string; idempotencyKey: string; reference: string }): Promise<{ refundRef: string }>;
}

function env(name: string) {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/**
 * Local test provider: "pays" instantly (the redirect goes straight to the order page) and accepts
 * webhooks signed with PAYMENTS_TEST_SECRET (HMAC-SHA256 of the raw body, hex, in x-test-signature).
 * The tests send those webhooks themselves, as a provider would.
 */
function testProvider(secret: string): PaymentProvider {
  return {
    name: "test",
    async createCheckoutSession({ paymentId, successUrl, expiresAt }) {
      return { sessionId: `cs_test_${paymentId}`, redirectUrl: successUrl, expiresAt };
    },
    async verifyWebhook(rawBody, headers) {
      const given = headers.get("x-test-signature") ?? "";
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new Error("bad_signature");
      const body = JSON.parse(rawBody) as { events?: ProviderEvent[] };
      return Array.isArray(body.events) ? body.events : [];
    },
    async createRefund({ idempotencyKey }) {
      return { refundRef: `re_test_${idempotencyKey}` };
    },
  };
}

export function getPaymentProvider(): PaymentProvider | null {
  const secret = env("PAYMENTS_TEST_SECRET");
  if (env("PAYMENTS_TEST_PROVIDER") === "true" && secret && secret.length >= 32 && process.env.VERCEL_ENV === undefined) {
    return testProvider(secret);
  }
  return null;
}
