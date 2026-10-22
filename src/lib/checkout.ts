import "server-only";
import { findItem, getCatalog, isGenuine } from "@/lib/catalog";
import { findVariant, formatAED, isPurchasable, maxQuantity, unitPrice, unitStock } from "@/lib/format";
import { isEmail, parsePhone } from "@/lib/concierge/phone";
import { variantText } from "@/lib/whatsapp";

/** `message` is English for logs; the site shows its own wording for `code` in the visitor's language. */
export type IssueCode = "not_found" | "not_for_sale" | "demo_item" | "insufficient_stock" | "invalid_quantity" | "choose_version";
export type Issue = { ref: string; sku?: string; code: IssueCode; message: string; max?: number };

export interface VerifiedLine {
  ref: string;
  sku?: string;
  brand?: string;
  name: string;
  /** "Noir · 40.5" */
  options?: string;
  qty: number;
  unitAED: number;
  lineAED: number;
}

export const MAX_LINES = 20;

/**
 * Checks a bag against a fresh read of the catalogue (never the cache). Only references, version
 * codes and quantities are read from the browser; prices, stock and availability come from the
 * catalogue. Being in the bag does not reserve anything.
 */
export async function verifyBag(rawLines: unknown): Promise<{ ok: true; lines: VerifiedLine[]; subtotalAED: number; subtotalLabel: string } | { ok: false; status: 400 | 409; issues?: Issue[]; error: string }> {
  if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > MAX_LINES) return { ok: false, status: 400, error: "Your bag is empty." };
  const catalog = await getCatalog({ fresh: true });
  const issues: Issue[] = [];
  const lines: VerifiedLine[] = [];
  const seen = new Set<string>();
  for (const entry of rawLines) {
    const ref = typeof entry?.ref === "string" ? entry.ref.slice(0, 40) : "";
    const sku = typeof entry?.sku === "string" && entry.sku ? entry.sku.slice(0, 48) : undefined;
    const qty = Number(entry?.qty);
    const item = findItem(catalog, ref);
    if (!item) {
      issues.push({ ref, sku, code: "not_found", message: "This piece is no longer listed." });
      continue;
    }
    if (item.demo) {
      issues.push({ ref: item.ref, sku, code: "demo_item", message: "Demo records cannot be purchased." });
      continue;
    }
    const variant = findVariant(item, sku);
    if (sku && !variant) {
      issues.push({ ref: item.ref, sku, code: "not_found", message: "This version is no longer listed." });
      continue;
    }
    if (item.variants?.length && !variant) {
      issues.push({ ref: item.ref, code: "choose_version", message: "Choose a colour or size for this piece." });
      continue;
    }
    if (!isGenuine(item) || !isPurchasable(item, variant)) {
      const message = item.status === "sold" ? "This piece has been sold." : item.status === "reserved" ? "This piece is reserved." : "This piece is not available for online purchase.";
      issues.push({ ref: item.ref, sku, code: "not_for_sale", message });
      continue;
    }
    const key = `${item.ref}|${variant?.sku ?? ""}`.toUpperCase();
    const max = maxQuantity(item, variant);
    if (seen.has(key) || !Number.isInteger(qty) || qty < 1 || qty > max) {
      issues.push({ ref: item.ref, sku, code: "invalid_quantity", message: `Only ${max} can be ordered.`, max });
      continue;
    }
    seen.add(key);
    if ((unitStock(item, variant) ?? 0) < qty) {
      issues.push({ ref: item.ref, sku, code: "insufficient_stock", message: "Not enough stock for this quantity." });
      continue;
    }
    const unit = unitPrice(item, variant)!;
    lines.push({ ref: item.ref, sku: variant?.sku, brand: item.brand, name: item.name, options: variantText(variant) || undefined, qty, unitAED: unit, lineAED: unit * qty });
  }
  if (issues.length) return { ok: false, status: 409, issues, error: "Some pieces in your bag need attention." };
  const subtotalAED = lines.reduce((s, l) => s + l.lineAED, 0);
  return { ok: true, lines, subtotalAED, subtotalLabel: formatAED(subtotalAED) };
}

export function sameOrigin(request: Request) {
  try {
    return new URL(request.headers.get("origin") ?? "").host === new URL(request.url).host;
  } catch {
    return false;
  }
}

const COUNTRY = /^[A-Z]{2}$/;
const IDEM = /^[A-Za-z0-9-]{16,64}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The customer, delivery and consent fields of a checkout submission, checked on the server. */
export function parseCheckoutDetails(body: Record<string, unknown>) {
  const c = (body.customer ?? {}) as Record<string, unknown>;
  const d = (body.delivery ?? {}) as Record<string, unknown>;
  const name = str(c.name, 80);
  const email = str(c.email, 254).toLowerCase();
  const method: "whatsapp" | "call" | "email" = c.method === "call" || c.method === "email" ? c.method : "whatsapp";
  const phone = parsePhone(str(c.phone, 30));
  const mode: "deliver" | "collect" = d.mode === "collect" ? "collect" : "deliver";
  const country = str(d.country, 2).toUpperCase();
  const city = str(d.city, 80);
  const address = str(d.address, 300);
  const notes = str(d.notes, 600);
  const idem = str(body.idempotencyKey, 64);

  const fields: string[] = [];
  if (!name) fields.push("name");
  if (!phone.ok) fields.push("phone");
  if (email && !isEmail(email)) fields.push("email");
  if (method === "email" && !email) fields.push("emailNeeded");
  if (mode === "deliver") {
    if (!COUNTRY.test(country)) fields.push("country");
    if (!city) fields.push("city");
    if (!address) fields.push("address");
  }
  if (body.consent !== true) fields.push("consent");
  if (!IDEM.test(idem)) fields.push("invalid_request");
  if (fields.length || !phone.ok) return { ok: false as const, fields };
  return { ok: true as const, name, email, method, phone: phone.phone.e164, mode, country, city, address, notes, idem };
}
