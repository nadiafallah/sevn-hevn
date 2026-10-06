"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { site } from "@/config/site";
import { dirOf, t, type Locale } from "@/lib/concierge/i18n";
import type { Choice, Prompt } from "@/lib/concierge/types";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { useSite } from "../SiteProvider";
import { preparePhoto, useConcierge, type ChatError } from "./useConcierge";

/**
 * The SEVN HEVN concierge chat. One component and one conversation for both the floating widget
 * and the /chat page. Arabic is shown right-to-left; numbers, references and phone numbers stay
 * left-to-right. WhatsApp and phone stay one tap away at all times.
 */
export function ConciergeChat({ variant, onClose, active = true }: { variant: "widget" | "page"; onClose?: () => void; active?: boolean }) {
  const chat = useConcierge(variant, active);
  const { locale, messages, prompt, status, error, pending } = chat;
  const L = t(locale);
  const uid = useId();
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [localError, setLocalError] = useState<ChatError | null>(null);
  const { openPanel } = useSite();
  const busy = status === "busy";

  // Keep the newest message in view and return focus to the composer after each reply.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, busy]);
  useEffect(() => {
    if (status === "ready" && active) inputRef.current?.focus({ preventScroll: true });
  }, [status, active, prompt]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConsent(false);
  }, [prompt?.kind]);

  const wa = whatsappUrl(generalMessage());

  function submitText(e?: FormEvent) {
    e?.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    chat.send({ type: "text", value }, prompt?.kind === "code" ? "••••••" : value);
  }

  function onChoice(c: Choice) {
    if (busy) return;
    chat.send({ type: "choice", value: c.id }, c.label);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    chat.clearError();
    try {
      const blob = await preparePhoto(file);
      await chat.uploadPhoto(blob);
    } catch (e) {
      chat.clearError();
      const code = e instanceof Error ? e.message : "";
      setLocalError(code === "photo_too_large" ? "photo_too_large" : "photo_type");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  const shownError = localError ?? error;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitText();
    }
  }

  const errorText: Record<ChatError, string> = {
    start_failed: L.ui.startFailed,
    connection: L.ui.connectionLost,
    rate_limited: L.ui.rateLimited,
    unavailable: L.ui.unavailableTitle,
    server_error: L.ui.genericError,
    photo_type: L.ui.photoType,
    photo_too_large: L.ui.photoTooLarge,
    photo_failed: L.ui.photoFailed,
    photo_limit: L.a.photoLimit,
  };

  const inputKind = prompt?.kind ?? "text";
  const showComposer = status !== "unavailable" && prompt && prompt.kind !== "review";
  const placeholder = inputKind === "phone" ? "+971 50 123 4567" : inputKind === "email" ? "name@example.com" : inputKind === "code" ? "123456" : L.ui.placeholder;

  return (
    <section className={`cc cc--${variant}`} dir={dirOf(locale)} lang={locale} aria-labelledby={`${uid}-title`}>
      <header className="cc__head">
        <div className="cc__brand">
          <h2 id={`${uid}-title`} className="cc__title">
            {L.ui.title}
          </h2>
          <p className="cc__subtitle">{L.ui.subtitle}</p>
        </div>
        <div className="cc__tools">
          <div className="cc__lang" role="group" aria-label={L.ui.language}>
            {(["en", "ar"] as Locale[]).map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                className="cc__lang-btn"
                aria-pressed={locale === l}
                disabled={busy}
                onClick={() => chat.changeLocale(l)}
              >
                {l === "en" ? "English" : "العربية"}
              </button>
            ))}
          </div>
          {onClose && (
            <button type="button" className="cc__icon" onClick={onClose} aria-label={L.ui.close}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.4" fill="none" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <div className="cc__human">
        <button type="button" className="cc__human-btn" disabled={busy || status !== "ready"} onClick={() => chat.send({ type: "human" }, L.ui.human)}>
          {L.ui.human}
        </button>
        <a className="cc__direct" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "concierge" })}>
          {L.ui.whatsapp}
        </a>
        <a className="cc__direct" href={site.contact.telHref} onClick={() => track("call_click", { source: "concierge" })}>
          {L.ui.call}
        </a>
      </div>

      <div ref={logRef} className="cc__log" role="log" aria-live="polite" aria-relevant="additions" aria-label={L.ui.log} tabIndex={0}>
        {status === "loading" && <p className="cc__status">{L.ui.thinking}</p>}
        {status === "unavailable" && (
          <div className="cc__unavailable">
            <p className="cc__unavailable-title">{L.ui.unavailableTitle}</p>
            <p>{L.ui.unavailableBody}</p>
            <div className="cc__unavailable-actions">
              <a className="btn btn--dark" href={wa} target="_blank" rel="noopener noreferrer">
                {L.ui.whatsapp}
              </a>
              <a className="btn btn--line" href={site.contact.telHref}>
                <span dir="ltr">{site.contact.phoneDisplay}</span>
              </a>
            </div>
          </div>
        )}
        {status !== "unavailable" &&
          messages.map((m, i) => (
            <div key={i} className={`cc__msg cc__msg--${m.role}`}>
              <span className="visually-hidden">{m.role === "assistant" ? L.ui.assistant : L.ui.you}: </span>
              <p dir="auto">{m.body}</p>
            </div>
          ))}
        {pending?.preview && (busy || shownError) && (
          <div className="cc__msg cc__msg--customer cc__msg--pending" aria-hidden="true">
            <p dir="auto">{pending.preview}</p>
          </div>
        )}
        {busy && (
          <p className="cc__status" role="status">
            {pending?.payload.action === "photo" ? L.ui.photoUploading : L.ui.thinking}
          </p>
        )}
      </div>

      {shownError && status !== "unavailable" && (
        <div className="cc__error" role="alert">
          <p>{errorText[shownError]}</p>
          {(shownError === "connection" || shownError === "server_error" || shownError === "rate_limited") && pending && (
            <button type="button" className="link-btn" onClick={() => { setLocalError(null); chat.retry(); }}>
              {L.ui.retry}
            </button>
          )}
          {shownError === "start_failed" && (
            <button type="button" className="link-btn" onClick={() => { setLocalError(null); chat.retryStart(); }}>
              {L.ui.retry}
            </button>
          )}
          {shownError !== "connection" && shownError !== "start_failed" && !pending && (
            <button type="button" className="link-btn" onClick={() => { setLocalError(null); chat.clearError(); }}>
              {L.ui.close}
            </button>
          )}
        </div>
      )}

      {status !== "unavailable" && prompt && (
        <div className="cc__prompt">
          {prompt.kind === "review" && prompt.review && <Review prompt={prompt} consent={consent} setConsent={setConsent} busy={busy} onSubmit={() => chat.send({ type: "submit", consent }, prompt.review!.submit)} onEdit={() => chat.send({ type: "choice", value: "edit" }, prompt.review!.edit)} uid={uid} />}

          {prompt.choices.length > 0 && (
            <div className="cc__choices">
              {prompt.choices.map((c) =>
                c.href ? (
                  <a key={c.id} className="cc__choice cc__choice--link" href={c.href === "#whatsapp" ? wa : c.href} target="_blank" rel="noopener noreferrer">
                    {c.label}
                  </a>
                ) : (
                  <button key={c.id} type="button" className="cc__choice" disabled={busy} onClick={() => onChoice(c)}>
                    {c.label}
                  </button>
                ),
              )}
            </div>
          )}

          {showComposer && (
            <form className="cc__composer" onSubmit={submitText}>
              <label htmlFor={`${uid}-input`} className="visually-hidden">
                {L.ui.placeholder}
              </label>
              {prompt.multiline ? (
                <textarea
                  id={`${uid}-input`}
                  ref={inputRef}
                  className="cc__input"
                  rows={2}
                  dir="auto"
                  value={text}
                  maxLength={prompt.maxLength}
                  placeholder={placeholder}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={busy}
                />
              ) : (
                <input
                  id={`${uid}-input`}
                  ref={inputRef}
                  className="cc__input"
                  dir={inputKind === "phone" || inputKind === "email" || inputKind === "code" ? "ltr" : "auto"}
                  type={inputKind === "email" ? "email" : inputKind === "phone" ? "tel" : "text"}
                  inputMode={inputKind === "phone" ? "tel" : inputKind === "code" ? "numeric" : inputKind === "email" ? "email" : "text"}
                  autoComplete={inputKind === "phone" ? "tel" : inputKind === "email" ? "email" : inputKind === "code" ? "one-time-code" : "off"}
                  enterKeyHint="send"
                  value={text}
                  maxLength={prompt.maxLength}
                  placeholder={placeholder}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy}
                />
              )}
              {prompt.allowPhoto && (
                <>
                  <input ref={fileRef} type="file" accept="image/*" className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => onFile(e.target.files?.[0])} />
                  <button type="button" className="cc__icon cc__photo" onClick={() => fileRef.current?.click()} disabled={busy} aria-label={L.ui.addPhoto} title={L.ui.addPhoto}>
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path d="M4 7h3l2-2h6l2 2h3v12H4z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
                      <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
                    </svg>
                  </button>
                </>
              )}
              <button type="submit" className="cc__send" disabled={busy || !text.trim()}>
                {L.ui.send}
              </button>
            </form>
          )}
          {prompt.allowPhoto && <p className="cc__fine">{L.ui.photoHelp}</p>}
        </div>
      )}

      <footer className="cc__foot">
        <p className="cc__fine">
          {L.ui.privacyNote}{" "}
          <button type="button" className="link-btn" onClick={() => openPanel({ type: "policy", id: "privacy" })}>
            {L.ui.privacyLink}
          </button>
        </p>
        {status !== "unavailable" && (
          <button type="button" className="link-btn cc__fine" onClick={chat.startOver} disabled={busy}>
            {L.ui.startOver}
          </button>
        )}
      </footer>
    </section>
  );
}

function Review({
  prompt,
  consent,
  setConsent,
  busy,
  onSubmit,
  onEdit,
  uid,
}: {
  prompt: Prompt;
  consent: boolean;
  setConsent: (v: boolean) => void;
  busy: boolean;
  onSubmit: () => void;
  onEdit: () => void;
  uid: string;
}) {
  const r = prompt.review!;
  return (
    <div className="cc__review">
      <p className="cc__review-title">{r.title}</p>
      <dl>
        {r.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd dir="auto">{row.value}</dd>
          </div>
        ))}
      </dl>
      <label className="cc__consent" htmlFor={`${uid}-consent`}>
        <input id={`${uid}-consent`} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{r.consent}</span>
      </label>
      <div className="cc__review-actions">
        <button type="button" className="btn btn--dark" disabled={busy} onClick={onSubmit} aria-describedby={`${uid}-consent`}>
          {r.submit}
        </button>
        <button type="button" className="btn btn--line" disabled={busy} onClick={onEdit}>
          {r.edit}
        </button>
      </div>
    </div>
  );
}
