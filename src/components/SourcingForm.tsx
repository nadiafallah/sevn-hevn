"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { categories, isCategoryId } from "@/data/taxonomy";
import { site } from "@/config/site";
import { useI18n } from "@/i18n/I18nProvider";
import { CARRY_EVENT, takeCarriedForm, type Carry } from "@/i18n/carry";
import { sourcingMessage } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import type { SourcingPrefill } from "./SiteProvider";
import { Handoff } from "./Handoff";
import { contactMethods, methodKey, type ContactMethod } from "./WebsiteSend";

const budgetIds = ["under-20k", "20k-50k", "50k-100k", "100k-250k", "250k-plus", "discuss"] as const;
const timingIds = ["asap", "months", "none"] as const;

type Errors = Partial<Record<"category" | "describe" | "contactValue", string>>;
type Values = { category: string; brand: string; model: string; details: string; budget: string; timing: string; name: string; contactValue: string };
type Carried = { values: Values; method: ContactMethod; prepared: boolean };

export function SourcingForm({ prefill, tone = "light", carryKey }: { prefill?: SourcingPrefill; tone?: "light" | "dark"; carryKey?: string }) {
  const { t, locale } = useI18n();
  const f = t.forms;
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [prepared, setPrepared] = useState(false);
  const [method, setMethod] = useState<ContactMethod>("WhatsApp");
  const [values, setValues] = useState<Values>(() => ({
    category: isCategoryId(prefill?.category) ? prefill.category : "",
    brand: prefill?.brand ?? "",
    model: prefill?.model ?? "",
    details: prefill?.details ?? "",
    budget: "",
    timing: "",
    name: "",
    contactValue: "",
  }));

  // Language change: hand the typed fields over to the page in the new language, and take them back.
  const latest = useRef<Carried>({ values, method, prepared });
  useEffect(() => {
    latest.current = { values, method, prepared };
  }, [values, method, prepared]);
  useEffect(() => {
    if (!carryKey) return;
    const back = takeCarriedForm<Carried>(carryKey);
    if (back?.values) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValues((v) => ({ ...v, ...back.values }));
      if (contactMethods.includes(back.method)) setMethod(back.method);
      setPrepared(!!back.prepared);
    }
    const give = (e: Event) => {
      (e as CustomEvent<Carry>).detail.forms[carryKey] = latest.current;
    };
    window.addEventListener(CARRY_EVENT, give);
    return () => window.removeEventListener(CARRY_EVENT, give);
  }, [carryKey]);

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const label = {
    category: (id: string) => (isCategoryId(id) ? t.categories[id] : id),
    budget: (id: string) => f.budgets[id as (typeof budgetIds)[number]] ?? id,
    timing: (id: string) => f.timings[id as (typeof timingIds)[number]] ?? id,
  };

  function validate(): Errors {
    const e: Errors = {};
    if (!values.category) e.category = f.errors.category;
    if (!values.brand.trim() && !values.model.trim() && !values.details.trim()) e.describe = f.errors.describe;
    const cv = values.contactValue.trim();
    if (cv && method === "Email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cv)) e.contactValue = f.errors.email;
    if (cv && method !== "Email" && !/^\+?[\d\s()-]{7,20}$/.test(cv)) e.contactValue = f.errors.phone;
    return e;
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setPrepared(true);
    track("sourcing_prepared", { category: values.category });
  }

  if (prepared) {
    const message = sourcingMessage(
      {
        ...values,
        category: label.category(values.category),
        budget: label.budget(values.budget),
        timing: label.timing(values.timing),
        contactMethod: f.methods[methodKey[method]],
        relatedRef: prefill?.relatedRef,
      },
      t.messages,
      locale,
    );
    return (
      <Handoff
        message={message}
        emailSubject={t.handoff.sourcingSubject}
        source="sourcing"
        tone={tone}
        send={{
          kind: "sourcing",
          // Ids, not labels: the team's record is written in English on the server.
          request: { category: values.category, brand: values.brand, model: values.model, details: values.details, budget: values.budget, timing: values.timing, name: values.name },
          relatedRef: prefill?.relatedRef,
          contactMethod: method,
          contactValue: values.contactValue.trim(),
        }}
        onEdit={() => {
          setPrepared(false);
          requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("select, input")?.focus());
        }}
      />
    );
  }

  const id = (k: string) => `${uid}-${k}`;
  const errorList = Object.values(errors).filter(Boolean);

  return (
    <form ref={formRef} className={`form form--${tone}`} onSubmit={onSubmit} noValidate aria-describedby={id("help")}>
      <p id={id("help")} className="form__help">
        {f.requiredBefore} <span aria-hidden="true">*</span>
        <span className="visually-hidden">{f.requiredSr}</span>
        {f.requiredAfter}
      </p>

      {errorList.length > 0 && (
        <div ref={summaryRef} className="form__summary" role="alert" tabIndex={-1}>
          <p>{f.checkFollowing}</p>
          <ul>
            {errorList.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="form__grid">
        <div className="field">
          <label htmlFor={id("category")}>
            {f.category} <span aria-hidden="true">*</span>
          </label>
          <select
            id={id("category")}
            value={values.category}
            onChange={set("category")}
            required
            aria-invalid={!!errors.category}
            aria-describedby={errors.category ? id("category-err") : undefined}
          >
            <option value="">{f.select}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {t.categories[c.id]}
              </option>
            ))}
          </select>
          {errors.category && (
            <p className="field__error" id={id("category-err")}>
              {errors.category}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={id("brand")}>{f.designer}</label>
          <input
            id={id("brand")}
            list={id("brands")}
            value={values.brand}
            onChange={set("brand")}
            autoComplete="off"
            maxLength={80}
            dir="auto"
            placeholder={f.designerPlaceholder}
            aria-invalid={!!errors.describe}
            aria-describedby={errors.describe ? id("describe-err") : undefined}
          />
          <datalist id={id("brands")}>
            {site.sourcingBrands.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>

        <div className="field field--wide">
          <label htmlFor={id("model")}>{f.model}</label>
          <input
            id={id("model")}
            value={values.model}
            onChange={set("model")}
            maxLength={120}
            dir="auto"
            placeholder={f.modelPlaceholder}
            aria-invalid={!!errors.describe}
            aria-describedby={errors.describe ? id("describe-err") : undefined}
          />
        </div>

        <div className="field field--wide">
          <label htmlFor={id("details")}>{f.details}</label>
          <textarea
            id={id("details")}
            value={values.details}
            onChange={set("details")}
            rows={3}
            maxLength={600}
            dir="auto"
            aria-invalid={!!errors.describe}
            aria-describedby={errors.describe ? id("describe-err") : undefined}
          />
          {errors.describe && (
            <p className="field__error" id={id("describe-err")}>
              {errors.describe}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={id("budget")}>{f.budget}</label>
          <select id={id("budget")} value={values.budget} onChange={set("budget")}>
            <option value="">{f.select}</option>
            {budgetIds.map((b) => (
              <option key={b} value={b}>
                {f.budgets[b]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={id("timing")}>{f.timing}</label>
          <select id={id("timing")} value={values.timing} onChange={set("timing")}>
            <option value="">{f.select}</option>
            {timingIds.map((x) => (
              <option key={x} value={x}>
                {f.timings[x]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={id("name")}>{f.name}</label>
          <input id={id("name")} value={values.name} onChange={set("name")} autoComplete="name" maxLength={80} dir="auto" />
        </div>

        <fieldset className="field field--choice">
          <legend>{f.preferredContact}</legend>
          <div className="choice-row">
            {contactMethods.map((m) => (
              <label key={m} className="choice">
                <input type="radio" name={id("method")} value={m} checked={method === m} onChange={() => setMethod(m)} />
                <span>{f.methods[methodKey[m]]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field field--wide">
          <label htmlFor={id("contact")}>
            {method === "Email" ? f.emailAddress : f.phoneNumber} <span className="field__optional">{f.optional}</span>
          </label>
          <input
            id={id("contact")}
            type={method === "Email" ? "email" : "tel"}
            autoComplete={method === "Email" ? "email" : "tel"}
            dir="ltr"
            value={values.contactValue}
            onChange={set("contactValue")}
            maxLength={120}
            aria-invalid={!!errors.contactValue}
            aria-describedby={errors.contactValue ? id("contact-err") : id("contact-hint")}
          />
          {errors.contactValue ? (
            <p className="field__error" id={id("contact-err")}>
              {errors.contactValue}
            </p>
          ) : (
            <p className="field__hint" id={id("contact-hint")}>
              {f.contactHint}
            </p>
          )}
        </div>
      </div>

      <div className="form__actions">
        <button type="submit" className={`btn ${tone === "dark" ? "btn--light" : "btn--dark"}`}>
          {f.prepare}
        </button>
        <p className="form__fine">{f.fine}</p>
      </div>
    </form>
  );
}
