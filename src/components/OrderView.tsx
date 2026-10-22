"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { formatAEDExact } from "@/lib/format";
import { eventText, fulfilmentText, itemStageText, orderStatusText, paymentText, returnReasonText, returnStatusText, shipmentText } from "@/lib/orders/customer";

const TOKEN_KEY = "sevn-hevn-order-token";

type Item = { id: number; description: string; brand: string | null; options: string | null; quantity: number; unit_amount: number | null; availability: string; stage: string };
type Order = {
  reference: string; status: string; payment_status: string; fulfilment_status: string; currency: string;
  subtotal: number | null; discount: number; shipping: number | null; vat: number | null; vat_rate: number | null; vat_treatment: string;
  prices_include_vat: boolean | null; duties_treatment: string; duties_note: string | null; total: number | null; paid: number; refunded: number; balance: number;
  delivery_mode: string; shipping_destination: string | null; sourcing_eta: string | null; transit_days_min: number | null; transit_days_max: number | null;
  delivery_estimate_from: string | null; delivery_estimate_to: string | null; delivery_estimate_note: string | null; quote_expires_at: string | null;
  accepted_at: string | null; cancellation_terms: string | null; customer_note: string | null; created_at: string;
  items: Item[];
  shipments: { reference: string; carrier: string | null; tracking_number: string | null; tracking_url: string | null; status: string; handed_over_at: string | null; delivered_at: string | null }[];
  events: { at: string; kind: string; to: string | null; note: string | null }[];
  messages: { at: string; from_customer: boolean; kind: string; body: string }[];
  returns: { reference: string; status: string; reason: string; created_at: string; decision_reason: string | null; support_path: string | null; resolution: string | null; item_ids: number[] | null }[];
  policies: { kind: string; version: string; title: string }[];
  change_of_mind_days: number | null;
  delivered_at: string | null;
};
type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ok"; order: Order; canPayOnline: boolean };

const money = (n: number | null | undefined, currency: string) =>
  n === null || n === undefined ? "—" : currency === "AED" ? formatAEDExact(Number(n)) : new Intl.NumberFormat("en-AE", { style: "currency", currency }).format(Number(n));
const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Asia/Dubai" }).format(new Date(iso)) : "");
const dateTime = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }).format(new Date(iso)) : "");
const policyPath: Record<string, string> = { terms_of_sale: "/terms/terms-of-sale", returns: "/terms/returns", shipping: "/terms/shipping", privacy: "/terms/privacy" };

/** Reads the link's token once, then keeps it for this tab only and takes it out of the address bar. */
function readToken() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const fromLink = hash.get("t");
  const paid = hash.get("paid") === "1";
  if (fromLink) {
    try {
      window.sessionStorage.setItem(TOKEN_KEY, fromLink);
    } catch {}
    window.history.replaceState(null, "", window.location.pathname);
    return { token: fromLink, paid };
  }
  try {
    return { token: window.sessionStorage.getItem(TOKEN_KEY), paid };
  } catch {
    return { token: null, paid };
  }
}

/**
 * The customer's order page: what they ordered, what they paid, where it is, and what happens next,
 * from the order's own record. They can accept a quote, pay online (when available), write to the
 * team, ask to cancel before dispatch, and request a return of delivered pieces.
 */
export function OrderView() {
  const uid = useId();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const res = await fetch("/api/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, action, ...extra }) });
      return { res, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
    [token],
  );

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { res, data } = await call("view");
      if (res.status === 404) return setState({ kind: "missing" });
      if (!res.ok) return setState({ kind: "error" });
      setState({ kind: "ok", order: data.order as Order, canPayOnline: !!data.canPayOnline });
    } catch {
      setState({ kind: "error" });
    }
  }, [call, token]);

  useEffect(() => {
    const { token: t, paid } = readToken();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!t) setState({ kind: "missing" });
    setToken(t);
    setConfirming(paid);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // After the payment page: the order is paid only once the provider confirms it, so check again for a while.
  const order = state.kind === "ok" ? state.order : null;
  useEffect(() => {
    if (!confirming || !order) return;
    if (!["unpaid", "pending", "failed"].includes(order.payment_status) || order.status !== "awaiting_confirmation") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfirming(false);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > 120_000) {
        window.clearInterval(timer);
        setConfirming(false);
        return;
      }
      void load();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [confirming, order, load]);

  async function act(name: string, extra: Record<string, unknown>, done: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      const { res, data } = await call(name, extra);
      if (res.ok && typeof data.redirectUrl === "string") {
        window.location.assign(data.redirectUrl);
        return true;
      }
      if (!res.ok) {
        setError(
          data.error === "quote_expired" ? "This quote has expired. Please write to us and we’ll prepare a new one."
          : data.error === "insufficient_stock" || data.error === "not_for_sale" ? "This piece is no longer available. Please write to us."
          : data.error === "rate_limited" ? "Too many attempts. Please try again later."
          : "That didn’t work just now. Please try again, or write to us.",
        );
        return false;
      }
      setNotice(done);
      await load();
      return true;
    } catch {
      setError("We couldn’t reach our server. Please check your connection and try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (state.kind === "loading") return <p className="container muted checkout__loading">Loading your order…</p>;
  if (state.kind === "missing") {
    return (
      <div className="container checkout checkout--empty">
        <h1 className="display display--sm">Your order</h1>
        <p>This link doesn’t open an order. It may have expired or been replaced. Please use the latest link we sent you, or contact us and we’ll send a new one.</p>
        <Link href="/chat" className="btn btn--dark">Contact us</Link>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="container checkout checkout--empty">
        <h1 className="display display--sm">Your order</h1>
        <p>We couldn’t load your order just now. Please try again in a moment.</p>
        <button type="button" className="btn btn--dark" onClick={() => void load()}>Try again</button>
      </div>
    );
  }

  const o = state.order;
  const c = o.currency;
  const waiting = o.status === "awaiting_confirmation";
  const expired = !!o.quote_expires_at && new Date(o.quote_expires_at) < new Date();
  const dispatched = o.shipments.length > 0;
  const inReturn = new Set(o.returns.filter((r) => r.status !== "rejected").flatMap((r) => r.item_ids ?? []));
  const returnable = o.items.filter((i) => (i.stage === "delivered" || i.stage === "collected") && !inReturn.has(i.id));
  const canCancel = ["awaiting_confirmation", "confirmed", "processing"].includes(o.status) && !dispatched;
  const timeline = o.events.map((e) => ({ ...e, text: eventText(e.kind, e.to) })).filter((e) => e.text);

  return (
    <div className="container checkout order-page">
      <h1 className="display display--sm checkout__title">Order <bdi dir="ltr">{o.reference}</bdi></h1>
      <dl className="order-page__status">
        <div><dt>Order</dt><dd>{orderStatusText[o.status]}</dd></div>
        <div><dt>Payment</dt><dd>{paymentText[o.payment_status]}</dd></div>
        <div><dt>Delivery</dt><dd>{o.delivery_mode === "collect" && o.fulfilment_status === "collected" ? "Collected" : fulfilmentText[o.fulfilment_status]}</dd></div>
      </dl>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="field__error" role="alert">{error}</p>}
      {confirming && (
        <p className="notice" role="status">
          Thank you. We’re confirming your payment with our payment provider. This page updates by itself; you can also close it, and we’ll confirm by e-mail or message.
        </p>
      )}

      <div className="checkout__grid">
        <div className="checkout__main">
          {waiting && (
            <section className="checkout-step checkout-step--active" aria-labelledby={`${uid}-quote`}>
              <header className="checkout-step__head"><h2 id={`${uid}-quote`}>Your quote</h2></header>
              <div className="checkout-step__body">
                {o.quote_expires_at && <p>{expired ? "This quote expired on" : "This quote is valid until"} {dateTime(o.quote_expires_at)} (Dubai time).</p>}
                {o.cancellation_terms && <p><strong>Cancellation:</strong> {o.cancellation_terms}</p>}
                {!o.accepted_at && !expired && <AcceptQuote policies={o.policies} busy={busy === "accept"} onAccept={() => act("accept", {}, "Thank you. You have accepted the quote.")} />}
                {o.accepted_at && o.balance > 0 && !expired && (
                  state.canPayOnline ? (
                    <>
                      <p className="muted small">You pay on our payment provider’s secure page. Your card details never reach our website. Your order is confirmed once the provider confirms the payment.</p>
                      <button type="button" className="btn btn--dark btn--block" disabled={busy === "pay"} aria-busy={busy === "pay"} onClick={() => void act("pay", {}, "")}>
                        {busy === "pay" ? "Opening the secure payment page…" : `Pay ${money(o.balance, c)} securely`}
                      </button>
                    </>
                  ) : (
                    <p>Our team will send you the payment details. Your order is confirmed once we have received the payment.</p>
                  )
                )}
              </div>
            </section>
          )}

          <section className="checkout-step checkout-step--active" aria-labelledby={`${uid}-items`}>
            <header className="checkout-step__head"><h2 id={`${uid}-items`}>Pieces</h2></header>
            <ul className="checkout-lines checkout-step__body">
              {o.items.map((i) => (
                <li key={i.id} className="checkout-line">
                  <span className="checkout-line__text">
                    {i.brand && <span className="eyebrow" lang="en" dir="ltr">{i.brand}</span>}
                    <span>{i.description}</span>
                    {i.options && <span className="small">{i.options}</span>}
                    <span className="muted small">Qty {i.quantity}{i.availability === "on_request" ? " · sourced for you" : ""} · {itemStageText[i.stage]}</span>
                  </span>
                  <span className="checkout-line__price" dir="ltr">{money(i.unit_amount === null ? null : i.unit_amount * i.quantity, c)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="checkout-step checkout-step--active" aria-labelledby={`${uid}-delivery`}>
            <header className="checkout-step__head"><h2 id={`${uid}-delivery`}>{o.delivery_mode === "collect" ? "Collection" : "Delivery"}</h2></header>
            <div className="checkout-step__body">
              <p>{o.delivery_mode === "collect" ? "Collect in Dubai, arranged with our team." : o.shipping_destination ?? ""}</p>
              {o.sourcing_eta && <p>We expect to have the piece by {date(o.sourcing_eta)}.</p>}
              {o.transit_days_min !== null && o.transit_days_max !== null && o.delivery_mode === "deliver" && <p>In transit: {o.transit_days_min}–{o.transit_days_max} days after dispatch.</p>}
              {(o.delivery_estimate_from || o.delivery_estimate_to) && <p>Estimated delivery: {[date(o.delivery_estimate_from), date(o.delivery_estimate_to)].filter(Boolean).join(" – ")}</p>}
              {o.delivery_estimate_note && <p>{o.delivery_estimate_note}</p>}
              {o.customer_note && <p>{o.customer_note}</p>}
              {o.shipments.map((s) => (
                <p key={s.reference}>
                  {shipmentText[s.status] ?? s.status}{s.carrier ? ` · ${s.carrier}` : ""}{s.tracking_number ? ` · ${s.tracking_number}` : ""}
                  {s.tracking_url && <> · <a href={s.tracking_url} target="_blank" rel="noopener noreferrer">Track the parcel</a></>}
                  {s.delivered_at ? ` · delivered ${date(s.delivered_at)}` : s.handed_over_at ? ` · sent ${date(s.handed_over_at)}` : ""}
                </p>
              ))}
            </div>
          </section>

          {timeline.length > 0 && (
            <section className="checkout-step checkout-step--active" aria-labelledby={`${uid}-history`}>
              <header className="checkout-step__head"><h2 id={`${uid}-history`}>History</h2></header>
              <ol className="order-page__timeline checkout-step__body">
                {timeline.map((e, i) => (
                  <li key={i}><span className="muted small">{dateTime(e.at)}</span> {e.text}{e.note ? `: ${e.note}` : ""}</li>
                ))}
              </ol>
            </section>
          )}

          {o.returns.length > 0 && (
            <section className="checkout-step checkout-step--active" aria-labelledby={`${uid}-returns`}>
              <header className="checkout-step__head"><h2 id={`${uid}-returns`}>Returns</h2></header>
              <div className="checkout-step__body">
                {o.returns.map((r) => (
                  <div key={r.reference}>
                    <p><strong><bdi dir="ltr">{r.reference}</bdi></strong> · {returnReasonText[r.reason]} · {returnStatusText[r.status]}</p>
                    {r.decision_reason && <p>{r.decision_reason}</p>}
                    {r.support_path && <p className="muted small">{r.support_path}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {returnable.length > 0 && <ReturnRequest items={returnable} days={o.change_of_mind_days} busy={busy === "return"} onSend={(extra) => act("return", extra, "Your return request has been sent. Our team reviews it and replies here.")} />}

          <Messages messages={o.messages} canCancel={canCancel} busy={busy === "message"} onSend={(extra) => act("message", extra, extra.kind === "cancellation_request" ? "Your cancellation request has been sent to our team." : "Your message has been sent.")} />
        </div>

        <aside className="checkout__summary" aria-label="Order summary">
          <h2 className="checkout__summary-title">Summary</h2>
          <dl className="totals">
            <div><dt>Pieces</dt><dd dir="ltr">{money(o.subtotal, c)}</dd></div>
            {Number(o.discount) > 0 && <div><dt>Discount</dt><dd dir="ltr">− {money(o.discount, c)}</dd></div>}
            <div><dt>{o.delivery_mode === "collect" ? "Collection" : "Delivery"}</dt><dd dir="ltr">{o.delivery_mode === "collect" ? money(0, c) : money(o.shipping, c)}</dd></div>
            <div>
              <dt>VAT</dt>
              <dd>
                {o.vat_treatment === "standard" && o.vat !== null
                  ? `${o.prices_include_vat ? "Includes" : "Plus"} ${o.vat_rate}%: ${money(o.vat, c)}`
                  : o.vat_treatment === "zero_rated" ? "Zero-rated (export)" : o.vat_treatment === "not_applicable" ? "Not applicable" : "Confirmed before payment"}
              </dd>
            </div>
            {o.duties_treatment !== "not_applicable" && o.duties_treatment !== "unknown" && (
              <div><dt>Import duties</dt><dd>{o.duties_treatment === "included" ? "Included" : (o.duties_note ?? "Paid by you on arrival, to the destination’s authorities")}</dd></div>
            )}
            <div className="totals__due"><dt>Total</dt><dd dir="ltr">{money(o.total, c)}</dd></div>
            <div><dt>Paid</dt><dd dir="ltr">{money(o.paid, c)}</dd></div>
            {o.refunded > 0 && <div><dt>Refunded</dt><dd dir="ltr">{money(o.refunded, c)}</dd></div>}
            {o.balance > 0 && o.status !== "cancelled" && <div><dt>Still to pay</dt><dd dir="ltr">{money(o.balance, c)}</dd></div>}
          </dl>
          {o.policies.length > 0 && (
            <p className="muted small">
              Accepted: {o.policies.map((p, i) => <span key={p.kind}>{i > 0 && ", "}<Link href={policyPath[p.kind] ?? "/"}>{p.title}</Link> ({p.version})</span>)}
            </p>
          )}
          <p className="muted small">Ordered {date(o.created_at)}. Keep the link we sent you to come back to this page; it is private to you.</p>
        </aside>
      </div>
    </div>
  );
}

function AcceptQuote({ policies, busy, onAccept }: { policies: Order["policies"]; busy: boolean; onAccept: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) onAccept(); }}>
      <label className="consent">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>
          I accept this quote{policies.length ? " and the " : ""}
          {policies.map((p, i) => <span key={p.kind}>{i > 0 && " and the "}<Link href={policyPath[p.kind] ?? "/"} target="_blank">{p.title}</Link></span>)}.
        </span>
      </label>
      <button type="submit" className="btn btn--dark btn--block" disabled={!ok || busy} aria-busy={busy}>{busy ? "Sending…" : "Accept the quote"}</button>
    </form>
  );
}

function ReturnRequest({ items, days, busy, onSend }: { items: Item[]; days: number | null; busy: boolean; onSend: (extra: Record<string, unknown>) => Promise<boolean> }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const [reason, setReason] = useState("defective");
  const [description, setDescription] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen.length) return;
    if (await onSend({ items: chosen.map((id) => ({ id, quantity: 1 })), reason, description, idempotencyKey: key })) setOpen(false);
  }
  return (
    <section className="checkout-step checkout-step--active" aria-labelledby={`${uid}-h`}>
      <header className="checkout-step__head"><h2 id={`${uid}-h`}>Return a piece</h2></header>
      <div className="checkout-step__body">
        {!open ? (
          <button type="button" className="btn btn--line" onClick={() => setOpen(true)}>Request a return</button>
        ) : (
          <form onSubmit={submit} className="form__grid">
            <fieldset className="field field--wide">
              <legend>Which piece?</legend>
              {items.map((i) => (
                <label key={i.id} className="choice">
                  <input type="checkbox" checked={chosen.includes(i.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, i.id] : c.filter((x) => x !== i.id)))} />
                  <span>{i.description}</span>
                </label>
              ))}
            </fieldset>
            <div className="field field--wide">
              <label htmlFor={`${uid}-reason`}>Why?</label>
              <select id={`${uid}-reason`} value={reason} onChange={(e) => setReason(e.target.value)}>
                {Object.entries(returnReasonText).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
            <div className="field field--wide">
              <label htmlFor={`${uid}-desc`}>Tell us more</label>
              <textarea id={`${uid}-desc`} rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} dir="auto" />
            </div>
            <p className="muted small field--wide">
              {reason === "change_of_mind"
                ? days ? `Change of mind applies to in-stock pieces, within ${days} days of delivery, in their original condition.` : "Our team will tell you whether a change-of-mind return is possible for this piece."
                : "Our team reviews every request and replies here. This doesn’t affect your legal rights."}
              {" "}We may ask you for photos.
            </p>
            <button type="submit" className="btn btn--dark" disabled={!chosen.length || busy} aria-busy={busy}>{busy ? "Sending…" : "Send the return request"}</button>
          </form>
        )}
      </div>
    </section>
  );
}

function Messages({ messages, canCancel, busy, onSend }: { messages: Order["messages"]; canCancel: boolean; busy: boolean; onSend: (extra: Record<string, unknown>) => Promise<boolean> }) {
  const uid = useId();
  const [body, setBody] = useState("");
  const [cancel, setCancel] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    if (await onSend({ kind: cancel ? "cancellation_request" : "message", body })) {
      setBody("");
      setCancel(false);
    }
  }
  return (
    <section className="checkout-step checkout-step--active" aria-labelledby={`${uid}-h`}>
      <header className="checkout-step__head"><h2 id={`${uid}-h`}>Messages</h2></header>
      <div className="checkout-step__body">
        {messages.length > 0 && (
          <ul className="order-page__messages">
            {messages.map((m, i) => (
              <li key={i} data-from={m.from_customer ? "you" : "us"}>
                <span className="muted small">{m.from_customer ? "You" : "SEVN HEVN"} · {dateTime(m.at)}{m.kind === "cancellation_request" ? " · cancellation request" : ""}</span>
                <span dir="auto">{m.body}</span>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="form__grid">
          <div className="field field--wide">
            <label htmlFor={`${uid}-body`}>Write to our team</label>
            <textarea id={`${uid}-body`} rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" />
          </div>
          {canCancel && (
            <label className="choice field--wide">
              <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} />
              <span>I would like to cancel this order</span>
            </label>
          )}
          <button type="submit" className="btn btn--dark" disabled={!body.trim() || busy} aria-busy={busy}>{busy ? "Sending…" : cancel ? "Send the cancellation request" : "Send"}</button>
        </form>
      </div>
    </section>
  );
}
