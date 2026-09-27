"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { viewingMessage } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { site } from "@/config/site";
import type { ViewingPrefill } from "./SiteProvider";
import { Handoff } from "./Handoff";

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function ViewingForm({ prefill }: { prefill?: ViewingPrefill }) {
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const formRef = useRef<HTMLFormElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<{ interest?: string; date?: string }>({});
  const [minDate] = useState(todayISO);
  const [values, setValues] = useState({
    interest: prefill?.interest ?? "",
    date: "",
    timeOfDay: "",
    name: "",
    notes: "",
  });
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const e: typeof error = {};
    if (!values.interest.trim()) e.interest = "Tell us which piece you’d like to see, or that you’d like a consultation.";
    if (values.date && values.date < minDate) e.date = "Choose today or a later date.";
    setError(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => errRef.current?.focus());
      return;
    }
    setMessage(viewingMessage({ ...values, date: formatDate(values.date), relatedRef: prefill?.relatedRef }));
    track("viewing_prepared");
  }

  if (message) {
    return (
      <Handoff
        message={message}
        emailSubject="Private viewing request"
        source="viewing"
        onEdit={() => {
          setMessage(null);
          requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("input")?.focus());
        }}
      />
    );
  }

  const errs = Object.values(error).filter(Boolean);

  return (
    <form ref={formRef} className="form" onSubmit={onSubmit} noValidate>
      {errs.length > 0 && (
        <div ref={errRef} className="form__summary" role="alert" tabIndex={-1}>
          <ul>
            {errs.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="form__grid">
        <div className="field field--wide">
          <label htmlFor={id("interest")}>
            Piece or consultation <span aria-hidden="true">*</span>
          </label>
          <input
            id={id("interest")}
            value={values.interest}
            onChange={set("interest")}
            maxLength={160}
            required
            placeholder="e.g. A listed piece, or a consultation"
            aria-invalid={!!error.interest}
            aria-describedby={error.interest ? id("interest-err") : undefined}
          />
          {error.interest && (
            <p className="field__error" id={id("interest-err")}>
              {error.interest}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={id("date")}>Preferred date</label>
          <input
            id={id("date")}
            type="date"
            min={minDate}
            value={values.date}
            onChange={set("date")}
            aria-invalid={!!error.date}
            aria-describedby={error.date ? id("date-err") : undefined}
          />
          {error.date && (
            <p className="field__error" id={id("date-err")}>
              {error.date}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={id("time")}>Preferred time</label>
          <select id={id("time")} value={values.timeOfDay} onChange={set("timeOfDay")}>
            <option value="">Flexible</option>
            <option>Morning</option>
            <option>Afternoon</option>
            <option>Evening</option>
          </select>
        </div>
        <div className="field field--wide">
          <label htmlFor={id("name")}>Your name</label>
          <input id={id("name")} value={values.name} onChange={set("name")} autoComplete="name" maxLength={80} />
        </div>
        <div className="field field--wide">
          <label htmlFor={id("notes")}>Anything else we should know</label>
          <textarea id={id("notes")} rows={3} value={values.notes} onChange={set("notes")} maxLength={500} />
        </div>
      </div>
      <div className="form__actions">
        <button type="submit" className="btn btn--dark">
          Prepare viewing request
        </button>
        <p className="form__fine">
          Location: {site.location.display}. This is a request, not a confirmed appointment — our team will reply on WhatsApp to arrange a time.
        </p>
      </div>
    </form>
  );
}
