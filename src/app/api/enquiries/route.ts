import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseWriteConfig } from "@/lib/supabase";
import { sourcingMessage, viewingMessage, type SourcingRequest, type ViewingRequest } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_000;
const REF_PATTERN = /^[A-Za-z0-9-]{2,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s()-]{7,20}$/;

const methods = { WhatsApp: "whatsapp", "Phone call": "phone", Email: "email" } as const;
type Method = keyof typeof methods;

const sourcingFields = ["category", "brand", "model", "details", "budget", "timing", "name"] as const;
const viewingFields = ["interest", "date", "timeOfDay", "name", "notes"] as const;

function pickStrings<K extends string>(src: unknown, keys: readonly K[], max = 600) {
  const out: Partial<Record<K, string>> = {};
  if (!src || typeof src !== "object") return out;
  for (const k of keys) {
    const v = (src as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, max);
  }
  return out;
}

function sameOrigin(request: Request) {
  try {
    return new URL(request.headers.get("origin") ?? "").host === new URL(request.url).host;
  } catch {
    return false;
  }
}

const fail = (status: number, error: string, code?: string) => NextResponse.json({ error, ...(code ? { code } : {}) }, { status });

/**
 * Stores an enquiry the customer chose to send from the website (not the WhatsApp/email hand-off,
 * which the customer sends themselves and which therefore creates no record).
 * Writes only on the production deployment; previews and local development answer 503.
 */
export async function POST(request: Request) {
  const db = supabaseWriteConfig();
  if (!db) return fail(503, "Sending from the website isn’t available here. Please use WhatsApp or email.", "enquiries_unavailable");

  // Same-origin browser submissions only.
  if (!sameOrigin(request)) return fail(403, "Invalid request.");

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, "Request too large.");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "Invalid request.");
  }
  if (!body || typeof body !== "object") return fail(400, "Invalid request.");

  // Honeypot: real visitors never see or fill this field.
  if (typeof body.website === "string" && body.website.trim()) return fail(400, "Your request could not be sent.");

  const kind = body.kind === "sourcing" || body.kind === "viewing" ? body.kind : null;
  if (!kind) return fail(400, "Invalid request.");

  const methodLabel = typeof body.contactMethod === "string" && body.contactMethod in methods ? (body.contactMethod as Method) : null;
  const contactValue = typeof body.contactValue === "string" ? body.contactValue.trim().slice(0, 120) : "";
  if (!methodLabel) return fail(400, "Choose how we should reply.");
  if (methodLabel === "Email" ? !EMAIL.test(contactValue) : !PHONE.test(contactValue)) {
    return fail(400, methodLabel === "Email" ? "Enter a valid email address." : "Enter a valid phone number, including country code.", "invalid_contact");
  }

  const relatedRef = typeof body.relatedRef === "string" && REF_PATTERN.test(body.relatedRef) ? body.relatedRef : undefined;
  let details: Record<string, string>;
  let message: string;
  if (kind === "sourcing") {
    const r: SourcingRequest = { ...pickStrings(body.request, sourcingFields), relatedRef, contactMethod: methodLabel, contactValue };
    if (!r.category || !(r.brand || r.model || r.details)) return fail(400, "Tell us the category and a few details about the piece.");
    details = pickStrings(body.request, sourcingFields);
    message = sourcingMessage(r);
  } else {
    const r: ViewingRequest = { ...pickStrings(body.request, viewingFields), relatedRef };
    if (!r.interest) return fail(400, "Tell us which piece you’d like to see, or that you’d like a consultation.");
    details = pickStrings(body.request, viewingFields);
    message = viewingMessage(r);
  }

  // Salted hash of the client IP for per-sender rate limiting; the raw IP is never stored.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const clientHash = createHmac("sha256", db.key).update(ip).digest("hex");

  let res: Response;
  try {
    res = await fetch(`${db.url}/rest/v1/enquiries?select=reference`, {
      method: "POST",
      headers: { apikey: db.key, "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify({
        kind,
        item_ref: relatedRef ?? null,
        name: details.name?.slice(0, 80) ?? null,
        contact_method: methods[methodLabel],
        contact_value: contactValue,
        message: message.slice(0, 4000),
        details,
        client_hash: clientHash,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return fail(502, "We couldn’t send your request just now. Please use WhatsApp or email.");
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    if (err?.message === "rate_limited") return fail(429, "Too many requests. Please try again later, or use WhatsApp.", "rate_limited");
    console.error(`[enquiries] insert failed with HTTP ${res.status}`);
    return fail(502, "We couldn’t send your request just now. Please use WhatsApp or email.");
  }
  const [row] = (await res.json()) as { reference: string }[];
  if (!row?.reference) return fail(502, "We couldn’t confirm your request. Please use WhatsApp or email.");
  return NextResponse.json({ reference: row.reference }, { status: 201 });
}
