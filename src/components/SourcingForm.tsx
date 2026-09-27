"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { categories } from "@/data/taxonomy";
import { site } from "@/config/site";
import { sourcingMessage } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import type { SourcingPrefill } from "./SiteProvider";
import { Handoff } from "./Handoff";
import { contactMethods } from "./WebsiteSend";

const budgets = [
  "Under AED 20,000",
  "AED 20,000 – 50,000",
  "AED 50,000 – 100,000",
  "AED 100,000 – 250,000",
  "Above AED 250,000",
  "Prefer to discuss",
];

const categoryLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? id;

type Errors = Partial<Record<"category" | "describe" | "contactValue", string>>;

export function SourcingForm({ prefill, tone = "light" }: { prefill?: SourcingPrefill; tone?: "light" | "dark" }) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [method, setMethod] = useState<(typeof contactMethods)[number]>("WhatsApp");
  const [values, setValues] = useState(() => ({
    category: prefill?.category ?? "",
    brand: prefill?.brand ?? "",
    model: prefill?.model ?? "",
    details: prefill?.details ?? "",
    budget: "",
    timing: "",
    name: "",
    contactValue: "",
  }));

  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  function validate(): Errors {
    const e: Errors = {};
    if (!values.category) e.category = "Choose a category.";
    if (!values.brand.trim() && !values.model.trim() && !values.details.trim())
      e.describe = "Tell us the designer, model or a few details about the piece.";
    const cv = values.contactValue.trim();
    if (cv && method === "Email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cv)) e.contactValue = "Enter a valid email address.";
    if (cv && method !== "Email" && !/^\+?[\d\s()-]{7,20}$/.test(cv)) e.contactValue = "Enter a valid phone number, including country code.";
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
    setMessage(
      sourcingMessage({
        ...values,
        category: categoryLabel(values.category),
        contactMethod: method,
        relatedRef: prefill?.relatedRef,
      }),
    );
    track("sourcing_prepared", { category: values.category });
  }

  if (message) {
    return (
      <Handoff
        message={message}
        emailSubject="Private sourcing request"
        source="sourcing"
        tone={tone}
        send={{
          kind: "sourcing",
          request: { category: categoryLabel(values.category), brand: values.brand, model: values.model, details: values.details, budget: values.budget, timing: values.timing, name: values.name },
          relatedRef: prefill?.relatedRef,
          contactMethod: method,
          contactValue: values.contactValue.trim(),
        }}
        onEdit={() => {
          setMessage(null);
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
        Fields marked <span aria-hidden="true">*</span>
        <span className="visually-hidden">with an asterisk</span> are required. Submitting prepares a WhatsApp message — you send it yourself.
      </p>

      {errorList.length > 0 && (
        <div ref={summaryRef} className="form__summary" role="alert" tabIndex={-1}>
          <p>Please check the following:</p>
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
            Category <span aria-hidden="true">*</span>
          </label>
          <select
            id={id("category")}
            value={values.category}
            onChange={set("category")}
            required
            aria-invalid={!!errors.category}
            aria-describedby={errors.category ? id("category-err") : undefined}
          >
            <option value="">Select</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
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
          <label htmlFor={id("brand")}>Designer or house</label>
          <input
            id={id("brand")}
            list={id("brands")}
            value={values.brand}
            onChange={set("brand")}
            autoComplete="off"
            maxLength={80}
            placeholder="e.g. Hermès, Rolex"
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
          <label htmlFor={id("model")}>Model or reference</label>
          <input
            id={id("model")}
            value={values.model}
            onChange={set("model")}
            maxLength={120}
            placeholder="e.g. Kelly 25, Royal Oak 15500ST"
            aria-invalid={!!errors.describe}
            aria-describedby={errors.describe ? id("describe-err") : undefined}
          />
        </div>

        <div className="field field--wide">
          <label htmlFor={id("details")}>Colour, size, year or other details</label>
          <textarea
            id={id("details")}
            value={values.details}
            onChange={set("details")}
            rows={3}
            maxLength={600}
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
          <label htmlFor={id("budget")}>Approximate budget</label>
          <select id={id("budget")} value={values.budget} onChange={set("budget")}>
            <option value="">Select</option>
            {budgets.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={id("timing")}>Timing</label>
          <select id={id("timing")} value={values.timing} onChange={set("timing")}>
            <option value="">Select</option>
            <option>As soon as possible</option>
            <option>Within 1–3 months</option>
            <option>No fixed timing</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor={id("name")}>Your name</label>
          <input id={id("name")} value={values.name} onChange={set("name")} autoComplete="name" maxLength={80} />
        </div>

        <fieldset className="field field--choice">
          <legend>Preferred contact</legend>
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
            {method === "Email" ? "Email address" : "Phone number"} <span className="field__optional">(optional)</span>
          </label>
          <input
            id={id("contact")}
            type={method === "Email" ? "email" : "tel"}
            autoComplete={method === "Email" ? "email" : "tel"}
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
              Only needed if you’d like us to reply somewhere other than WhatsApp.
            </p>
          )}
        </div>
      </div>

      <div className="form__actions">
        <button type="submit" className={`btn ${tone === "dark" ? "btn--light" : "btn--dark"}`}>
          Prepare WhatsApp message
        </button>
        <p className="form__fine">
          We’ll reply personally. We can’t promise every piece can be found, but we will tell you honestly what is possible.
        </p>
      </div>
    </form>
  );
}
