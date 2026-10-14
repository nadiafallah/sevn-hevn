"use client";

import { useId, useState, type FormEvent } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { track } from "@/lib/analytics";
import { useSite } from "./SiteProvider";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string };

/**
 * Footer newsletter sign-up. Stores the address through /api/newsletter (production only), with
 * the consent wording shown under the button. Never fakes a confirmation: on previews and local
 * development the server answers that signing up isn't available, and the form says so.
 */
export function NewsletterForm() {
  const { t } = useI18n();
  const { openPanel } = useSite();
  const n = t.footer.newsletter;
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "sending") return;
    const address = email.trim();
    if (!EMAIL.test(address)) {
      setStatus({ kind: "error", message: n.invalidEmail });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: address, website: honeypot }),
      });
      if (res.ok) {
        track("newsletter_signup", { source: "footer" });
        setStatus({ kind: "done" });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { code?: string };
      const message =
        data.code === "invalid_email"
          ? n.invalidEmail
          : data.code === "newsletter_unavailable"
            ? n.unavailable
            : data.code === "rate_limited"
              ? n.rateLimited
              : n.error;
      setStatus({ kind: "error", message });
    } catch {
      setStatus({ kind: "error", message: n.error });
    }
  }

  if (status.kind === "done") {
    return (
      <p className="newsletter__done" role="status">
        {n.success}
      </p>
    );
  }

  const sending = status.kind === "sending";
  const errorId = `${id}-error`;

  return (
    <form className="newsletter" onSubmit={submit} noValidate>
      <div className="newsletter__field">
        <label htmlFor={`${id}-name`} className="visually-hidden">
          {n.name}
        </label>
        <input
          id={`${id}-name`}
          className="newsletter__input"
          type="text"
          name="name"
          autoComplete="name"
          maxLength={80}
          placeholder={n.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="newsletter__field">
        <label htmlFor={`${id}-email`} className="visually-hidden">
          {n.email}
        </label>
        <input
          id={`${id}-email`}
          className="newsletter__input"
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          required
          maxLength={254}
          placeholder={n.email}
          value={email}
          aria-invalid={status.kind === "error" && status.message === n.invalidEmail ? true : undefined}
          aria-describedby={status.kind === "error" ? errorId : undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status.kind === "error") setStatus({ kind: "idle" });
          }}
        />
      </div>
      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor={`${id}-website`}>{n.honeypot}</label>
        <input id={`${id}-website`} type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>
      <button type="submit" className="newsletter__join" disabled={sending}>
        {sending ? n.joining : n.join}
      </button>
      {status.kind === "error" && (
        <p id={errorId} className="newsletter__error" role="alert">
          {status.message}
        </p>
      )}
      <p className="newsletter__consent">
        {n.consent}{" "}
        <a
          href="#privacy"
          onClick={(e) => {
            e.preventDefault();
            openPanel({ type: "policy", id: "privacy" });
          }}
        >
          {n.privacy}
        </a>
      </p>
    </form>
  );
}
