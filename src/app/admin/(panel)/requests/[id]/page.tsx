import Link from "next/link";
import { notFound } from "next/navigation";
import { select, storageSignedUrl } from "@/lib/concierge/db";
import { configuredChannels } from "@/lib/concierge/config";
import { formatPhone } from "@/lib/concierge/phone";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import {
  availabilityLabels, callOutcomeLabels, day, fulfilmentLabels, methodLabels, money, notificationLabels, paymentLabels,
  requestStatusLabels, requestTypeLabels, reviewLabels, staffSettableStatuses, toDubaiLocal, when,
} from "@/lib/admin/labels";
import { addNote, deleteRequest, recordPrice, retryNotification, updateRequest } from "../../../actions";

export const metadata = { title: "Request" };

interface RequestRow {
  id: string;
  reference: string;
  type: string;
  status: string;
  summary: string;
  details: Record<string, string | number | boolean>;
  needs_review: string | null;
  locale: string;
  destination_country: string | null;
  destination_label: string | null;
  contact_name: string | null;
  contact_phone: string;
  contact_email: string | null;
  contact_method: string;
  consent_text: string;
  consent_at: string;
  marketing_consent: boolean;
  assigned_to: string | null;
  next_action: string | null;
  follow_up_at: string | null;
  source: string;
  conversation_id: string | null;
  customer_id: string;
  is_test: boolean;
  created_at: string;
  updated_at: string;
  customers: { id: string; name: string | null; phone_e164: string | null; email: string | null };
  request_notes: { id: number; author_id: string | null; kind: string; outcome: string | null; body: string | null; created_at: string }[];
  price_approvals: { id: number; item_description: string; amount: string | null; currency: string | null; availability: string; valid_until: string | null; note: string | null; approved_by: string; approved_at: string }[];
  notifications: { id: string; channel: string; status: string; attempts: number; last_error: string | null; sent_at: string | null; updated_at: string }[];
  request_photos: { id: string; object_path: string; status: string; width: number | null; height: number | null; created_at: string }[];
}

const DETAIL_LABELS: Record<string, string> = {
  category: "Category", brand: "Brand", model: "Model / reference", colour: "Colour", size: "Size", year: "Year",
  extra_details: "Other details", budget: "Budget", timing: "Timing", topic: "Question topic", question: "Question",
  item_ref: "Website piece", item_name: "Piece name", order_ref: "Order reference", photos: "Photos sent", ai_assisted: "AI helped read the message",
};

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { api, token, isOwner } = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;

  const [rows, team] = await Promise.all([
    select<RequestRow[]>(api, "requests", {
      id: `eq.${id}`,
      select: "*,customers(id,name,phone_e164,email),request_notes(*),price_approvals(*),notifications(id,channel,status,attempts,last_error,sent_at,updated_at),request_photos(id,object_path,status,width,height,created_at)",
      "request_notes.order": "id.desc",
      "price_approvals.order": "approved_at.desc",
      "notifications.order": "channel.asc",
    }, token),
    select<{ id: string; display_name: string | null; role: string; active: boolean }[]>(api, "staff_members", { select: "id,display_name,role,active", order: "display_name.asc" }, token),
  ]);
  const r = rows[0];
  if (!r) notFound();
  const names = Object.fromEntries(team.map((s) => [s.id, s.display_name ?? "Team member"]));

  const [messages, orders, audit, photoUrls] = await Promise.all([
    r.conversation_id
      ? select<{ role: string; body: string; created_at: string }[]>(api, "conversation_messages", { conversation_id: `eq.${r.conversation_id}`, select: "role,body,created_at", order: "id.asc", limit: "300" }, token)
      : Promise.resolve([]),
    select<{ id: string; reference: string; status: string; currency: string; total_amount: string; payment_status: string; fulfilment_status: string }[]>(api, "orders", { request_id: `eq.${id}`, select: "id,reference,status,currency,total_amount,payment_status,fulfilment_status" }, token),
    isOwner
      ? select<{ id: number; actor_label: string; action: string; before: unknown; after: unknown; created_at: string }[]>(api, "audit_log", { entity: "eq.request", entity_id: `eq.${id}`, order: "id.desc", limit: "40" }, token)
      : Promise.resolve([]),
    Promise.all(
      r.request_photos.filter((p) => p.status === "stored").map(async (p) => ({ ...p, url: await storageSignedUrl(api, "request-photos", p.object_path, token, 300).catch(() => null) })),
    ),
  ]);

  const greeting = r.locale === "ar"
    ? `مرحباً${r.contact_name ? ` ${r.contact_name}` : ""}، معك فريق SEVN HEVN بخصوص طلبك ${r.reference}.`
    : `Hello${r.contact_name ? ` ${r.contact_name}` : ""}, this is the SEVN HEVN team about your request ${r.reference}.`;
  const customerWa = `https://wa.me/${r.contact_phone.replace(/\D/g, "")}?text=${encodeURIComponent(greeting)}`;
  const statuses = isOwner ? Object.keys(requestStatusLabels) : staffSettableStatuses;
  const details = Object.entries(r.details ?? {});
  const connected = configuredChannels();

  return (
    <>
      <p className="adm-crumbs"><Link href="/admin">← Requests</Link></p>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <header className="adm-head">
        <h1 className="adm-h1">
          {r.reference} {r.is_test && <span className="adm-badge adm-badge--test">Test</span>}
        </h1>
        <p className="adm-muted">
          {requestTypeLabels[r.type]} · received {when(r.created_at)} · {r.locale === "ar" ? "Arabic" : "English"} · via {r.source === "page" ? "/chat page" : "website widget"}
        </p>
        <p>
          <span className={`adm-status adm-status--${r.status}`}>{requestStatusLabels[r.status]}</span>
          {r.needs_review && <span className="adm-badge adm-badge--review">Needs confirmation: {reviewLabels[r.needs_review]}</span>}
        </p>
      </header>

      <div className="adm-grid">
        <div className="adm-col">
          <section className="adm-card">
            <h2>Customer</h2>
            <dl className="adm-dl">
              <dt>Name</dt><dd>{r.contact_name || "—"} · <Link href={`/admin/customers/${r.customer_id}`}>customer record</Link></dd>
              <dt>Phone / WhatsApp</dt><dd><a className="adm-ltr" href={`tel:${r.contact_phone}`}>{formatPhone(r.contact_phone)}</a></dd>
              {r.contact_email && (<><dt>Email</dt><dd><a href={`mailto:${r.contact_email}`}>{r.contact_email}</a></dd></>)}
              <dt>Prefers</dt><dd>{methodLabels[r.contact_method]}</dd>
              <dt>Consent</dt><dd>“{r.consent_text}” — {when(r.consent_at)}<br /><span className="adm-muted">Marketing consent: {r.marketing_consent ? "yes" : "not given"}</span></dd>
            </dl>
            <p className="adm-actions">
              <a className="adm-btn" href={customerWa} target="_blank" rel="noopener noreferrer">Open WhatsApp with the customer</a>
              <a className="adm-btn" href={`tel:${r.contact_phone}`}>Call</a>
            </p>
            <p className="adm-muted adm-small">Opening WhatsApp is a manual step: nothing is sent until you press send in WhatsApp.</p>
          </section>

          <section className="adm-card">
            <h2>Request</h2>
            <p className="adm-quote" dir="auto">{r.summary}</p>
            <dl className="adm-dl">
              {details.map(([k, v]) => (
                <div key={k} className="adm-dl__row"><dt>{DETAIL_LABELS[k] ?? k}</dt><dd dir="auto">{String(v)}</dd></div>
              ))}
              <div className="adm-dl__row"><dt>Destination</dt><dd>{r.destination_label ? `${r.destination_label}${r.destination_country ? ` (${r.destination_country})` : ""}` : "—"}</dd></div>
            </dl>
          </section>

          <section className="adm-card">
            <h2>Photos</h2>
            {photoUrls.length === 0 ? <p className="adm-muted">No photos.</p> : (
              <>
                <ul className="adm-photos">
                  {photoUrls.map((p) => (
                    <li key={p.id}>
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt={`Photo sent with ${r.reference}`} width={p.width ?? undefined} height={p.height ?? undefined} loading="lazy" />
                        </a>
                      ) : <span className="adm-muted">Photo unavailable</span>}
                    </li>
                  ))}
                </ul>
                <p className="adm-muted adm-small">Links expire after 5 minutes (reload to renew). A photo alone doesn’t prove authenticity, availability or price.</p>
              </>
            )}
          </section>

          <section className="adm-card">
            <h2>Conversation</h2>
            {messages.length === 0 ? <p className="adm-muted">No transcript.</p> : (
              <details>
                <summary>Show the chat ({messages.length} messages)</summary>
                <ol className="adm-transcript">
                  {messages.map((m, i) => (
                    <li key={i} className={`adm-transcript__${m.role}`}>
                      <span className="adm-muted adm-small">{m.role === "assistant" ? "Assistant" : "Customer"} · {when(m.created_at)}</span>
                      <p dir="auto">{m.body}</p>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>
        </div>

        <div className="adm-col">
          <section className="adm-card">
            <h2>Follow-up</h2>
            <form action={updateRequest} className="adm-form">
              <input type="hidden" name="id" value={r.id} />
              <label>
                Status
                <select name="status" defaultValue={r.status}>
                  {statuses.map((s) => <option key={s} value={s}>{requestStatusLabels[s]}</option>)}
                  {!statuses.includes(r.status) && <option value={r.status}>{requestStatusLabels[r.status]}</option>}
                </select>
              </label>
              <label>
                Assigned to
                <select name="assigned_to" defaultValue={r.assigned_to ?? ""}>
                  <option value="">Nobody</option>
                  {team.filter((s) => s.active || s.id === r.assigned_to).map((s) => <option key={s.id} value={s.id}>{s.display_name ?? "Team member"}</option>)}
                </select>
              </label>
              <label>
                Next action
                <input name="next_action" defaultValue={r.next_action ?? ""} maxLength={300} placeholder="e.g. Send two options on WhatsApp" />
              </label>
              <label>
                Follow-up date (Dubai time)
                <input name="follow_up_at" type="datetime-local" defaultValue={toDubaiLocal(r.follow_up_at)} />
              </label>
              {isOwner && (
                <label>
                  Needs confirmation
                  <select name="needs_review" defaultValue={r.needs_review ?? ""}>
                    <option value="">Nothing</option>
                    {Object.entries(reviewLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
              <button type="submit" className="adm-btn adm-btn--dark">Save</button>
            </form>
          </section>

          <section className="adm-card">
            <h2>Notes and calls</h2>
            <form action={addNote} className="adm-form adm-form--inline">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="kind" value="call" />
              <label>
                Call result
                <select name="outcome" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {Object.entries(callOutcomeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label>
                Note (optional)
                <input name="body" maxLength={2000} />
              </label>
              <button type="submit" className="adm-btn">Log call</button>
            </form>
            <form action={addNote} className="adm-form">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="kind" value="note" />
              <label>
                Internal note (never shown to the customer)
                <textarea name="body" rows={3} required maxLength={2000} />
              </label>
              <button type="submit" className="adm-btn">Add note</button>
            </form>
            <ul className="adm-notes">
              {r.request_notes.map((n) => (
                <li key={n.id}>
                  <span className="adm-muted adm-small">{n.author_id ? names[n.author_id] : "—"} · {when(n.created_at)}</span>
                  <p>{n.kind === "call" ? <strong>Call: {callOutcomeLabels[n.outcome ?? ""] ?? n.outcome}. </strong> : null}{n.body}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="adm-card">
            <h2>Price and availability</h2>
            <p className="adm-muted adm-small">Confirmed by the owner. The chat never quotes these; the team uses them when replying.</p>
            {r.price_approvals.length === 0 ? <p className="adm-muted">Nothing confirmed yet.</p> : (
              <ul className="adm-notes">
                {r.price_approvals.map((a) => (
                  <li key={a.id}>
                    <strong>{a.item_description}</strong> — {availabilityLabels[a.availability]}{a.amount ? ` · ${money(a.amount, a.currency)}` : ""}
                    {a.valid_until && ` · valid until ${day(a.valid_until)}`}
                    <br />
                    <span className="adm-muted adm-small">Approved by {names[a.approved_by] ?? "owner"} · {when(a.approved_at)}{a.note ? ` · ${a.note}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            {isOwner && (
              <details>
                <summary>Record a confirmed price / availability</summary>
                <form action={recordPrice} className="adm-form">
                  <input type="hidden" name="id" value={r.id} />
                  <label>Piece<input name="item" required maxLength={300} defaultValue={[r.details?.brand, r.details?.model].filter(Boolean).join(" ")} /></label>
                  <label>
                    Availability
                    <select name="availability" required defaultValue="available">
                      {Object.entries(availabilityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <div className="adm-row">
                    <label>Price (optional)<input name="amount" inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" /></label>
                    <label>Currency<input name="currency" defaultValue="AED" maxLength={3} pattern="[A-Za-z]{3}" /></label>
                  </div>
                  <label>Valid until (optional)<input name="valid_until" type="date" /></label>
                  <label>Note (optional)<input name="note" maxLength={600} /></label>
                  <button type="submit" className="adm-btn adm-btn--dark">Record as approved</button>
                </form>
              </details>
            )}
          </section>

          <section className="adm-card">
            <h2>Orders</h2>
            {orders.length === 0 ? <p className="adm-muted">No order yet.</p> : (
              <ul className="adm-notes">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/orders/${o.id}`} className="adm-ref">{o.reference}</Link> · {money(o.total_amount, o.currency)} · {paymentLabels[o.payment_status]} · {fulfilmentLabels[o.fulfilment_status]}
                  </li>
                ))}
              </ul>
            )}
            {isOwner && <Link className="adm-btn" href={`/admin/orders/new?customer=${r.customer_id}&request=${r.id}`}>Create an order</Link>}
          </section>

          <section className="adm-card">
            <h2>Team notifications</h2>
            <ul className="adm-notes">
              {r.notifications.map((n) => (
                <li key={n.id}>
                  <strong>{n.channel === "email" ? "Email" : "WhatsApp"}:</strong>{" "}
                  <span className={`adm-badge adm-badge--n-${n.status}`}>{notificationLabels[n.status]}</span>
                  {n.attempts > 0 && <span className="adm-muted adm-small"> · {n.attempts} attempt{n.attempts === 1 ? "" : "s"}</span>}
                  {n.sent_at && <span className="adm-muted adm-small"> · {when(n.sent_at)}</span>}
                  {n.last_error && <><br /><span className="adm-muted adm-small">Error: {n.last_error}</span></>}
                  {(n.status === "failed" || (n.status === "not_configured" && connected.includes(n.channel as "email" | "whatsapp"))) && (
                    <form action={retryNotification} className="adm-inline">
                      <input type="hidden" name="id" value={n.id} />
                      <input type="hidden" name="request_id" value={r.id} />
                      <button type="submit" className="adm-link">Try again</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <p className="adm-muted adm-small">“Needs connection” means that channel isn’t set up yet (Settings shows what is missing). The request itself is always saved here.</p>
          </section>

          {isOwner && (
            <section className="adm-card">
              <h2>History</h2>
              {audit.length === 0 ? <p className="adm-muted">No changes yet.</p> : (
                <ul className="adm-notes adm-small">
                  {audit.map((a) => (
                    <li key={a.id}>
                      {when(a.created_at)} · {a.actor_label} · {a.action}
                      {a.after ? <code className="adm-code">{JSON.stringify(a.before ?? {})} → {JSON.stringify(a.after)}</code> : null}
                    </li>
                  ))}
                </ul>
              )}
              <details className="adm-danger">
                <summary>Delete this request permanently</summary>
                <form action={deleteRequest} className="adm-form">
                  <input type="hidden" name="id" value={r.id} />
                  <p className="adm-small">Deletes the request, its conversation, notes and photos. Use for spam, test data or a customer’s erasure request. This cannot be undone.</p>
                  <label>Type DELETE to confirm<input name="confirm" required pattern="DELETE" autoComplete="off" /></label>
                  <button type="submit" className="adm-btn adm-btn--danger">Delete permanently</button>
                </form>
              </details>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
