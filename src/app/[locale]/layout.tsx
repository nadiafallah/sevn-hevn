import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { indexingEnabled, site } from "@/config/site";
import { isLocale, localeInfo, locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { baseOpenGraph } from "@/lib/seo";
import { SiteChrome } from "@/components/SiteChrome";
import { fontVariables } from "../fonts";
import "../globals.css";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// Only the four site languages exist; anything else is a 404.
export const dynamicParams = false;

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale).meta;
  return {
    metadataBase: new URL(site.url),
    title: { default: t.homeTitle, template: "%s | SEVN HEVN" },
    description: t.description,
    applicationName: site.name,
    robots: indexingEnabled ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: baseOpenGraph(locale),
    twitter: { card: "summary_large_image", title: t.ogTitle, description: t.description, images: ["/og-image.jpg"] },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#F5F0E8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    // suppressHydrationWarning: the inline script below adds the "js" class to <html> before React hydrates.
    <html lang={locale} dir={localeInfo[locale].dir} className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Marks JS as available so reveal animations never hide content without it. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <SiteChrome locale={locale}>{children}</SiteChrome>
      </body>
    </html>
  );
}
