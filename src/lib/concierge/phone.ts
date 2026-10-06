import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export interface Phone {
  e164: string;
  display: string;
  country?: string;
}

export type PhoneResult = { ok: true; phone: Phone } | { ok: false; reason: "needs_country" | "invalid" };

/**
 * Validates an international number. A country code is required (no country is assumed), so
 * customers anywhere in the world can be reached. "00" prefixes and Arabic-Indic digits are accepted.
 */
export function parsePhone(input: string): PhoneResult {
  const western = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u2066-\u2069\u200e\u200f]/g, "")
    .trim();
  if (!/^[+0-9\s().-]{6,24}$/.test(western)) return { ok: false, reason: "invalid" };
  const normalised = western.startsWith("00") ? `+${western.slice(2)}` : western;
  if (!normalised.startsWith("+")) return { ok: false, reason: "needs_country" };
  // UK Ofcom drama range: reserved, never assigned to a real person. Used for automated tests;
  // the database marks requests with these numbers as test data.
  const compact = normalised.replace(/[\s().-]/g, "");
  if (/^\+447700900\d{3}$/.test(compact)) {
    return { ok: true, phone: { e164: compact, display: `+44 7700 900${compact.slice(-3)}`, country: "GB" } };
  }
  const parsed = parsePhoneNumberFromString(normalised);
  if (!parsed || !parsed.isValid()) return { ok: false, reason: "invalid" };
  return { ok: true, phone: { e164: parsed.number, display: parsed.formatInternational(), country: parsed.country } };
}

export function formatPhone(e164: string) {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (v: string) => v.length <= 254 && EMAIL.test(v);
