import { NextResponse } from "next/server";
import { verifyBag } from "@/lib/checkout";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_000;

/**
 * Re-checks the bag against the catalogue for the checkout page: prices, stock and versions come from
 * the server, never from the browser. Nothing is reserved or charged here.
 *
 * Online payment: no provider is connected (lib/payments). When one is, it must start from a
 * purchase stored by /api/purchase-request and mark it paid only from a verified webhook.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const result = await verifyBag((body as { items?: unknown })?.items);
  if (!result.ok) return NextResponse.json({ error: result.error, ...(result.issues ? { issues: result.issues } : {}) }, { status: result.status });
  return NextResponse.json({ lines: result.lines, subtotalAED: result.subtotalAED, subtotalLabel: result.subtotalLabel });
}
