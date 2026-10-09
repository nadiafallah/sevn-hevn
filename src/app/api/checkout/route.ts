import { NextResponse } from "next/server";
import { findItem, getCatalog, isGenuine } from "@/lib/catalog";
import { formatAED, maxQuantity } from "@/lib/format";
import { getPaymentProvider, type CheckoutLine } from "@/lib/payments";
import { isLocale, localePath } from "@/i18n/config";

export const dynamic = "force-dynamic";

/** `message` is English for logs; the site shows its own wording for `code` in the visitor's language. */
type Issue = { ref: string; code: "not_found" | "not_for_sale" | "demo_item" | "insufficient_stock" | "invalid_quantity"; message: string; max?: number };

const MAX_LINES = 20;
const MAX_BODY_BYTES = 4_000;

/**
 * Revalidates the bag against the server catalogue. Browser-submitted prices and totals are
 * ignored — only refs and quantities are read. Being in the bag does not reserve an item.
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
  const rawLines = (body as { items?: unknown })?.items;
  if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > MAX_LINES) {
    return NextResponse.json({ error: "Your bag is empty." }, { status: 400 });
  }

  // Fresh read: prices and stock must never come from a cached catalogue here.
  const catalog = await getCatalog({ fresh: true });
  const issues: Issue[] = [];
  const lines: CheckoutLine[] = [];
  for (const entry of rawLines) {
    const ref = typeof entry?.ref === "string" ? entry.ref.slice(0, 40) : "";
    const qty = Number(entry?.qty);
    const item = findItem(catalog, ref);
    if (!item) {
      issues.push({ ref, code: "not_found", message: "This piece is no longer listed." });
      continue;
    }
    if (item.demo) {
      issues.push({ ref: item.ref, code: "demo_item", message: "Demo records cannot be purchased." });
      continue;
    }
    if (!isGenuine(item) || item.status !== "available" || !item.priceAED) {
      const message = item.status === "sold" ? "This piece has been sold." : item.status === "reserved" ? "This piece is reserved." : "This piece is not available for online purchase.";
      issues.push({ ref: item.ref, code: "not_for_sale", message });
      continue;
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > maxQuantity(item)) {
      issues.push({ ref: item.ref, code: "invalid_quantity", message: `Only ${maxQuantity(item)} can be ordered.`, max: maxQuantity(item) });
      continue;
    }
    if ((item.stock ?? 0) < qty) {
      issues.push({ ref: item.ref, code: "insufficient_stock", message: "Not enough stock for this quantity." });
      continue;
    }
    lines.push({ ref: item.ref, name: item.brand ? `${item.brand} ${item.name}` : item.name, quantity: qty, unitAmountAED: item.priceAED });
  }

  if (issues.length) {
    return NextResponse.json({ error: "Some pieces in your bag need attention.", issues }, { status: 409 });
  }

  const totalAED = lines.reduce((sum, l) => sum + l.unitAmountAED * l.quantity, 0);
  const provider = getPaymentProvider();
  if (!provider) {
    return NextResponse.json(
      {
        error: "Online payment is not yet available.",
        code: "payments_unavailable",
        verified: { lines, totalAED, totalLabel: formatAED(totalAED) },
      },
      { status: 503 },
    );
  }

  const origin = new URL(request.url).origin;
  const lang = (body as { locale?: unknown })?.locale;
  const collection = localePath(isLocale(lang) ? lang : "en", "/collection");
  const session = await provider.createCheckoutSession({
    lines,
    totalAED,
    successUrl: `${origin}${collection}?checkout=return`,
    cancelUrl: `${origin}${collection}?checkout=cancelled`,
    idempotencyKey: crypto.randomUUID(),
  });
  return NextResponse.json({ redirectUrl: session.redirectUrl });
}
