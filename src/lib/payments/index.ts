import "server-only";

/**
 * Payment integration boundary.
 *
 * No payment provider is configured, so `getPaymentProvider()` returns null and checkout
 * reports a truthful "unavailable" state. To go live, implement `PaymentProvider` for a
 * supported provider (e.g. a hosted checkout from Stripe, Checkout.com, Network International
 * or Tap — whichever the business holds a merchant account with) and return it below when
 * its server-side secrets are present. Requirements (see README → "Payments"):
 *
 * - Hosted / tokenised checkout only. Card data never touches this server.
 * - Secrets live in server-only environment variables (never NEXT_PUBLIC_*).
 * - Paid status is set ONLY from a verified webhook event (signature checked), never from a
 *   redirect query string.
 * - Webhook processing is idempotent: store processed event IDs and ignore duplicates.
 * - Reserve stock when a session is created (with expiry) and release it on cancel/expiry,
 *   so two clients cannot both pay for a one-off piece.
 * - Use test mode first.
 */

export interface CheckoutLine {
  ref: string;
  name: string;
  quantity: number;
  unitAmountAED: number;
}

export interface PaymentProvider {
  name: string;
  createCheckoutSession(input: {
    lines: CheckoutLine[];
    totalAED: number;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ redirectUrl: string; sessionId: string }>;
  /** Must verify the signature and throw on failure. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<{ id: string; type: string; sessionId?: string }>;
}

export function getPaymentProvider(): PaymentProvider | null {
  return null;
}
