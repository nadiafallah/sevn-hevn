import { timingSafeEqual } from "node:crypto";
import { conciergeServer } from "@/lib/concierge/config";
import { rpc } from "@/lib/concierge/db";
import { processNotifications } from "@/lib/concierge/notify";
import { submitApprovedRefunds } from "@/lib/orders/server";

export const dynamic = "force-dynamic";

/**
 * Daily safety net (Vercel Cron, see vercel.json): retries notifications that failed or were waiting
 * for a channel to be connected, tidies expired stock holds (they already stopped counting), and
 * sends approved refunds that didn't reach the payment provider. New requests and order events are
 * normally handled within seconds.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = conciergeServer();
  const housekeeping = db ? await rpc<{ released_holds: number }>(db, "shop_housekeeping", { p_key: db.serverKey }).catch(() => null) : null;
  const refunds = await submitApprovedRefunds().catch(() => ({ submitted: 0 }));
  const { processed } = await processNotifications();
  return Response.json({ processed, releasedHolds: housekeeping?.released_holds ?? null, refundsSubmitted: refunds.submitted });
}
