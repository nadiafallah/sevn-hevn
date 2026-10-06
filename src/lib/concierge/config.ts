import "server-only";
import { createHmac } from "node:crypto";

/**
 * Server-only settings for the concierge chat, the panel and notifications. Every value comes from
 * environment variables (Vercel → Settings → Environment Variables); see .env.example.
 * Nothing here is ever sent to the browser.
 */

function env(name: string) {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function supabaseApi() {
  const url = env("SUPABASE_URL")?.replace(/\/+$/, "");
  const key = env("SUPABASE_PUBLISHABLE_KEY");
  return url && key ? { url, key } : null;
}

/**
 * The concierge writes customer data, so it runs only where its dedicated server key is set
 * (Vercel Production). Previews and local development show the chat as unavailable, unless a
 * local test stack explicitly opts in with CONCIERGE_ALLOW_NON_PRODUCTION=true.
 */
export function conciergeServer() {
  const api = supabaseApi();
  const serverKey = env("CONCIERGE_SERVER_KEY");
  const allowed = process.env.VERCEL_ENV === "production" || (process.env.VERCEL_ENV === undefined && env("CONCIERGE_ALLOW_NON_PRODUCTION") === "true");
  if (!api || !serverKey || serverKey.length < 32 || !allowed) return null;
  return { ...api, serverKey };
}

/** Salted hash of the client IP for rate limiting; the raw IP is never stored. */
export function clientHash(request: Request, secret: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHmac("sha256", secret).update(`ip:${ip}`).digest("hex");
}

export function emailConfig() {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const password = env("SMTP_PASSWORD");
  const to = env("NOTIFY_EMAIL_TO");
  if (!host || !user || !password || !to) return null;
  const port = Number(env("SMTP_PORT") ?? "465");
  const p = Number.isInteger(port) && port > 0 ? port : 465;
  // "implicit" TLS on 465, otherwise STARTTLS is required. "off" exists only for the local test
  // stack and is refused on the production deployment.
  const tlsSetting = env("SMTP_TLS");
  const tls: "implicit" | "starttls" | "off" =
    tlsSetting === "off" && process.env.VERCEL_ENV !== "production" ? "off" : tlsSetting === "starttls" ? "starttls" : tlsSetting === "implicit" || p === 465 ? "implicit" : "starttls";
  return {
    host,
    port: p,
    tls,
    user,
    password,
    to,
    from: env("NOTIFY_EMAIL_FROM") ?? `SEVN HEVN <${user}>`,
  };
}

export function whatsappConfig() {
  const token = env("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const to = env("WHATSAPP_NOTIFY_TO");
  const template = env("WHATSAPP_TEMPLATE_NAME");
  if (!token || !phoneNumberId || !to || !template) return null;
  return {
    token,
    phoneNumberId,
    to: to.replace(/[^\d]/g, ""),
    template,
    templateLanguage: env("WHATSAPP_TEMPLATE_LANG") ?? "en",
    graphVersion: env("WHATSAPP_GRAPH_VERSION") ?? "v26.0",
  };
}

export function aiConfig() {
  if (env("CONCIERGE_AI_ENABLED") !== "true") return null;
  const provider = env("CONCIERGE_AI_PROVIDER") ?? "anthropic";
  const apiKey = env("ANTHROPIC_API_KEY");
  if (provider !== "anthropic" || !apiKey) return null;
  const int = (name: string, fallback: number) => {
    const n = Number(env(name));
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    provider,
    apiKey,
    model: env("CONCIERGE_AI_MODEL") ?? "claude-opus-5-5",
    perConversation: int("CONCIERGE_AI_PER_CONVERSATION", 6),
    perDay: int("CONCIERGE_AI_PER_DAY", 300),
    timeoutMs: int("CONCIERGE_AI_TIMEOUT_MS", 15000),
  };
}

/** Which notification channels can actually send right now. */
export function configuredChannels(): ("email" | "whatsapp")[] {
  return [...(emailConfig() ? (["email"] as const) : []), ...(whatsappConfig() ? (["whatsapp"] as const) : [])];
}
