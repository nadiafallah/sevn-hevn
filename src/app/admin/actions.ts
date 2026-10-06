"use server";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { site } from "@/config/site";
import { conciergeServer, supabaseApi } from "@/lib/concierge/config";
import { DbError, rpc, storageRemove } from "@/lib/concierge/db";
import { processNotifications, sendTestEmail } from "@/lib/concierge/notify";
import { isEmail } from "@/lib/concierge/phone";
import { sendRecovery, signInWithPassword, signOut, signUp, updatePassword } from "@/lib/admin/gotrue";
import { clearSessionCookies, currentStaff, requireOwner, requireStaff, setSessionCookies } from "@/lib/admin/session";
import { fromDubaiLocal, knowledgeTopics, staffSettableStatuses } from "@/lib/admin/labels";

// ── Helpers ─────────────────────────────────────────────────────────────────────────

const str = (f: FormData, k: string, max = 2000) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = (f: FormData, k = "id") => {
  const v = str(f, k, 40);
  if (!UUID.test(v)) redirect("/admin?error=invalid_request");
  return v;
};

/** Back to the page with a short flash message, keeping only safe relative paths. */
function back(path: string, flash: { ok?: string; error?: string }): never {
  const safe = path.startsWith("/admin") && !path.startsWith("//") ? path.split("?")[0] : "/admin";
  const q = new URLSearchParams(flash as Record<string, string>);
  redirect(`${safe}?${q}`);
}

function codeOf(e: unknown) {
  if (e instanceof DbError) return e.code;
  throw e;
}

async function limit(bucket: string, subject: string, max: number, windowSeconds: number) {
  const db = conciergeServer();
  if (!db) return true;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const key = createHmac("sha256", db.serverKey).update(`${bucket}:${ip}:${subject}`).digest("hex");
  try {
    await rpc(db, "concierge_rate_limit", { p_key: db.serverKey, p_bucket: bucket, p_subject: key, p_max: max, p_window_seconds: windowSeconds });
    return true;
  } catch (e) {
    if (e instanceof DbError && e.code === "rate_limited") return false;
    return true;
  }
}

// ── Sign-in ─────────────────────────────────────────────────────────────────────────

export async function login(form: FormData) {
  const email = str(form, "email", 254).toLowerCase();
  const password = str(form, "password", 200);
  const next = str(form, "next", 200);
  if (!isEmail(email) || !password) back("/admin/login", { error: "credentials" });
  if (!(await limit("admin_login", email, 8, 900))) back("/admin/login", { error: "rate_limited" });
  const { session, code } = await signInWithPassword(email, password);
  if (!session) back("/admin/login", { error: code === "email_not_confirmed" ? "unconfirmed" : "credentials" });
  await setSessionCookies(session);
  const ctx = await currentStaffWithToken(session.access_token);
  if (!ctx) {
    await signOut(session.access_token);
    await clearSessionCookies();
    back("/admin/login", { error: "no_access" });
  }
  redirect(next.startsWith("/admin/") && !next.startsWith("//") ? next : "/admin");
}

async function currentStaffWithToken(token: string) {
  const api = supabaseApi();
  if (!api) return null;
  try {
    return await rpc<{ role: string } | null>(api, "admin_session", {}, token);
  } catch {
    return null;
  }
}

export async function logout() {
  const ctx = await currentStaff();
  if (ctx) await signOut(ctx.token);
  await clearSessionCookies();
  redirect("/admin/login?ok=signed_out");
}

/** First-time setup for someone the owner has added: choose a password, confirm by e-mail. */
export async function setupAccount(form: FormData) {
  const email = str(form, "email", 254).toLowerCase();
  const password = str(form, "password", 200);
  const confirm = str(form, "confirm", 200);
  if (!isEmail(email)) back("/admin/setup", { error: "email" });
  if (password.length < 12) back("/admin/setup", { error: "password_short" });
  if (password !== confirm) back("/admin/setup", { error: "password_mismatch" });
  if (!(await limit("admin_setup", email, 4, 3600))) back("/admin/setup", { error: "rate_limited" });
  const db = conciergeServer();
  const invited = db ? await rpc<boolean>(db, "concierge_staff_invited", { p_key: db.serverKey, p_email: email }).catch(() => false) : false;
  if (invited) {
    const r = await signUp(email, password, `${site.url}/admin/login?ok=confirmed`);
    if (!r.ok && r.code === "weak_password") back("/admin/setup", { error: "password_weak" });
  }
  // Same answer whether or not the address is on the team list.
  back("/admin/setup", { ok: "check_email" });
}

export async function forgotPassword(form: FormData) {
  const email = str(form, "email", 254).toLowerCase();
  if (!isEmail(email)) back("/admin/login", { error: "email" });
  if (await limit("admin_recover", email, 3, 3600)) await sendRecovery(email, `${site.url}/admin/reset`);
  back("/admin/login", { ok: "reset_sent" });
}

/** Completes a password reset with the recovery session from the e-mail link. */
export async function completeReset(form: FormData) {
  const accessToken = str(form, "access_token", 4000);
  const refreshToken = str(form, "refresh_token", 400);
  const password = str(form, "password", 200);
  if (password.length < 12) back("/admin/reset", { error: "password_short" });
  if (password !== str(form, "confirm", 200)) back("/admin/reset", { error: "password_mismatch" });
  const r = await updatePassword(accessToken, password);
  if (!r.ok) back("/admin/reset", { error: r.code === "weak_password" ? "password_weak" : "link_expired" });
  if (refreshToken) await setSessionCookies({ access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 });
  redirect("/admin?ok=password_changed");
}

export async function changePassword(form: FormData) {
  const ctx = await requireStaff();
  const password = str(form, "password", 200);
  if (password.length < 12) back("/admin/settings", { error: "password_short" });
  if (password !== str(form, "confirm", 200)) back("/admin/settings", { error: "password_mismatch" });
  const r = await updatePassword(ctx.token, password);
  back("/admin/settings", r.ok ? { ok: "password_changed" } : { error: r.code === "weak_password" ? "password_weak" : "db_error" });
}

// ── Requests ────────────────────────────────────────────────────────────────────────

export async function updateRequest(form: FormData) {
  const ctx = await requireStaff();
  const rid = id(form);
  const changes: Record<string, unknown> = {};
  const status = str(form, "status", 40);
  if (status) {
    if (!ctx.isOwner && !staffSettableStatuses.includes(status)) back(`/admin/requests/${rid}`, { error: "owner_only" });
    changes.status = status;
  }
  if (form.has("assigned_to")) {
    const a = str(form, "assigned_to", 40);
    changes.assigned_to = UUID.test(a) ? a : null;
  }
  if (form.has("next_action")) changes.next_action = str(form, "next_action", 300);
  if (form.has("follow_up_at")) changes.follow_up_at = fromDubaiLocal(str(form, "follow_up_at", 20));
  if (ctx.isOwner && form.has("needs_review")) changes.needs_review = str(form, "needs_review", 20) || null;
  try {
    await rpc(ctx.api, "admin_update_request", { p_id: rid, p_changes: changes }, ctx.token);
  } catch (e) {
    back(`/admin/requests/${rid}`, { error: codeOf(e) });
  }
  back(`/admin/requests/${rid}`, { ok: "saved" });
}

export async function addNote(form: FormData) {
  const ctx = await requireStaff();
  const rid = id(form);
  const kind = str(form, "kind", 10) === "call" ? "call" : "note";
  try {
    await rpc(ctx.api, "admin_add_note", { p_request: rid, p_kind: kind, p_outcome: str(form, "outcome", 30) || null, p_body: str(form, "body", 2000) || null }, ctx.token);
  } catch (e) {
    back(`/admin/requests/${rid}`, { error: codeOf(e) });
  }
  back(`/admin/requests/${rid}`, { ok: kind === "call" ? "call_logged" : "note_added" });
}

export async function recordPrice(form: FormData) {
  const ctx = await requireOwner();
  const rid = id(form);
  const amountRaw = str(form, "amount", 20).replace(/,/g, "");
  const amount = amountRaw ? Number(amountRaw) : null;
  if (amount !== null && !(amount > 0)) back(`/admin/requests/${rid}`, { error: "invalid_request" });
  try {
    await rpc(ctx.api, "admin_record_price", {
      p_request: rid,
      p_item: str(form, "item", 300),
      p_amount: amount,
      p_currency: amount !== null ? str(form, "currency", 3).toUpperCase() || "AED" : null,
      p_availability: str(form, "availability", 20),
      p_valid_until: str(form, "valid_until", 10) || null,
      p_note: str(form, "note", 600) || null,
    }, ctx.token);
  } catch (e) {
    back(`/admin/requests/${rid}`, { error: codeOf(e) });
  }
  back(`/admin/requests/${rid}`, { ok: "price_recorded" });
}

export async function retryNotification(form: FormData) {
  const ctx = await requireStaff();
  const nid = id(form);
  const rid = id(form, "request_id");
  try {
    await rpc(ctx.api, "admin_retry_notification", { p_id: nid }, ctx.token);
    await processNotifications([nid]);
  } catch (e) {
    back(`/admin/requests/${rid}`, { error: codeOf(e) });
  }
  back(`/admin/requests/${rid}`, { ok: "notification_retried" });
}

export async function deleteRequest(form: FormData) {
  const ctx = await requireOwner();
  const rid = id(form);
  if (str(form, "confirm", 20) !== "DELETE") back(`/admin/requests/${rid}`, { error: "confirm_delete" });
  let paths: string[] = [];
  try {
    paths = await rpc<string[]>(ctx.api, "admin_delete_request", { p_id: rid }, ctx.token);
  } catch (e) {
    back(`/admin/requests/${rid}`, { error: codeOf(e) });
  }
  await storageRemove(ctx.api, "request-photos", paths, ctx.token).catch(() => console.error("[admin] photo files could not be removed"));
  back("/admin", { ok: "deleted" });
}

// ── Customers and orders ────────────────────────────────────────────────────────────

export async function updateCustomer(form: FormData) {
  const ctx = await requireOwner();
  const cid = id(form);
  const email = str(form, "email", 254);
  if (email && !isEmail(email)) back(`/admin/customers/${cid}`, { error: "invalid_request" });
  try {
    await rpc(ctx.api, "admin_update_customer", {
      p_id: cid,
      p_changes: { name: str(form, "name", 80), email, preferred_language: str(form, "preferred_language", 2) || "en", preferred_contact: str(form, "preferred_contact", 10), country_code: str(form, "country_code", 2) },
    }, ctx.token);
  } catch (e) {
    back(`/admin/customers/${cid}`, { error: codeOf(e) });
  }
  back(`/admin/customers/${cid}`, { ok: "saved" });
}

export async function createOrder(form: FormData) {
  const ctx = await requireOwner();
  const customer = id(form, "customer_id");
  const request = str(form, "request_id", 40);
  const total = Number(str(form, "total", 20).replace(/,/g, ""));
  const items = str(form, "items", 4000)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line) => {
      const [description, brand, qty] = line.split("|").map((p) => p.trim());
      return { description: description.slice(0, 300), brand: brand?.slice(0, 80) || null, quantity: Number(qty) > 0 ? Math.min(50, Math.floor(Number(qty))) : 1 };
    });
  const email = str(form, "contact_email", 254);
  const backTo = `/admin/orders/new?customer=${customer}${UUID.test(request) ? `&request=${request}` : ""}`;
  if (!(total > 0) || !items.length || (email && !isEmail(email))) redirect(`${backTo}&error=invalid_request`);
  let created: { id: string; reference: string } | null = null;
  try {
    created = await rpc<{ id: string; reference: string }>(ctx.api, "admin_create_order", {
      p_customer: customer,
      p_request: UUID.test(request) ? request : null,
      p_currency: str(form, "currency", 3).toUpperCase() || "AED",
      p_total: total,
      p_items: items,
      p_contact_email: email || null,
      p_shipping_destination: str(form, "shipping_destination", 160) || null,
      p_customer_note: str(form, "customer_note", 600) || null,
    }, ctx.token);
  } catch (e) {
    redirect(`${backTo}&error=${codeOf(e)}`);
  }
  back(`/admin/orders/${created!.id}`, { ok: "order_created" });
}

export async function updateOrder(form: FormData) {
  const ctx = await requireStaff();
  const oid = id(form);
  const changes: Record<string, unknown> = {};
  for (const k of ["fulfilment_status", "carrier", "tracking_number", "tracking_url", "shipping_destination"]) {
    if (form.has(k)) changes[k] = str(form, k, 500);
  }
  const url = changes.tracking_url as string | undefined;
  if (url && !/^https:\/\/\S+$/.test(url)) back(`/admin/orders/${oid}`, { error: "invalid_request" });
  if (ctx.isOwner) {
    for (const k of ["status", "payment_status", "contact_email", "customer_note"]) if (form.has(k)) changes[k] = str(form, k, 600);
    const total = str(form, "total_amount", 20).replace(/,/g, "");
    if (total) changes.total_amount = Number(total);
    if (form.has("currency") && str(form, "currency", 3)) changes.currency = str(form, "currency", 3).toUpperCase();
  }
  try {
    await rpc(ctx.api, "admin_update_order", { p_id: oid, p_changes: changes }, ctx.token);
  } catch (e) {
    back(`/admin/orders/${oid}`, { error: codeOf(e) });
  }
  back(`/admin/orders/${oid}`, { ok: "saved" });
}

// ── Knowledge, team, settings ───────────────────────────────────────────────────────

export async function saveKnowledge(form: FormData) {
  const ctx = await requireOwner();
  const kid = str(form, "id", 40);
  const topic = str(form, "topic", 20);
  if (!knowledgeTopics.includes(topic)) back("/admin/knowledge", { error: "invalid_request" });
  const sourceUrl = str(form, "source_url", 500);
  if (sourceUrl && !/^https:\/\/\S+$/.test(sourceUrl)) back("/admin/knowledge", { error: "invalid_request" });
  try {
    await rpc(ctx.api, "admin_save_knowledge", {
      p_id: UUID.test(kid) ? kid : null,
      p_fields: {
        topic,
        country_code: str(form, "country_code", 2),
        locale: str(form, "locale", 2) === "ar" ? "ar" : "en",
        title: str(form, "title", 160),
        body: str(form, "body", 2000),
        source: str(form, "source", 300),
        source_url: sourceUrl,
        review_by: str(form, "review_by", 10),
      },
    }, ctx.token);
  } catch (e) {
    back("/admin/knowledge", { error: codeOf(e) });
  }
  back("/admin/knowledge", { ok: "saved_draft" });
}

export async function setKnowledgeStatus(form: FormData) {
  const ctx = await requireOwner();
  const kid = id(form);
  const status = str(form, "status", 10);
  if (!["draft", "approved", "retired"].includes(status)) back("/admin/knowledge", { error: "invalid_request" });
  try {
    await rpc(ctx.api, "admin_set_knowledge_status", { p_id: kid, p_status: status, p_note: str(form, "note", 300) || null }, ctx.token);
  } catch (e) {
    back("/admin/knowledge", { error: codeOf(e) });
  }
  back("/admin/knowledge", { ok: status });
}

export async function addStaff(form: FormData) {
  const ctx = await requireOwner();
  const email = str(form, "email", 254).toLowerCase();
  const role = str(form, "role", 10) === "owner" ? "owner" : "staff";
  if (!isEmail(email)) back("/admin/team", { error: "invalid_request" });
  try {
    await rpc(ctx.api, "admin_add_staff", { p_email: email, p_display_name: str(form, "display_name", 80), p_role: role }, ctx.token);
  } catch (e) {
    back("/admin/team", { error: codeOf(e) });
  }
  back("/admin/team", { ok: "added" });
}

export async function updateStaff(form: FormData) {
  const ctx = await requireOwner();
  const sid = id(form);
  const changes: Record<string, unknown> = {};
  const role = str(form, "role", 10);
  if (role === "owner" || role === "staff") changes.role = role;
  const active = str(form, "active", 5);
  if (active === "true" || active === "false") changes.active = active === "true";
  try {
    await rpc(ctx.api, "admin_update_staff", { p_id: sid, p_changes: changes }, ctx.token);
  } catch (e) {
    back("/admin/team", { error: codeOf(e) });
  }
  back("/admin/team", { ok: "saved" });
}

export async function testEmail() {
  await requireOwner();
  const r = await sendTestEmail();
  back("/admin/settings", r.ok ? { ok: "test_email_sent" } : { error: "test_email_failed" });
}
