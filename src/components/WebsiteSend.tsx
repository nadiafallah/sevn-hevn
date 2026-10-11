"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { track } from "@/lib/analytics";
import { useI18n } from "@/i18n/I18nProvider";
import { useSite } from "./SiteProvider";

/** Values understood by /api/enquiries (kept in English); labels come from the dictionary. */
export const contactMethods = ["WhatsApp", "Phone call", "Email"] as const;
export type ContactMethod = (typeof contactMethods)[number];
export const methodKey = { WhatsApp: "whatsapp", "Phone call": "phone", Email: "email" } as const satisfies Record<ContactMethod, string>;

export interface WebsiteSendRequest {
  kind: "sourcing" | "viewing";
  /** Structured form fields (ids for choices); the server rebuilds the team's message from these. */
  request: Record<string, string>;
  relatedRef?: string;
  contactMethod?: ContactMethod;
  contactValue?: string;
}

export interface SentEnquiry {
  reference: string;
  method: ContactMethod;
  contactValue: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s()-]{7,20}$/;

/**
 * Optional alternative to the WhatsApp hand-off: the request is stored by SEVN HEVN and a reference
 * is shown only after the server confirms it was saved. Hidden behind a link so WhatsApp stays primary.
 */
export function WebsiteSend({
  send,
  tone = "light",
  onSent,
}: {
  send: WebsiteSendRequest;
  tone?: "light" | "dark";
  onSent: (sent: SentEnquiry) => void;
}) {
  const { websiteEnquiries, openPanel } = useSite();
  const { t, locale } = useI18n();
  const w = t.websiteSend;
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const errRef = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<ContactMethod>(send.contactMethod ?? "WhatsApp");
  const [contact, setContact] = useState(send.contactValue ?? "");
  const [honeypot, setHoneypot] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!websiteEnquiries) {
    return (
      <div className="handoff__direct">
        <p className="handoff__note">{w.unavailable}</p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="handoff__direct">
        <button type="button" className="link-btn" onClick={() => setOpen(true)} aria-expanded="false" aria-controls={id("form")}>
          {w.toggle}
        </button>
      </div>
    );
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const value = contact.trim();
    const invalid = method === "Email" ? !EMAIL.test(value) && t.forms.errors.email : !PHONE.test(value) && t.forms.errors.phone;
    if (invalid) {
      setError(invalid);
      requestAnimationFrame(() => errRef.current?.focus());
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...send, contactMethod: method, contactValue: value, locale, website: honeypot }),
      });
      const data = (await res.json().catch(() => ({}))) as { reference?: string; error?: string; code?: string };
      if (res.ok && data.reference) {
        track("enquiry_sent", { kind: send.kind });
        onSent({ reference: data.reference, method, contactValue: value });
        return;
      }
      // The server's messages are English; show the wording for the visitor's language instead.
      setError(
        data.code === "rate_limited"
          ? w.errorRate
          : data.code === "invalid_contact"
            ? method === "Email"
              ? t.forms.errors.email
              : t.forms.errors.phone
            : res.status === 400
              ? w.errorDetails
              : data.code === "enquiries_unavailable"
                ? w.unavailable
                : w.errorSend,
      );
    } catch {
      setError(w.errorNetwork);
    } finally {
      setPending(false);
    }
    requestAnimationFrame(() => errRef.current?.focus());
  }

  return (
    <form id={id("form")} className={`form form--${tone} handoff__direct handoff__direct--open`} onSubmit={onSubmit} noValidate>
      <p className="handoff__direct-title">{w.title}</p>
      <p className="form__help">{w.help}</p>

      {/* Honeypot for automated submissions; hidden from people and assistive technology. */}
      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor={id("website")}>{w.honeypot}</label>
        <input id={id("website")} tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>

      <div className="form__grid">
        <fieldset className="field field--choice field--wide">
          <legend>{w.replyBy}</legend>
          <div className="choice-row">
            {contactMethods.map((m) => (
              <label key={m} className="choice">
                <input type="radio" name={id("method")} value={m} checked={method === m} onChange={() => setMethod(m)} />
                <span>{t.forms.methods[methodKey[m]]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field field--wide">
          <label htmlFor={id("contact")}>
            {method === "Email" ? t.forms.emailAddress : t.forms.phoneNumber} <span aria-hidden="true">*</span>
          </label>
          <input
            id={id("contact")}
            type={method === "Email" ? "email" : "tel"}
            autoComplete={method === "Email" ? "email" : "tel"}
            dir="ltr"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            maxLength={120}
            required
            aria-invalid={!!error}
            aria-describedby={error ? id("err") : undefined}
          />
        </div>
      </div>

      {error && (
        <p ref={errRef} className="field__error" id={id("err")} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}

      <div className="form__actions">
        <button type="submit" className="btn btn--line" disabled={pending} aria-busy={pending}>
          {pending ? w.sending : w.send}
        </button>
        <p className="form__fine">
          {w.fine}{" "}
          <button type="button" className="link-btn" onClick={() => openPanel({ type: "policy", id: "privacy" })}>
            {w.privacy}
          </button>
        </p>
      </div>
    </form>
  );
}
