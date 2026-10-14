/**
 * The website is English only (since October 2026). Pages keep their unprefixed addresses
 * (/, /collection, /chat) and are served internally from /en/… (src/proxy.ts). The Arabic, Russian
 * and French versions that lived under /ar, /ru and /fr were retired; their addresses redirect
 * permanently to the same page in English. Shared by the server, the browser and the proxy, so this
 * file must stay free of server-only imports.
 */

export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

/** Former language prefixes. Any address under them redirects to the same page in English. */
export const retiredLocales = ["ar", "ru", "fr"] as const;

/** The former language selector remembered a choice in this cookie; the proxy now clears it. */
export const RETIRED_LOCALE_COOKIE = "sevn-hevn-lang";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export const localeInfo = {
  en: {
    /** Open Graph locale. */
    og: "en_AE",
    /** Locale for dates. */
    intl: "en-GB",
  },
} satisfies Record<Locale, { og: string; intl: string }>;

/** Internal link for a page. English keeps the unprefixed address, so the path is returned as is. */
export function localePath(_locale: Locale, path = "/") {
  return path.startsWith("/") ? path : `/${path}`;
}
