import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseWriteConfig } from "@/lib/supabase";
import { en } from "@/i18n/dictionaries/en";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function sameOrigin(request: Request) {
  try {
    return new URL(request.headers.get("origin") ?? "").host === new URL(request.url).host;
  } catch {
    return false;
  }
}

const fail = (status: number, error: string, code?: string) => NextResponse.json({ error, ...(code ? { code } : {}) }, { status });

/**
 * Adds an address to the newsletter list (footer form). The visitor's consent is recorded with the
 * exact wording shown next to the Join button. Signing up twice is not an error and does not reveal
 * whether the address was already on the list. Writes only on the production deployment; previews
 * and local development answer 503.
 */
export async function POST(request: Request) {
  const db = supabaseWriteConfig();
  if (!db) return fail(503, "Signing up isn’t available here.", "newsletter_unavailable");

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
  if (typeof body.website === "string" && body.website.trim()) return fail(400, "Invalid request.");

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length < 6 || email.length > 254 || !EMAIL.test(email)) return fail(400, "Enter a valid email address.", "invalid_email");
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";

  // Salted hash of the client IP for per-sender rate limiting; the raw IP is never stored.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const clientHash = createHmac("sha256", db.key).update(ip).digest("hex");

  let res: Response;
  try {
    res = await fetch(`${db.url}/rest/v1/newsletter_subscribers?on_conflict=email`, {
      method: "POST",
      headers: { apikey: db.key, "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        email,
        name: name || null,
        consent_text: en.ui.footer.newsletter.consent,
        client_hash: clientHash,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return fail(502, "We couldn’t add you just now. Please try again later.");
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    if (err?.message === "rate_limited") return fail(429, "Too many sign-ups. Please try again later.", "rate_limited");
    console.error(`[newsletter] insert failed with HTTP ${res.status}`);
    return fail(502, "We couldn’t add you just now. Please try again later.");
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
