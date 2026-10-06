import { timingSafeEqual } from "node:crypto";
import { processNotifications } from "@/lib/concierge/notify";

export const dynamic = "force-dynamic";

/**
 * Daily safety net (Vercel Cron, see vercel.json): retries team notifications that failed or were
 * waiting for a channel to be connected. New requests are normally notified within seconds.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { processed } = await processNotifications();
  return Response.json({ processed });
}
