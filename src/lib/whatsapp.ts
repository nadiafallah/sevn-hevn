import { site } from "@/config/site";
import { localePath, type Locale } from "@/i18n/config";
import type { UiDictionary } from "@/i18n/dictionaries";
import type { Variant } from "@/data/types";

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

/** Shareable link to a piece (and the chosen version), in the given language: /product/REF?sku=… */
export function itemUrl(ref: string, locale: Locale = "en", sku?: string) {
  return `${site.url}${localePath(locale, `/product/${encodeURIComponent(ref)}${sku ? `?sku=${encodeURIComponent(sku)}` : ""}`)}`;
}

export function generalMessage(m: MessageText) {
  return m.general;
}

/** "Noir · 40.5" — the chosen version's options, as shown on the page. */
export const variantText = (v?: Pick<Variant, "colour" | "size" | "hardware" | "material">) => (v ? [v.colour, v.size, v.hardware, v.material].filter(Boolean).join(" · ") : "");

/**
 * A question about one piece: name, code (and version code), the chosen options, the price shown on
 * the page and the link. Opening WhatsApp sends nothing until the visitor presses Send.
 */
export function itemMessage(
  item: { name: string; ref: string; brand?: string; status: string },
  m: MessageText,
  locale: Locale,
  opts: { variant?: Pick<Variant, "sku" | "colour" | "size" | "hardware" | "material">; details?: string; price?: string } = {},
) {
  const title = item.brand ? `${item.brand} — ${item.name}` : item.name;
  const options = variantText(opts.variant) || opts.details || "";
  const code = opts.variant && opts.variant.sku !== item.ref ? `${item.ref} / ${opts.variant.sku}` : item.ref;
  return [m.itemIntro, title, `${m.labels.reference}: ${code}`, ...(options ? [options] : []), ...(opts.price ? [opts.price] : []), itemUrl(item.ref, locale, opts.variant?.sku)].join("\n");
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

export interface PurchaseLine {
  ref: string;
  sku?: string;
  name: string;
  options?: string;
  qty: number;
  price?: string;
}

/**
 * The bag sent on WhatsApp: each piece with its code, options, quantity, price and link, the website
 * request reference if one was stored, and the delivery choice.
 */
export function purchaseMessage(
  lines: PurchaseLine[],
  w: { intro: string; code: string; total?: string; reference?: string; delivery?: string; confirm: string },
  locale: Locale,
) {
  return [
    w.intro,
    "",
    ...lines.map((l) =>
      [`• ${l.name}${l.qty > 1 ? ` × ${l.qty}` : ""}`, `  ${w.code} ${l.sku && l.sku !== l.ref ? `${l.ref} / ${l.sku}` : l.ref}${l.options ? ` · ${l.options}` : ""}${l.price ? ` · ${l.price}` : ""}`, `  ${itemUrl(l.ref, locale, l.sku)}`].join("\n"),
    ),
    ...(w.total ? ["", w.total] : []),
    ...(w.delivery ? [w.delivery] : []),
    ...(w.reference ? [w.reference] : []),
    "",
    w.confirm,
  ].join("\n");
}
