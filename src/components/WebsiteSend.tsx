"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { track } from "@/lib/analytics";
import { useSite } from "./SiteProvider";

export const contactMethods = ["WhatsApp", "Phone call", "Email"] as const;
export type ContactMethod = (typeof contactMethods)[number];

export interface WebsiteSendRequest {
  kind: "sourcing" | "viewing";
  /** Structured form fields; the server rebuilds the message from these. */
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
        <p className="handoff__note">Sending directly from the website is switched off on this preview. Please use WhatsApp or email above.</p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="handoff__direct">
        <button type="button" className="link-btn" onClick={() => setOpen(true)} aria-expanded="false" aria-controls={id("form")}>
          Prefer not to use WhatsApp? Send this request from the website
        </button>
      </div>
    );
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const value = contact.trim();
    const invalid =
      method === "Email"
        ? !EMAIL.test(value) && "Enter a valid email address."
        : !PHONE.test(value) && "Enter a valid phone number, including country code.";
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
        body: JSON.stringify({ ...send, contactMethod: method, contactValue: value, website: honeypot }),
      });
      const data = (await res.json().catch(() => ({}))) as { reference?: string; error?: string };
      if (res.ok && data.reference) {
        track("enquiry_sent", { kind: send.kind });
        onSent({ reference: data.reference, method, contactValue: value });
        return;
      }
      setError(data.error ?? "We couldn’t send your request just now. Please use WhatsApp or email.");
    } catch {
      setError("We couldn’t reach our server. Please check your connection, or use WhatsApp or email.");
    } finally {
      setPending(false);
    }
    requestAnimationFrame(() => errRef.current?.focus());
  }

  return (
    <form id={id("form")} className={`form form--${tone} handoff__direct handoff__direct--open`} onSubmit={onSubmit} noValidate>
      <p className="handoff__direct-title">Send from the website</p>
      <p className="form__help">We’ll store this request and reply personally. Tell us where to reach you.</p>

      {/* Honeypot for automated submissions; hidden from people and assistive technology. */}
      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor={id("website")}>Website</label>
        <input id={id("website")} tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>

      <div className="form__grid">
        <fieldset className="field field--choice field--wide">
          <legend>Reply by</legend>
          <div className="choice-row">
            {contactMethods.map((m) => (
              <label key={m} className="choice">
                <input type="radio" name={id("method")} value={m} checked={method === m} onChange={() => setMethod(m)} />
                <span>{m}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field field--wide">
          <label htmlFor={id("contact")}>
            {method === "Email" ? "Email address" : "Phone number"} <span aria-hidden="true">*</span>
          </label>
          <input
            id={id("contact")}
            type={method === "Email" ? "email" : "tel"}
            autoComplete={method === "Email" ? "email" : "tel"}
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
          {pending ? "Sending…" : "Send to SEVN HEVN"}
        </button>
        <p className="form__fine">
          Your details are used only to reply to this request.{" "}
          <button type="button" className="link-btn" onClick={() => openPanel({ type: "policy", id: "privacy" })}>
            Privacy
          </button>
        </p>
      </div>
    </form>
  );
}
