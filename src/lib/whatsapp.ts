import { site } from "@/config/site";
import { localePath, type Locale } from "@/i18n/config";
import type { UiDictionary } from "@/i18n/dictionaries";

/**
 * Wording of the messages a visitor sends to SEVN HEVN from their own WhatsApp or e-mail
 * (dictionary `ui.messages`). The site prepares them in the visitor's language; the server uses
 * the English wording for the team's records.
 */
export type MessageText = UiDictionary["messages"];

/** Builds a correctly encoded wa.me link for the company number. */
export function whatsappUrl(message?: string) {
  const base = site.contact.whatsappBase;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export function emailUrl(subject: string, body?: string) {
  const params = new URLSearchParams({ subject });
  if (body) params.set("body", body);
  // URLSearchParams encodes spaces as "+", which mail clients show literally.
  return `${site.contact.emailHref}?${params.toString().replace(/\+/g, "%20")}`;
}

/** Shareable link to an item, in the given language (English: /collection?item=REF). */
export function itemUrl(ref: string, locale: Locale = "en") {
  return `${site.url}${localePath(locale, `/collection?item=${encodeURIComponent(ref)}`)}`;
}

export function generalMessage(m: MessageText) {
  return m.general;
}

export function itemMessage(item: { name: string; ref: string; brand?: string; status: string }, m: MessageText, locale: Locale) {
  const title = item.brand ? `${item.brand} — ${item.name}` : item.name;
  if (item.status === "editorial_preview") {
    return [m.previewIntro, `${title} (${m.refShort} ${item.ref})`, itemUrl(item.ref, locale)].join("\n");
  }
  return [m.itemIntro, `${title}`, `${m.labels.reference}: ${item.ref}`, itemUrl(item.ref, locale)].join("\n");
}

type Field = [label: string, value: string | undefined | null];

function lines(fields: Field[]) {
  return fields.filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v!.trim()}`);
}

export interface SourcingRequest {
  category?: string;
  brand?: string;
  model?: string;
  details?: string;
  budget?: string;
  timing?: string;
  name?: string;
  contactMethod?: string;
  contactValue?: string;
  relatedRef?: string;
}

export function sourcingMessage(r: SourcingRequest, m: MessageText, locale: Locale) {
  const L = m.labels;
  return [
    m.sourcingIntro,
    "",
    ...lines([
      [L.category, r.category],
      [L.brand, r.brand],
      [L.model, r.model],
      [L.details, r.details],
      [L.budget, r.budget],
      [L.timing, r.timing],
      [L.seen, r.relatedRef ? `${r.relatedRef} — ${itemUrl(r.relatedRef, locale)}` : undefined],
      [L.name, r.name],
      [L.contact, [r.contactMethod, r.contactValue].filter(Boolean).join(" — ")],
    ]),
  ].join("\n");
}

export interface ViewingRequest {
  interest?: string;
  date?: string;
  timeOfDay?: string;
  name?: string;
  notes?: string;
  relatedRef?: string;
}

export function viewingMessage(r: ViewingRequest, m: MessageText, locale: Locale) {
  const L = m.labels;
  return [
    m.viewingIntro,
    "",
    ...lines([
      [L.interest, r.interest],
      [L.reference, r.relatedRef ? `${r.relatedRef} — ${itemUrl(r.relatedRef, locale)}` : undefined],
      [L.date, r.date],
      [L.time, r.timeOfDay],
      [L.name, r.name],
      [L.notes, r.notes],
    ]),
    "",
    m.viewingAck,
  ].join("\n");
}

export function cartMessage(items: { name: string; ref: string; qty: number }[], totalLabel: string | undefined, m: MessageText, locale: Locale) {
  return [
    m.cartIntro,
    "",
    ...items.map((i) => `• ${i.name} (${m.refShort} ${i.ref})${i.qty > 1 ? ` × ${i.qty}` : ""} — ${itemUrl(i.ref, locale)}`),
    ...(totalLabel ? ["", m.cartTotal.replace("{total}", totalLabel)] : []),
    "",
    m.cartConfirm,
  ].join("\n");
}
