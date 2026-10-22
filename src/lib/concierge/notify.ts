import "server-only";
import nodemailer from "nodemailer";
import { site } from "@/config/site";
import { configuredChannels, conciergeServer, emailConfig, whatsappConfig } from "./config";
import { rpc } from "./db";
import { newOrderToken, orderLink, tokenHash } from "@/lib/orders/server";

/**
 * Notifications: team alerts for new requests and for order events, and (once the owner switches them
 * on in Settings) short e-mails to customers about their order. The record is always saved first;
 * this outbox then tries to send. A failure never loses anything: the row keeps its status (sent /
 * failed / not configured), is retried with backoff, and can be retried by hand.
 *
 * Team messages are short and link to the private panel. They contain no customer name, phone number,
 * e-mail address or photos. Customer e-mails say what changed and link to the customer's private
 * order page (a fresh link each time); the details are on that page, not in the e-mail.
 */

interface Claimed {
  id: string;
  channel: "email" | "whatsapp";
  attempts: number;
  template: string;
  recipient: "team" | "customer";
  request: {
    id: string;
    reference: string;
    type: string;
    locale: string;
    needs_review: string | null;
    destination_label: string | null;
    created_at: string;
    is_test: boolean;
  } | null;
  order: {
    id: string;
    reference: string;
    status: string;
    payment_status: string;
    fulfilment_status: string;
    total_amount: string | null;
    currency: string;
    customer_name: string | null;
    is_test: boolean;
    email: string | null;
  } | null;
  return: { reference: string; status: string; reason: string; decision_reason: string | null; support_path: string | null } | null;
}

const TYPE: Record<string, string> = { sourcing: "Find a piece", question: "Question", order_followup: "Order follow-up", callback: "Call back", purchase: "Purchase request (website checkout, not paid)" };

/** What happened, for the team. */
const TEAM_ORDER: Record<string, string> = {
  checkout_started: "Online checkout started (waiting for payment)",
  order_confirmed: "Order confirmed",
  stock_conflict: "Paid, but a piece is no longer in stock: source it or cancel and refund",
  payment_discrepancy: "A payment event needs checking",
  supplier_failed: "The supplier can’t deliver",
  check_failed: "A quality check failed",
  shipment_exception: "Delivery problem",
  return_requested: "Return requested",
  return_inspected: "Return inspected: decide the outcome",
  refund_failed: "Refund failed",
  quote_accepted: "Quote accepted by the customer",
  cancellation_requested: "The customer asks to cancel",
  customer_message: "New message from the customer",
};

/** Customer e-mails: subject and one plain sentence. Sent only when the owner has switched them on. */
const CUSTOMER: Record<string, (ref: string, ret: string) => { subject: string; text: string }> = {
  order_confirmed: (ref) => ({ subject: `Your order ${ref} is confirmed`, text: "Thank you. We have received your payment and confirmed your order." }),
  order_shipped: (ref) => ({ subject: `Your order ${ref} is on its way`, text: "Your order has been handed to the carrier. The tracking details are on your order page." }),
  order_delivered: (ref) => ({ subject: `Your order ${ref} has been delivered`, text: "The carrier has confirmed delivery. If anything isn’t right, you can tell us from your order page." }),
  order_cancelled: (ref) => ({ subject: `Your order ${ref} has been cancelled`, text: "Your order has been cancelled. If you have paid, your order page shows the refund once it has been sent." }),
  order_update: (ref) => ({ subject: `An update on your order ${ref}`, text: "Our team has posted an update on your order." }),
  refund_completed: (ref) => ({ subject: `Your refund for order ${ref}`, text: "Your refund has been completed. The amount is shown on your order page." }),
  return_approved: (_, ret) => ({ subject: `Your return ${ret} is approved`, text: "We have approved your return request. The next steps are on your order page." }),
  return_rejected: (_, ret) => ({ subject: `About your return request ${ret}`, text: "We have reviewed your return request. Our decision, the reason and how to ask for a review are on your order page." }),
  return_resolved: (_, ret) => ({ subject: `Your return ${ret} is complete`, text: "Your return is complete. The outcome is on your order page." }),
};

const isTest = (n: Claimed) => !!(n.request?.is_test || n.order?.is_test);
const label = (n: Claimed) => n.request?.reference ?? n.order?.reference ?? n.id;

function panelLink(n: Claimed) {
  return n.request ? `${site.url}/admin/requests/${n.request.id}` : `${site.url}/admin/orders/${n.order!.id}`;
}

function summaryLines(n: Claimed) {
  const test = isTest(n) ? "[TEST] " : "";
  if (n.request && n.template === "new_request") {
    const r = n.request;
    const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }).format(new Date(r.created_at));
    return [
      `${test}New ${r.type === "purchase" ? "purchase" : "concierge"} request ${r.reference}`,
      `Type: ${TYPE[r.type] ?? r.type}`,
      ...(r.needs_review ? [`Needs your confirmation: ${r.needs_review}`] : []),
      ...(r.destination_label ? [`Destination: ${r.destination_label}`] : []),
      `Received: ${when} (Dubai)`,
    ];
  }
  const o = n.order!;
  return [
    `${test}Order ${o.reference}: ${TEAM_ORDER[n.template] ?? n.template}`,
    ...(n.return ? [`Return ${n.return.reference}`] : []),
    `Order: ${o.status} · Payment: ${o.payment_status} · Delivery: ${o.fulfilment_status}`,
  ];
}

const subjectOf = (n: Claimed) =>
  n.request && n.template === "new_request"
    ? `${isTest(n) ? "[TEST] " : ""}New request ${n.request.reference} · ${TYPE[n.request.type] ?? n.request.type}`
    : `${isTest(n) ? "[TEST] " : ""}Order ${n.order!.reference} · ${TEAM_ORDER[n.template] ?? n.template}`;

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
  const lines = summaryLines(n);
  const link = panelLink(n);
  const info = await transport(cfg).sendMail({
    from: cfg.from,
    to: cfg.to,
    subject: subjectOf(n),
    text: [...lines, "", `Open in the private panel: ${link}`, "", "Customer details are in the panel only."].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2a1c16">${lines.map((l) => `<p style="margin:0 0 6px">${escapeHtml(l)}</p>`).join("")}<p style="margin:16px 0"><a href="${escapeHtml(link)}" style="color:#2a1c16">Open in the private panel</a></p><p style="margin:0;color:#6b5e55;font-size:12px">Customer details are in the panel only.</p></div>`,
  });
  return String(info.messageId ?? "");
}

/** A short e-mail to the customer, with a fresh private link to their order page. */
async function sendCustomerEmail(n: Claimed, db: NonNullable<ReturnType<typeof conciergeServer>>): Promise<string> {
  const cfg = emailConfig();
  if (!cfg) throw new Error("not_configured");
  const o = n.order;
  const make = CUSTOMER[n.template];
  if (!o?.email || !make) throw new Error("no_template");
  const token = newOrderToken();
  await rpc(db, "concierge_issue_customer_link", { p_key: db.serverKey, p_notification: n.id, p_token_hash: tokenHash(token) });
  const link = orderLink(token);
  const { subject, text } = make(o.reference, n.return?.reference ?? "");
  const greeting = o.customer_name ? `Dear ${o.customer_name},` : "Hello,";
  const footer = `SEVN HEVN · ${site.contact.phoneDisplay} · ${site.url}`;
  const info = await transport(cfg).sendMail({
    from: cfg.from,
    to: o.email,
    replyTo: cfg.to,
    subject: `${isTest(n) ? "[TEST] " : ""}${subject}`,
    text: [greeting, "", text, "", `Your order page: ${link}`, "This private link is for you only. Please don’t forward it.", "", footer].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2a1c16"><p>${escapeHtml(greeting)}</p><p>${escapeHtml(text)}</p><p style="margin:16px 0"><a href="${escapeHtml(link)}" style="color:#2a1c16">Open your order page</a></p><p style="color:#6b5e55;font-size:12px">This private link is for you only. Please don’t forward it.</p><p style="color:#6b5e55;font-size:12px">${escapeHtml(footer)}</p></div>`,
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
        components: [{ type: "body", parameters: [{ type: "text", text: label(n) }, { type: "text", text: panelLink(n) }] }],
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
    // Rows claimed before the order lifecycle migration carry no template: they are request alerts.
    n.template ??= "new_request";
    n.recipient ??= "team";
    let status: "sent" | "failed" = "sent";
    let error: string | null = null;
    let providerId: string | null = null;
    try {
      providerId = n.recipient === "customer" ? await sendCustomerEmail(n, db) : n.channel === "email" ? await sendEmail(n) : await sendWhatsApp(n);
    } catch (e) {
      status = "failed";
      error = safeError(e);
      console.error(`[notify] ${n.channel} for ${label(n)} failed: ${error}`);
    }
    await rpc(db, "concierge_finish_notification", { p_key: db.serverKey, p_id: n.id, p_status: status, p_error: error, p_provider_id: providerId }).catch(() => {
      console.error(`[notify] could not record the result for ${label(n)}`);
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
