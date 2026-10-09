"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { viewingMessage } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { useI18n } from "@/i18n/I18nProvider";
import { CARRY_EVENT, takeCarriedForm, type Carry } from "@/i18n/carry";
import { formatDay } from "@/i18n/format";
import type { ViewingPrefill } from "./SiteProvider";
import { Handoff } from "./Handoff";

const timeIds = ["morning", "afternoon", "evening"] as const;

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

type Values = { interest: string; date: string; timeOfDay: string; name: string; notes: string };
type Carried = { values: Values; prepared: boolean };

export function ViewingForm({ prefill, carryKey }: { prefill?: ViewingPrefill; carryKey?: string }) {
  const { t, locale, intl, fmt } = useI18n();
  const f = t.forms;
  const v = f.viewing;
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const formRef = useRef<HTMLFormElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const [prepared, setPrepared] = useState(false);
  const [error, setError] = useState<{ interest?: string; date?: string }>({});
  const [minDate] = useState(todayISO);
  const [values, setValues] = useState<Values>({
    interest: prefill?.interest ?? "",
    date: "",
    timeOfDay: "",
    name: "",
    notes: "",
  });
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setValues((x) => ({ ...x, [k]: e.target.value }));

  // Language change: hand the typed fields over to the page in the new language, and take them back.
  const latest = useRef<Carried>({ values, prepared });
  useEffect(() => {
    latest.current = { values, prepared };
  }, [values, prepared]);
  useEffect(() => {
    if (!carryKey) return;
    const back = takeCarriedForm<Carried>(carryKey);
    if (back?.values) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValues((x) => ({ ...x, ...back.values }));
      setPrepared(!!back.prepared);
    }
    const give = (e: Event) => {
      (e as CustomEvent<Carry>).detail.forms[carryKey] = latest.current;
    };
    window.addEventListener(CARRY_EVENT, give);
    return () => window.removeEventListener(CARRY_EVENT, give);
  }, [carryKey]);

  const timeLabel = (x: string) => v.times[x as (typeof timeIds)[number]] ?? x;

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const e: typeof error = {};
    if (!values.interest.trim()) e.interest = f.errors.interest;
    if (values.date && values.date < minDate) e.date = f.errors.date;
    setError(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => errRef.current?.focus());
      return;
    }
    setPrepared(true);
    track("viewing_prepared");
  }

  if (prepared) {
    const message = viewingMessage(
      { ...values, date: formatDay(values.date, intl), timeOfDay: timeLabel(values.timeOfDay), relatedRef: prefill?.relatedRef },
      t.messages,
      locale,
    );
    return (
      <Handoff
        message={message}
        emailSubject={t.handoff.viewingSubject}
        source="viewing"
        send={{
          kind: "viewing",
          // ISO date and ids: the team's record is written in English on the server.
          request: { interest: values.interest, date: values.date, timeOfDay: values.timeOfDay, name: values.name, notes: values.notes },
          relatedRef: prefill?.relatedRef,
        }}
        onEdit={() => {
          setPrepared(false);
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
            {v.interest} <span aria-hidden="true">*</span>
          </label>
          <input
            id={id("interest")}
            value={values.interest}
            onChange={set("interest")}
            maxLength={160}
            required
            dir="auto"
            placeholder={v.interestPlaceholder}
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
          <label htmlFor={id("date")}>{v.date}</label>
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
          <label htmlFor={id("time")}>{v.time}</label>
          <select id={id("time")} value={values.timeOfDay} onChange={set("timeOfDay")}>
            <option value="">{v.flexible}</option>
            {timeIds.map((x) => (
              <option key={x} value={x}>
                {v.times[x]}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--wide">
          <label htmlFor={id("name")}>{f.name}</label>
          <input id={id("name")} value={values.name} onChange={set("name")} autoComplete="name" maxLength={80} dir="auto" />
        </div>
        <div className="field field--wide">
          <label htmlFor={id("notes")}>{v.notes}</label>
          <textarea id={id("notes")} rows={3} value={values.notes} onChange={set("notes")} maxLength={500} dir="auto" />
        </div>
      </div>
      <div className="form__actions">
        <button type="submit" className="btn btn--dark">
          {v.prepare}
        </button>
        <p className="form__fine">{fmt(v.fine, { location: t.location })}</p>
      </div>
    </form>
  );
}
