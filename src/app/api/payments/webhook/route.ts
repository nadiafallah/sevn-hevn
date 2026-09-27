import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * Payment provider webhook. Inactive until a provider is configured.
 * When activated: verify the signature, record the event ID to ignore duplicates,
 * then mark the order paid and decrement stock inside one transaction.
 */
export async function POST(request: Request) {
  const provider = getPaymentProvider();
  if (!provider) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  }
  const raw = await request.text();
  try {
    await provider.verifyWebhook(raw, request.headers);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  // Order persistence is required before this can be enabled — see README → "Payments".
  return NextResponse.json({ error: "Order processing is not implemented." }, { status: 501 });
}
