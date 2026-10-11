import type { Metadata } from "next";
import { site } from "@/config/site";
import { localeInfo, locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

/**
 * Open Graph fields every page shares. Next.js replaces a parent's `openGraph` object as a whole
 * when a page sets its own, so pages spread this first and override only what differs (url, title)
 * — otherwise the shared image, site name and locale silently disappear from link previews.
 */
export function baseOpenGraph(locale: Locale): NonNullable<Metadata["openGraph"]> {
  const t = getDictionary(locale).meta;
  return {
    type: "website",
    siteName: site.name,
    locale: localeInfo[locale].og,
    alternateLocale: locales.filter((l) => l !== locale).map((l) => localeInfo[l].og),
    title: t.ogTitle,
    description: t.description,
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: t.ogImageAlt }],
  };
}
