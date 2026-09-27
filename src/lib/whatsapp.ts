import { site } from "@/config/site";

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

export function itemUrl(ref: string) {
  return `${site.url}/collection?item=${encodeURIComponent(ref)}`;
}

export function generalMessage() {
  return `Hello SEVN HEVN, I would like to make an enquiry.`;
}

export function itemMessage(item: { name: string; ref: string; brand?: string; status: string }) {
  const title = item.brand ? `${item.brand} — ${item.name}` : item.name;
  if (item.status === "editorial_preview") {
    return [
      `Hello SEVN HEVN, I saw this editorial image on your website and would like something similar:`,
      `${title} (ref. ${item.ref})`,
      itemUrl(item.ref),
    ].join("\n");
  }
  return [
    `Hello SEVN HEVN, I am interested in this piece:`,
    `${title}`,
    `Reference: ${item.ref}`,
    itemUrl(item.ref),
  ].join("\n");
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

export function sourcingMessage(r: SourcingRequest) {
  return [
    `Hello SEVN HEVN, I would like to request a piece.`,
    "",
    ...lines([
      ["Category", r.category],
      ["Designer / brand", r.brand],
      ["Model / reference", r.model],
      ["Colour, size or details", r.details],
      ["Approximate budget", r.budget],
      ["Timing", r.timing],
      ["Seen on the website", r.relatedRef ? `${r.relatedRef} — ${itemUrl(r.relatedRef)}` : undefined],
      ["Name", r.name],
      ["Preferred contact", [r.contactMethod, r.contactValue].filter(Boolean).join(" — ")],
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

export function viewingMessage(r: ViewingRequest) {
  return [
    `Hello SEVN HEVN, I would like to arrange a private viewing in Dubai.`,
    "",
    ...lines([
      ["Piece or consultation", r.interest],
      ["Reference", r.relatedRef ? `${r.relatedRef} — ${itemUrl(r.relatedRef)}` : undefined],
      ["Preferred date", r.date],
      ["Preferred time", r.timeOfDay],
      ["Name", r.name],
      ["Notes", r.notes],
    ]),
    "",
    `I understand this is a request and not a confirmed appointment.`,
  ].join("\n");
}

export function cartMessage(items: { name: string; ref: string; qty: number }[], totalLabel?: string) {
  return [
    `Hello SEVN HEVN, I would like to purchase the following:`,
    "",
    ...items.map((i) => `• ${i.name} (ref. ${i.ref})${i.qty > 1 ? ` × ${i.qty}` : ""} — ${itemUrl(i.ref)}`),
    ...(totalLabel ? ["", `Total shown on the website: ${totalLabel}`] : []),
    "",
    `Please confirm availability, delivery and payment options.`,
  ].join("\n");
}
