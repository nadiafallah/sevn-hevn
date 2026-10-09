/**
 * Website languages. English is the default and keeps the unprefixed addresses (/, /collection,
 * /chat); the others live under /ar, /ru and /fr. Shared by the server, the browser and the proxy,
 * so this file must stay free of server-only imports.
 */

export const locales = ["en", "ar", "ru", "fr"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

/** Remembers a language the visitor chose in the language selector (never set automatically). */
export const LOCALE_COOKIE = "sevn-hevn-lang";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export interface LocaleInfo {
  /** The language's own name, as shown in the selector. */
  native: string;
  /** Its English name, for the private panel and notifications. */
  english: string;
  dir: "ltr" | "rtl";
  /** Open Graph locale. */
  og: string;
  /** Locale for dates. Arabic keeps Western digits so dates match prices and references. */
  intl: string;
}

export const localeInfo: Record<Locale, LocaleInfo> = {
  en: { native: "English", english: "English", dir: "ltr", og: "en_AE", intl: "en-GB" },
  ar: { native: "العربية", english: "Arabic", dir: "rtl", og: "ar_AE", intl: "ar-AE-u-nu-latn" },
  ru: { native: "Русский", english: "Russian", dir: "ltr", og: "ru_RU", intl: "ru-RU" },
  fr: { native: "Français", english: "French", dir: "ltr", og: "fr_FR", intl: "fr-FR" },
};

export const dirOf = (locale: Locale) => localeInfo[locale].dir;

/** "/collection?item=X" in Arabic → "/ar/collection?item=X". English stays unprefixed. */
export function localePath(locale: Locale, path = "/") {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (locale === defaultLocale) return p;
  if (p === "/") return `/${locale}`;
  if (p.startsWith("/?") || p.startsWith("/#")) return `/${locale}${p.slice(1)}`;
  return `/${locale}${p}`;
}

/** "/ar/collection" → { locale: "ar", path: "/collection" }; unprefixed paths are English. */
export function splitLocale(pathname: string): { locale: Locale; path: string; prefixed: boolean } {
  const m = pathname.match(/^\/([a-z]{2})(?=\/|$)(.*)$/);
  if (m && isLocale(m[1])) return { locale: m[1], path: m[2] || "/", prefixed: true };
  return { locale: defaultLocale, path: pathname || "/", prefixed: false };
}

/** hreflang alternates for a path (with its query), for page metadata and the sitemap. */
export function languageAlternates(path: string) {
  return {
    ...Object.fromEntries(locales.map((l) => [l, localePath(l, path)])),
    "x-default": localePath(defaultLocale, path),
  } as Record<Locale | "x-default", string>;
}
