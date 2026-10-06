import "server-only";
import nodemailer from "nodemailer";
import { site } from "@/config/site";
import { configuredChannels, conciergeServer, emailConfig, whatsappConfig } from "./config";
import { rpc } from "./db";

/**
 * Team notifications for new requests. The request is always saved first; this outbox then tries
 * to tell the team. A failure never loses the request: it stays in the panel with its notification
 * status (sent / failed / not configured), is retried with backoff, and can be retried by hand.
 *
 * Messages are short and link to the private panel. They contain no customer name, phone number,
 * e-mail address or photos.
 */

interface Claimed {
  id: string;
  channel: "email" | "whatsapp";
  attempts: number;
  request: {
    id: string;
    reference: string;
    type: string;
    locale: string;
    needs_review: string | null;
    destination_label: string | null;
    created_at: string;
    is_test: boolean;
  };
}

const TYPE: Record<string, string> = { sourcing: "Find a piece", question: "Question", order_followup: "Order follow-up", callback: "Call back" };

function panelLink(id: string) {
  return `${site.url}/admin/requests/${id}`;
}

function summaryLines(r: Claimed["request"]) {
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }).format(new Date(r.created_at));
  return [
    `${r.is_test ? "[TEST] " : ""}New concierge request ${r.reference}`,
    `Type: ${TYPE[r.type] ?? r.type}`,
    `Language: ${r.locale === "ar" ? "Arabic" : "English"}`,
    ...(r.needs_review ? [`Needs your confirmation: ${r.needs_review}`] : []),
    ...(r.destination_label ? [`Destination: ${r.destination_label}`] : []),
    `Received: ${when} (Dubai)`,
  ];
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function transport(cfg: NonNullable<ReturnType<typeof emailConfig>>) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.tls === "implicit",
    requireTLS: cfg.tls === "starttls",
    ignoreTLS: cfg.tls === "off",
    auth: { user: cfg.user, pass: cfg.password },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
}

async function sendEmail(n: Claimed): Promise<string> {
  const cfg = emailConfig();
  if (!cfg) throw new Error("not_configured");
  const lines = summaryLines(n.request);
  const link = panelLink(n.request.id);
  const info = await transport(cfg).sendMail({
    from: cfg.from,
    to: cfg.to,
    subject: `${n.request.is_test ? "[TEST] " : ""}New request ${n.request.reference} · ${TYPE[n.request.type] ?? n.request.type}`,
    text: [...lines, "", `Open in the private panel: ${link}`, "", "Customer details are in the panel only."].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2a1c16">${lines.map((l) => `<p style="margin:0 0 6px">${escapeHtml(l)}</p>`).join("")}<p style="margin:16px 0"><a href="${escapeHtml(link)}" style="color:#2a1c16">Open in the private panel</a></p><p style="margin:0;color:#6b5e55;font-size:12px">Customer details are in the panel only.</p></div>`,
  });
  return String(info.messageId ?? "");
}

async function sendWhatsApp(n: Claimed): Promise<string> {
  const cfg = whatsappConfig();
  if (!cfg) throw new Error("not_configured");
  // An approved "utility" template with two body parameters: {{1}} reference, {{2}} panel link.
  const res = await fetch(`https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: cfg.to,
      type: "template",
      template: {
        name: cfg.template,
        language: { code: cfg.templateLanguage },
        components: [{ type: "body", parameters: [{ type: "text", text: n.request.reference }, { type: "text", text: panelLink(n.request.id) }] }],
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => null)) as { messages?: { id: string }[]; error?: { code?: number; message?: string } } | null;
  if (!res.ok || !data?.messages?.[0]?.id) {
    throw new Error(`WhatsApp API ${res.status}${data?.error?.code ? ` (code ${data.error.code})` : ""}`);
  }
  return data.messages[0].id;
}

function safeError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  // Keep provider codes, drop anything that could echo credentials.
  return msg.replace(/(pass(word)?|token|key)[^\s,;]*/gi, "[redacted]").slice(0, 300);
}

/** Sends pending notifications (all, or the given ids). Safe to call concurrently: rows are claimed once. */
export async function processNotifications(ids?: string[]) {
  const db = conciergeServer();
  if (!db) return { processed: 0 };
  const claimed = await rpc<Claimed[]>(db, "concierge_claim_notifications", {
    p_key: db.serverKey,
    p_configured: configuredChannels(),
    p_ids: ids ?? null,
    p_limit: 10,
  });
  for (const n of claimed) {
    let status: "sent" | "failed" = "sent";
    let error: string | null = null;
    let providerId: string | null = null;
    try {
      providerId = n.channel === "email" ? await sendEmail(n) : await sendWhatsApp(n);
    } catch (e) {
      status = "failed";
      error = safeError(e);
      console.error(`[notify] ${n.channel} for ${n.request.reference} failed: ${error}`);
    }
    await rpc(db, "concierge_finish_notification", { p_key: db.serverKey, p_id: n.id, p_status: status, p_error: error, p_provider_id: providerId }).catch(() => {
      console.error(`[notify] could not record the result for ${n.request.reference}`);
    });
  }
  return { processed: claimed.length };
}

/** Sends a one-time order verification code to the e-mail address the team recorded for the order. */
export async function sendOrderCode(to: string, code: string, reference: string) {
  const cfg = emailConfig();
  if (!cfg) throw new Error("not_configured");
  await transport(cfg).sendMail({
    from: cfg.from,
    to,
    subject: `Your SEVN HEVN verification code: ${code}`,
    text: [
      `Your verification code for order ${reference} is ${code}.`,
      "It expires in 10 minutes. If you didn’t ask for it, you can ignore this email.",
      "",
      `رمز التحقق الخاص بطلبك ${reference} هو ${code}.`,
      "تنتهي صلاحيته خلال 10 دقائق. إذا لم تطلبه، يمكنك تجاهل هذه الرسالة.",
      "",
      `SEVN HEVN · ${site.contact.phoneDisplay} · ${site.url}`,
    ].join("\n"),
  });
}

/** Sends a clearly marked test e-mail to the configured team address (panel → Settings, owner only). */
export async function sendTestEmail(): Promise<{ ok: boolean; error?: string }> {
  const cfg = emailConfig();
  if (!cfg) return { ok: false, error: "Email is not configured." };
  try {
    await transport(cfg).sendMail({
      from: cfg.from,
      to: cfg.to,
      subject: "[TEST] SEVN HEVN panel notification test",
      text: "This is a test message from the SEVN HEVN private panel. No customer data is included.",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }
}
