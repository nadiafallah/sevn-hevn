import { NextResponse, after } from "next/server";
import { conciergeServer } from "@/lib/concierge/config";
import { DbError, rpc } from "@/lib/concierge/db";
import { processNotifications } from "@/lib/concierge/notify";
import { getPaymentProvider } from "@/lib/payments";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256_000;

/**
 * Payment provider webhook. The signature is checked first; then each event goes to the database,
 * which applies an event ID only once and keeps anything unexpected as a discrepancy for the team.
 * A database failure answers 500 so the provider retries; duplicates and stale events answer 200.
 */
export async function POST(request: Request) {
  const provider = getPaymentProvider();
  const db = conciergeServer();
  if (!provider || !db) return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Too large." }, { status: 413 });
  let events;
  try {
    events = await provider.verifyWebhook(raw, request.headers);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  const outcomes: string[] = [];
  for (const ev of events) {
    try {
      const res = await rpc<{ outcome: string }>(db, "payments_apply_event", {
        p_key: db.serverKey,
        p_event: {
          provider: provider.name,
          event_id: ev.id,
          type: ev.type,
          session_id: "sessionId" in ev ? ev.sessionId : null,
          payment_ref: ev.type === "payment_succeeded" ? (ev.paymentRef ?? null) : null,
          refund_ref: "refundRef" in ev ? ev.refundRef : null,
          amount: "amount" in ev ? ev.amount : null,
          currency: "currency" in ev ? ev.currency : null,
          failure_reason: "failureReason" in ev ? (ev.failureReason ?? null) : null,
          occurred_at: ev.occurredAt ?? null,
        },
      });
      outcomes.push(res.outcome);
    } catch (e) {
      console.error(`[payments] event ${ev.type} could not be applied (${e instanceof DbError ? e.code : "error"})`);
      return NextResponse.json({ error: "Not processed." }, { status: e instanceof DbError && e.code === "invalid_request" ? 400 : 500 });
    }
  }
  after(() => processNotifications().catch(() => {}));
  return NextResponse.json({ received: outcomes.length, outcomes });
}
