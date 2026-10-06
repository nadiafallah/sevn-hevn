import { getCountries } from "libphonenumber-js/max";
import type { Locale } from "./i18n";

/** ISO country names in English and Arabic from the runtime's own data (Intl.DisplayNames). */
const codes = getCountries().filter((c) => /^[A-Z]{2}$/.test(c) && c !== "AC" && c !== "TA" && c !== "XK");

const names = {
  en: new Intl.DisplayNames(["en"], { type: "region" }),
  ar: new Intl.DisplayNames(["ar"], { type: "region" }),
};

export function countryName(code: string, locale: Locale) {
  try {
    return names[locale].of(code) ?? code;
  } catch {
    return code;
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u064b-\u065f]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/^(the\s+|al[\s-]+|ال)/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const ALIASES: Record<string, string> = {
  uae: "AE", "u a e": "AE", emirates: "AE", "united arab emirates": "AE", dubai: "AE", "abu dhabi": "AE", sharjah: "AE",
  "امارات": "AE", "الامارات": "AE", "دبي": "AE", "ابوظبي": "AE", "ابو ظبي": "AE", "الشارقه": "AE",
  ksa: "SA", saudi: "SA", "saudi arabia": "SA", riyadh: "SA", jeddah: "SA", "السعوديه": "SA", "سعوديه": "SA", "الرياض": "SA", "جده": "SA",
  uk: "GB", "u k": "GB", england: "GB", britain: "GB", "great britain": "GB", london: "GB", "بريطانيا": "GB", "انجلترا": "GB", "لندن": "GB",
  usa: "US", "u s a": "US", us: "US", america: "US", "united states": "US", "امريكا": "US", "الولايات المتحده": "US",
  qatar: "QA", doha: "QA", "قطر": "QA", "الدوحه": "QA", kuwait: "KW", "الكويت": "KW", "كويت": "KW",
  bahrain: "BH", "البحرين": "BH", "بحرين": "BH", oman: "OM", muscat: "OM", "عمان": "OM", "مسقط": "OM",
  lebanon: "LB", "لبنان": "LB", egypt: "EG", "مصر": "EG", jordan: "JO", "الاردن": "JO", iran: "IR", "ايران": "IR",
  russia: "RU", "روسيا": "RU", india: "IN", "الهند": "IN", "hong kong": "HK", turkey: "TR", "تركيا": "TR",
};

const index = new Map<string, string>();
for (const code of codes) {
  index.set(norm(countryName(code, "en")), code);
  index.set(norm(countryName(code, "ar")), code);
  index.set(code.toLowerCase(), code);
}
for (const [alias, code] of Object.entries(ALIASES)) index.set(norm(alias), code);

/** Matches a typed country (English or Arabic, common cities and abbreviations included). */
export function matchCountry(text: string): string | undefined {
  const key = norm(text);
  if (!key || key.length > 60) return undefined;
  if (index.has(key)) return index.get(key);
  // "to London, UK" → try each word group
  for (const part of key.split(/\s*(?:,|\bin\b|\bto\b|الى|إلى|في)\s*/)) {
    if (index.has(part.trim())) return index.get(part.trim());
  }
  for (const word of key.split(" ")) if (word.length >= 4 && index.has(word)) return index.get(word);
  return undefined;
}
