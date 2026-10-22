"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCountries } from "libphonenumber-js/min";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatAED, formatAEDExact } from "@/lib/format";
import { productPath } from "@/lib/paths";
import { purchaseMessage, whatsappUrl, type PurchaseLine } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { useSite } from "./SiteProvider";
import { resolveLine } from "./CartPanel";
import { WhatsAppIcon } from "./icons";

type Line = { ref: string; sku?: string; brand?: string; name: string; options?: string; qty: number; unitAED: number; lineAED: number };
type Verified = { lines: Line[]; subtotalAED: number; subtotalLabel: string };
type Check = { kind: "checking" } | { kind: "ok"; verified: Verified } | { kind: "issues"; issues: { ref: string; sku?: string; code: string; max?: number }[] } | { kind: "error" };
type Details = { name: string; email: string; phone: string; method: "whatsapp" | "call" | "email"; mode: "deliver" | "collect"; country: string; city: string; address: string; notes: string; consent: boolean };
type Submit = { kind: "idle" } | { kind: "sending" } | { kind: "unavailable"; verified?: Verified } | { kind: "error"; message: string };
type Quote = {
  subtotal: number; shipping: number; vat: number; vat_rate: number | null; vat_treatment: string; prices_include_vat: boolean | null;
  duties_treatment: string; duties_note: string | null; total: number; transit_days_min: number | null; transit_days_max: number | null;
};
/** Online payment is offered only when the server says this bag, to this destination, can be paid now. */
type Online = { kind: "unknown" } | { kind: "off" } | { kind: "on"; quote: Quote; policies: { kind: string; version: string; title: string }[] };
const policyPath: Record<string, string> = { terms_of_sale: "/terms/terms-of-sale", returns: "/terms/returns" };

const DETAILS_KEY = "sevn-hevn-checkout-details";
const IDEM_KEY = "sevn-hevn-checkout-key";
const ORDER_TOKEN_KEY = "sevn-hevn-order-token";
export const RECEIVED_KEY = "sevn-hevn-last-request";
const FIRST = ["AE", "SA", "KW", "QA", "BH", "OM"];

const emptyDetails: Details = { name: "", email: "", phone: "", method: "whatsapp", mode: "deliver", country: "AE", city: "", address: "", notes: "", consent: false };

function readSession<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeSession(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the page still works for this visit */
  }
}

/**
 * Checkout: bag (re-checked on the server) → your details → delivery → payment. Online payment is not
 * connected, so the last step sends a purchase request that the team confirms personally; nothing is
 * charged and nothing is shown as paid. Details are kept for this browser tab only (sessionStorage).
 */
export function CheckoutView() {
  const router = useRouter();
  const { cart, itemByRef } = useSite();
  const { t, href, fmt, locale } = useI18n();
  const s = t.shop;
  const c = s.checkout;
  const uid = useId();
  const [check, setCheck] = useState<Check>({ kind: "checking" });
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState<Details>(emptyDetails);
  const [errors, setErrors] = useState<Partial<Record<keyof Details | "emailNeeded", string>>>({});
  const [submit, setSubmit] = useState<Submit>({ kind: "idle" });
  const [online, setOnline] = useState<Online>({ kind: "unknown" });
  const restored = useRef(false);

  const bagKey = JSON.stringify(cart.lines);
  // Re-check prices and availability whenever the bag changes.
  useEffect(() => {
    if (!cart.ready || cart.lines.length === 0) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheck({ kind: "checking" });
    fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: cart.lines }) })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setCheck({ kind: "ok", verified: data });
        else if (res.status === 409 && Array.isArray(data.issues)) setCheck({ kind: "issues", issues: data.issues });
        else setCheck({ kind: "error" });
      })
      .catch(() => !cancelled && setCheck({ kind: "error" }));
    track("checkout_start", { lines: cart.lines.length });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.ready, bagKey]);

  // At the payment step: can this bag be paid online now, and what exactly does it cost?
  useEffect(() => {
    if (step !== 3 || check.kind !== "ok") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline({ kind: "unknown" });
    fetch("/api/checkout/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: cart.lines, mode: details.mode, country: details.country }) })
      .then((res) => res.json())
      .then((data) => !cancelled && setOnline(data?.online && data.quote ? { kind: "on", quote: data.quote, policies: data.policies ?? [] } : { kind: "off" }))
      .catch(() => !cancelled && setOnline({ kind: "off" }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, check.kind, bagKey, details.mode, details.country]);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = readSession<Details>(DETAILS_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setDetails({ ...emptyDetails, ...saved, consent: false });
  }, []);
  useEffect(() => {
    if (restored.current) writeSession(DETAILS_KEY, { ...details, consent: false });
  }, [details]);

  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    const name = (code: string) => {
      try {
        return names.of(code) ?? code;
      } catch {
        return code;
      }
    };
    const rest = getCountries()
      .filter((x) => /^[A-Z]{2}$/.test(x) && !FIRST.includes(x) && x !== "AC" && x !== "TA" && x !== "XK")
      .map((code) => ({ code, name: name(code) }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
    return [...FIRST.map((code) => ({ code, name: name(code) })), ...rest];
  }, [locale]);

  const set = <K extends keyof Details>(k: K, v: Details[K]) => setDetails((d) => ({ ...d, [k]: v }));
  const id = (k: string) => `${uid}-${k}`;

  function validateDetails() {
    const e: typeof errors = {};
    if (!details.name.trim()) e.name = c.errors.name;
    const phone = details.phone.replace(/[\s().-]/g, "");
    if (!/^(\+|00)[1-9]\d{6,14}$/.test(phone)) e.phone = c.errors.phone;
    if (details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(details.email.trim())) e.email = c.errors.email;
    if (details.method === "email" && !details.email.trim()) e.email = c.errors.emailNeeded;
    return e;
  }
  function validateDelivery() {
    const e: typeof errors = {};
    if (details.mode === "deliver") {
      if (!details.country) e.country = c.errors.country;
      if (!details.city.trim()) e.city = c.errors.city;
      if (!details.address.trim()) e.address = c.errors.address;
    }
    return e;
  }

  function next(e: FormEvent, validate: () => typeof errors, to: number) {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[aria-invalid="true"]`)?.focus());
      return;
    }
    setStep(to);
    requestAnimationFrame(() => document.getElementById(`${uid}-step-${to}`)?.focus());
  }

  const verified = check.kind === "ok" ? check.verified : undefined;
  const placeLabel = details.mode === "collect" ? s.messages.collect : fmt(s.messages.deliveryTo, { place: [details.city, countries.find((x) => x.code === details.country)?.name].filter(Boolean).join(", ") });
  const waLines: PurchaseLine[] = (verified?.lines ?? []).map((l) => ({ ref: l.ref, sku: l.sku, name: `${l.brand ?? ""} ${l.name}`.trim(), options: l.options, qty: l.qty, price: formatAED(l.lineAED) }));
  const waMessage = (reference?: string) =>
    purchaseMessage(
      waLines,
      {
        intro: s.messages.purchaseIntro,
        code: s.messages.code,
        total: verified ? `${c.subtotal}: ${verified.subtotalLabel}` : undefined,
        delivery: details.mode === "collect" ? s.messages.collect : details.city ? placeLabel : undefined,
        reference: reference ? fmt(s.messages.requestRef, { ref: reference }) : undefined,
        confirm: s.messages.confirm,
      },
      locale,
    ) + (details.name.trim() ? `\n${t.messages.labels.name}: ${details.name.trim()}` : "");

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!details.consent) {
      setErrors({ consent: c.errors.consent });
      requestAnimationFrame(() => document.getElementById(id("consent"))?.focus());
      return;
    }
    let key = readSession<{ bag: string; key: string }>(IDEM_KEY);
    // One key per bag: a retry or double click returns the same reference.
    if (!key || key.bag !== bagKey) {
      key = { bag: bagKey, key: crypto.randomUUID() };
      writeSession(IDEM_KEY, key);
    }
    setSubmit({ kind: "sending" });
    try {
      const res = await fetch("/api/purchase-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: cart.lines,
          customer: { name: details.name, email: details.email, phone: details.phone, method: details.method },
          delivery: { mode: details.mode, country: details.country, city: details.city, address: details.address, notes: details.notes },
          consent: true,
          idempotencyKey: key.key,
          website: (document.getElementById(id("website")) as HTMLInputElement | null)?.value ?? "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.reference === "string") {
        writeSession(RECEIVED_KEY, { reference: data.reference, message: waMessage(data.reference), method: details.method });
        try {
          window.sessionStorage.removeItem(IDEM_KEY);
        } catch {}
        cart.clear();
        router.push(href(`/checkout/received?ref=${encodeURIComponent(data.reference)}`));
        return;
      }
      if (res.status === 409) {
        setCheck({ kind: "issues", issues: data.issues ?? [] });
        setStep(0);
        setSubmit({ kind: "idle" });
        return;
      }
      if (res.status === 400 && Array.isArray(data.fields)) {
        const map: typeof errors = {};
        for (const f of data.fields as string[]) {
          if (f === "emailNeeded") map.email = c.errors.emailNeeded;
          else if (f in c.errors) map[f as keyof Details] = c.errors[f as keyof typeof c.errors];
        }
        setErrors(map);
        setStep(map.name || map.phone || map.email ? 1 : map.country || map.city || map.address ? 2 : 3);
        setSubmit({ kind: "idle" });
        return;
      }
      if (res.status === 503) return setSubmit({ kind: "unavailable", verified: data.verified });
      setSubmit({ kind: "error", message: res.status === 429 ? c.errors.rate : c.errors.generic });
    } catch {
      setSubmit({ kind: "error", message: c.errors.network });
    }
  }

  /** Pays online: the order is created and held, then the provider's secure page opens. */
  async function pay(e: FormEvent) {
    e.preventDefault();
    if (!details.consent) {
      setErrors({ consent: c.errors.consent });
      requestAnimationFrame(() => document.getElementById(id("consent"))?.focus());
      return;
    }
    // One idempotency key and one order token per bag: a retry reopens the same order and payment.
    const saved = readSession<{ bag: string; key: string; token?: string }>(IDEM_KEY);
    let key: { bag: string; key: string; token: string };
    if (saved?.bag === bagKey && saved.token) {
      key = { ...saved, token: saved.token };
    } else {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      key = { bag: bagKey, key: saved?.bag === bagKey ? saved.key : crypto.randomUUID(), token };
      writeSession(IDEM_KEY, key);
    }
    setSubmit({ kind: "sending" });
    try {
      const res = await fetch("/api/checkout/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: cart.lines,
          customer: { name: details.name, email: details.email, phone: details.phone, method: details.method },
          delivery: { mode: details.mode, country: details.country, city: details.city, address: details.address, notes: details.notes },
          consent: true,
          idempotencyKey: key.key,
          orderToken: key.token,
          website: (document.getElementById(id("website")) as HTMLInputElement | null)?.value ?? "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      const target = typeof data.redirectUrl === "string" ? data.redirectUrl : typeof data.orderUrl === "string" ? data.orderUrl : null;
      if (res.ok && target) {
        try {
          window.sessionStorage.setItem(ORDER_TOKEN_KEY, key.token);
        } catch {}
        cart.clear();
        window.location.assign(target);
        return;
      }
      if (res.status === 409 && data.code === "online_unavailable") {
        setOnline({ kind: "off" });
        setSubmit({ kind: "idle" });
        return;
      }
      if (res.status === 409) {
        setCheck({ kind: "issues", issues: data.issues ?? [] });
        setStep(0);
        setSubmit({ kind: "idle" });
        return;
      }
      if (typeof data.orderUrl === "string") {
        setSubmit({ kind: "error", message: c.online.providerDown });
        return;
      }
      setSubmit({ kind: "error", message: res.status === 429 ? c.errors.rate : c.errors.generic });
    } catch {
      setSubmit({ kind: "error", message: c.errors.network });
    }
  }

  if (!cart.ready) return <p className="container muted checkout__loading">{t.cart.loading}</p>;
  if (cart.lines.length === 0) {
    return (
      <div className="container checkout checkout--empty">
        <h1 className="display display--sm">{c.title}</h1>
        <p>{c.empty}</p>
        <Link href={href("/collection")} className="btn btn--dark">
          {c.browse}
        </Link>
      </div>
    );
  }

  const issueText = (code: string, max?: number) =>
    code === "invalid_quantity" ? fmt(t.cart.issues.invalid_quantity, { n: max ?? 1 }) : code === "choose_version" ? fmt(s.product.chooseFirst, { option: s.product.options.size.toLocaleLowerCase(locale) }) : (t.cart.issues[code as keyof typeof t.cart.issues] ?? t.cart.errorGeneric);
  const steps = [c.steps.bag, c.steps.details, c.steps.delivery, c.steps.payment];

  return (
    <div className="container checkout">
      <h1 className="display display--sm checkout__title">{c.title}</h1>
      <ol className="checkout__steps" aria-label={c.title}>
        {steps.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} data-done={i < step || undefined}>
            <span aria-hidden="true">{i + 1}</span> {label}
          </li>
        ))}
      </ol>

      <div className="checkout__grid">
        <div className="checkout__main">
          {/* 1 · Bag */}
          <Step n={0} active={step} title={c.steps.bag} uid={uid} onEdit={() => setStep(0)} editLabel={c.edit} summary={verified ? verified.subtotalLabel : undefined}>
            {check.kind === "checking" && <p className="muted" role="status">{c.checking}</p>}
            {check.kind === "error" && (
              <p className="field__error" role="alert">
                {t.cart.errorNetwork}
              </p>
            )}
            {check.kind === "issues" && (
              <div className="notice" role="alert">
                <p>{c.changed}</p>
                <ul>
                  {check.issues.map((i) => (
                    <li key={`${i.ref}|${i.sku ?? ""}`}>
                      <bdi dir="ltr">{i.ref}</bdi>: {issueText(i.code, i.max)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="checkout-lines">
              {cart.lines.map((l) => {
                const r = resolveLine(l, itemByRef);
                const v = verified?.lines.find((x) => x.ref === l.ref && (x.sku ?? "") === (l.sku ?? ""));
                return (
                  <li key={r.key} className="checkout-line">
                    <span className="checkout-line__img">{r.image && <Image src={r.image.src} alt="" width={r.image.width} height={r.image.height} sizes="72px" />}</span>
                    <span className="checkout-line__text">
                      <span className="eyebrow" lang="en" dir="ltr">
                        {r.item?.brand}
                      </span>
                      <Link href={href(productPath(l.ref))}>{r.item?.name ?? l.ref}</Link>
                      {v?.options && <span className="small">{v.options}</span>}
                      <span className="muted small">
                        {s.product.code} <bdi dir="ltr">{l.sku && l.sku !== l.ref ? `${l.ref} / ${l.sku}` : l.ref}</bdi> · {t.cart.qty} {l.qty}
                      </span>
                    </span>
                    <span className="checkout-line__price" dir="ltr">
                      {v ? formatAED(v.lineAED) : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
            {step === 0 && (
              <button type="button" className="btn btn--dark" disabled={check.kind !== "ok"} onClick={() => setStep(1)}>
                {c.continue}
              </button>
            )}
          </Step>

          {/* 2 · Details */}
          <Step n={1} active={step} title={c.steps.details} uid={uid} onEdit={() => setStep(1)} editLabel={c.edit} summary={details.name ? `${details.name} · ${details.phone}` : undefined}>
            <form noValidate onSubmit={(e) => next(e, validateDetails, 2)} className="form__grid">
              <Field id={id("name")} label={c.name} error={errors.name} required>
                <input id={id("name")} value={details.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" maxLength={80} aria-invalid={!!errors.name} required dir="auto" />
              </Field>
              <Field id={id("phone")} label={c.phone} error={errors.phone} hint={c.phoneHint} required>
                <input id={id("phone")} type="tel" value={details.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" inputMode="tel" maxLength={24} aria-invalid={!!errors.phone} required dir="ltr" />
              </Field>
              <Field id={id("email")} label={c.email} error={errors.email}>
                <input id={id("email")} type="email" value={details.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" maxLength={254} aria-invalid={!!errors.email} dir="ltr" />
              </Field>
              <fieldset className="field field--wide">
                <legend>{c.contactMethod}</legend>
                <div className="choice-row">
                  {(["whatsapp", "call", "email"] as const).map((m) => (
                    <label key={m} className="choice">
                      <input type="radio" name={id("method")} checked={details.method === m} onChange={() => set("method", m)} />
                      <span>{c.methods[m]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" className="btn btn--dark">
                {c.continue}
              </button>
            </form>
          </Step>

          {/* 3 · Delivery */}
          <Step n={2} active={step} title={c.steps.delivery} uid={uid} onEdit={() => setStep(2)} editLabel={c.edit} summary={step > 2 ? placeLabel : undefined}>
            <form noValidate onSubmit={(e) => next(e, validateDelivery, 3)} className="form__grid">
              <fieldset className="field field--wide">
                <legend>{c.receive}</legend>
                <div className="choice-row">
                  <label className="choice">
                    <input type="radio" name={id("mode")} checked={details.mode === "deliver"} onChange={() => set("mode", "deliver")} />
                    <span>{c.deliver}</span>
                  </label>
                  <label className="choice">
                    <input type="radio" name={id("mode")} checked={details.mode === "collect"} onChange={() => set("mode", "collect")} />
                    <span>{c.collect}</span>
                  </label>
                </div>
              </fieldset>
              {details.mode === "deliver" && (
                <>
                  <Field id={id("country")} label={c.country} error={errors.country} required>
                    <select id={id("country")} value={details.country} onChange={(e) => set("country", e.target.value)} autoComplete="country" aria-invalid={!!errors.country}>
                      {countries.map((x) => (
                        <option key={x.code} value={x.code}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id={id("city")} label={c.city} error={errors.city} required>
                    <input id={id("city")} value={details.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" maxLength={80} aria-invalid={!!errors.city} dir="auto" />
                  </Field>
                  <Field id={id("address")} label={c.address} error={errors.address} hint={c.addressHint} required wide>
                    <textarea id={id("address")} value={details.address} onChange={(e) => set("address", e.target.value)} autoComplete="street-address" rows={2} maxLength={300} aria-invalid={!!errors.address} dir="auto" />
                  </Field>
                </>
              )}
              <Field id={id("notes")} label={c.notes} wide>
                <textarea id={id("notes")} value={details.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={600} dir="auto" />
              </Field>
              <button type="submit" className="btn btn--dark">
                {c.continue}
              </button>
            </form>
          </Step>

          {/* 4 · Payment */}
          <Step n={3} active={step} title={c.steps.payment} uid={uid} editLabel={c.edit}>
            {online.kind === "unknown" && <p className="muted" role="status">{c.checking}</p>}
            {online.kind === "on" && (
              <form noValidate onSubmit={pay}>
                <div className="notice">
                  <p>{c.online.notice}</p>
                  {online.quote.transit_days_min !== null && online.quote.transit_days_max !== null && details.mode === "deliver" && (
                    <p>{fmt(c.online.transit, { min: online.quote.transit_days_min, max: online.quote.transit_days_max })}</p>
                  )}
                  {online.quote.duties_treatment === "recipient_pays" && <p>{online.quote.duties_note ?? c.online.duties}</p>}
                </div>
                <div className="visually-hidden" aria-hidden="true">
                  <label htmlFor={id("website")}>{t.websiteSend.honeypot}</label>
                  <input id={id("website")} tabIndex={-1} autoComplete="off" />
                </div>
                <label className="consent">
                  <input id={id("consent")} type="checkbox" checked={details.consent} onChange={(e) => set("consent", e.target.checked)} aria-invalid={!!errors.consent} aria-describedby={errors.consent ? id("consent-err") : undefined} />
                  <span>
                    {c.online.accept}{" "}
                    {online.policies.map((p, i) => (
                      <span key={p.kind}>
                        {i > 0 && ` ${c.online.and} `}
                        <Link href={href(policyPath[p.kind] ?? "/")} target="_blank">{p.title}</Link>
                      </span>
                    ))}
                    .
                  </span>
                </label>
                {errors.consent && <p id={id("consent-err")} className="field__error">{errors.consent}</p>}
                {submit.kind === "error" && <p className="field__error" role="alert">{submit.message}</p>}
                <button type="submit" className="btn btn--dark btn--block" disabled={submit.kind === "sending" || check.kind !== "ok"} aria-busy={submit.kind === "sending"}>
                  {submit.kind === "sending" ? c.online.opening : fmt(c.online.pay, { amount: formatAEDExact(Number(online.quote.total)) })}
                </button>
              </form>
            )}
            {online.kind === "off" && (
            <form noValidate onSubmit={send}>
              <div className="notice">
                <p>
                  <strong>{c.paymentStrong}</strong> {c.paymentText}
                </p>
              </div>
              <div className="visually-hidden" aria-hidden="true">
                <label htmlFor={id("website")}>{t.websiteSend.honeypot}</label>
                <input id={id("website")} tabIndex={-1} autoComplete="off" />
              </div>
              <label className="consent">
                <input id={id("consent")} type="checkbox" checked={details.consent} onChange={(e) => set("consent", e.target.checked)} aria-invalid={!!errors.consent} aria-describedby={errors.consent ? id("consent-err") : undefined} />
                <span>{c.consent}</span>
              </label>
              {errors.consent && (
                <p id={id("consent-err")} className="field__error">
                  {errors.consent}
                </p>
              )}
              {submit.kind === "unavailable" ? (
                <div className="notice" role="status">
                  <p>
                    <strong>{c.unavailableStrong}</strong> {c.unavailableText}
                  </p>
                  <a className="btn btn--dark btn--block" href={whatsappUrl(waMessage())} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "checkout" })}>
                    <WhatsAppIcon size={18} /> {c.whatsapp}
                  </a>
                </div>
              ) : (
                <>
                  {submit.kind === "error" && (
                    <div role="alert">
                      <p className="field__error">{submit.message}</p>
                      <a className="btn btn--line" href={whatsappUrl(waMessage())} target="_blank" rel="noopener noreferrer">
                        <WhatsAppIcon size={18} /> {c.whatsapp}
                      </a>
                    </div>
                  )}
                  <button type="submit" className="btn btn--dark btn--block" disabled={submit.kind === "sending" || check.kind !== "ok"} aria-busy={submit.kind === "sending"}>
                    {submit.kind === "sending" ? c.sending : c.submit}
                  </button>
                </>
              )}
            </form>
            )}
          </Step>
        </div>

        <aside className="checkout__summary" aria-label={c.summary}>
          <h2 className="checkout__summary-title">{c.summary}</h2>
          {online.kind === "on" && step === 3 ? (
            <dl className="totals">
              <div>
                <dt>{c.subtotal}</dt>
                <dd dir="ltr">{formatAEDExact(Number(online.quote.subtotal))}</dd>
              </div>
              <div>
                <dt>{c.delivery}</dt>
                <dd dir="ltr">{formatAEDExact(Number(online.quote.shipping))}</dd>
              </div>
              <div>
                <dt>{c.vat}</dt>
                <dd>
                  {online.quote.vat_treatment === "zero_rated"
                    ? c.online.zeroRated
                    : fmt(online.quote.prices_include_vat ? c.online.vatIncluded : c.online.vatAdded, { rate: online.quote.vat_rate ?? 0, amount: formatAEDExact(Number(online.quote.vat)) })}
                </dd>
              </div>
              {online.quote.duties_treatment === "recipient_pays" && (
                <div>
                  <dt>{c.online.dutiesLabel}</dt>
                  <dd>{c.online.dutiesShort}</dd>
                </div>
              )}
              <div className="totals__due">
                <dt>{c.online.total}</dt>
                <dd dir="ltr">{formatAEDExact(Number(online.quote.total))}</dd>
              </div>
            </dl>
          ) : (
            <dl className="totals">
              <div>
                <dt>{c.subtotal}</dt>
                <dd dir="ltr">{verified ? verified.subtotalLabel : "—"}</dd>
              </div>
              <div>
                <dt>{c.delivery}</dt>
                <dd>{c.deliveryValue}</dd>
              </div>
              <div>
                <dt>{c.vat}</dt>
                <dd>{c.vatValue}</dd>
              </div>
              <div className="totals__due">
                <dt>{c.dueNow}</dt>
                <dd>{c.dueNowValue}</dd>
              </div>
            </dl>
          )}
          {!(online.kind === "on" && step === 3) && <p className="muted small">{s.bag.note}</p>}
        </aside>
      </div>
    </div>
  );
}

function Step({
  n,
  active,
  title,
  uid,
  children,
  onEdit,
  editLabel,
  summary,
}: {
  n: number;
  active: number;
  title: string;
  uid: string;
  children: ReactNode;
  onEdit?: () => void;
  editLabel: string;
  summary?: string;
}) {
  const state = n === active ? "active" : n < active ? "done" : "todo";
  return (
    <section className={`checkout-step checkout-step--${state}`} aria-labelledby={`${uid}-step-${n}`}>
      <header className="checkout-step__head">
        <h2 id={`${uid}-step-${n}`} tabIndex={-1}>
          <span aria-hidden="true">{n + 1}</span> {title}
        </h2>
        {state === "done" && onEdit && (
          <button type="button" className="link-btn small" onClick={onEdit}>
            {editLabel}
          </button>
        )}
      </header>
      {state === "done" && summary && <p className="muted small checkout-step__summary">{summary}</p>}
      {/* The bag stays visible after it's confirmed; later steps open one at a time. */}
      {(state === "active" || (n === 0 && state === "done")) && <div className="checkout-step__body">{children}</div>}
    </section>
  );
}

function Field({ id, label, error, hint, required, wide, children }: { id: string; label: string; error?: string; hint?: string; required?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`field${wide ? " field--wide" : ""}`}>
      <label htmlFor={id}>
        {label} {required && <span aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <p className="field__hint">{hint}</p>}
      {error && <p className="field__error">{error}</p>}
    </div>
  );
}
