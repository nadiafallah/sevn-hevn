import { getCountries } from "libphonenumber-js/max";
import type { Locale } from "./i18n";

/** ISO country names in the chat's languages from the runtime's own data (Intl.DisplayNames). */
const codes = getCountries().filter((c) => /^[A-Z]{2}$/.test(c) && c !== "AC" && c !== "TA" && c !== "XK");

const names: Record<Locale, Intl.DisplayNames> = {
  en: new Intl.DisplayNames(["en"], { type: "region" }),
  ar: new Intl.DisplayNames(["ar"], { type: "region" }),
  ru: new Intl.DisplayNames(["ru"], { type: "region" }),
  fr: new Intl.DisplayNames(["fr"], { type: "region" }),
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
    .replace(/^(the\s+|al[\s-]+|ال|l'\s*|l’\s*|(le|la|les)\s+)/, "")
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
  // Russian
  "оаэ": "AE", "эмираты": "AE", "эмираты оаэ": "AE", "дубай": "AE", "абу даби": "AE", "шарджа": "AE",
  "рф": "RU", "москва": "RU", "санкт петербург": "RU", "сша": "US", "америка": "US", "англия": "GB", "лондон": "GB",
  "саудовская аравия": "SA", "эр рияд": "SA", "катар": "QA", "кувейт": "KW", "бахрейн": "BH", "оман": "OM",
  "казахстан": "KZ", "алматы": "KZ", "астана": "KZ", "узбекистан": "UZ", "ташкент": "UZ", "армения": "AM", "грузия": "GE", "азербайджан": "AZ",
  // French
  eau: "AE", emirats: "AE", "emirats arabes unis": "AE", "abou dabi": "AE",
  "arabie saoudite": "SA", angleterre: "GB", londres: "GB", "grande bretagne": "GB", amerique: "US", "etats unis": "US",
  paris: "FR", geneve: "CH", "monaco": "MC", liban: "LB", beyrouth: "LB", maroc: "MA", casablanca: "MA", algerie: "DZ", tunisie: "TN",
};

/** Russian names change their ending with the case ("в Россию", "во Францию"); compare stems. */
const stem = (s: string) => s.split(" ").map((w) => (/[\u0400-\u04ff]/.test(w) && w.length > 4 ? w.replace(/(ия|ию|ии|ей|ой|ую|ая|ое|ые|а|я|у|ю|е|ы|и|ь)$/, "") : w)).join(" ");

const index = new Map<string, string>();
const stems = new Map<string, string>();
for (const code of codes) {
  for (const l of Object.keys(names) as Locale[]) index.set(norm(countryName(code, l)), code);
  stems.set(stem(norm(countryName(code, "ru"))), code);
  index.set(code.toLowerCase(), code);
}
for (const [alias, code] of Object.entries(ALIASES)) {
  index.set(norm(alias), code);
  if (/[\u0400-\u04ff]/.test(alias)) stems.set(stem(norm(alias)), code);
}
const lookup = (k: string) => index.get(k) ?? stems.get(stem(k));

/** Matches a typed country (any of the chat's languages, common cities and abbreviations included). */
export function matchCountry(text: string): string | undefined {
  const key = norm(text);
  if (!key || key.length > 60) return undefined;
  const whole = lookup(key);
  if (whole) return whole;
  // "to London, UK", "во Францию", "aux États-Unis" → try each word group without the preposition
  for (const part of key.split(/\s*(?:,|\bin\b|\bto\b|الى|إلى|في|(?:^|\s)(?:в|во|на|из)(?=\s)|(?:^|\s)(?:a|au|aux|en|vers|pour)(?=\s))\s*/)) {
    const p = norm(part);
    const hit = p && lookup(p);
    if (hit) return hit;
  }
  for (const word of key.split(" ")) {
    const hit = word.length >= 4 && lookup(word);
    if (hit) return hit;
  }
  return undefined;
}
