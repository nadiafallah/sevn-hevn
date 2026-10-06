import "server-only";
import { NextResponse } from "next/server";
import { DbError } from "./db";
import { ConciergeError } from "./service";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;
export const MSG_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** Browser requests from this site only. */
export function sameOrigin(request: Request) {
  try {
    return new URL(request.headers.get("origin") ?? "").host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** Maps internal failures to a small set of codes the chat explains in the customer's language. */
export function failure(e: unknown) {
  if (e instanceof ConciergeError) return json({ error: e.code }, e.status);
  if (e instanceof DbError) {
    // Database objects not installed yet (one-time setup pending): say so honestly.
    if (e.status === 404 && e.code === "db_error") return json({ error: "unavailable" }, 503);
    const map: Record<string, number> = {
      rate_limited: 429, conversation_not_found: 404, conversation_too_long: 409, photo_limit: 409, unreachable: 503, invalid_request: 400, not_authorized: 503,
    };
    if (map[e.code]) return json({ error: e.code }, map[e.code]);
  }
  console.error("[concierge] request failed", e instanceof Error ? e.message.slice(0, 120) : "");
  return json({ error: "server_error" }, 500);
}
