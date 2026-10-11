import type { ReactNode } from "react";
import { site } from "@/config/site";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/lib/catalog";
import { localizeItem } from "@/lib/localize";
import { supabaseWriteConfig } from "@/lib/supabase";
import { conciergeReady } from "@/lib/concierge/config";
import { SiteProvider, type CartCatalogItem } from "./SiteProvider";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { SitePanels } from "./SitePanels";
import { RevealObserver, WhatsAppFloat } from "./Chrome";
import { ConciergeLauncher } from "./concierge/ConciergeLauncher";
import "./concierge/concierge.css";

/** The public website frame: header, footer, panels, WhatsApp button and the concierge chat. */
export async function SiteChrome({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = getDictionary(locale);
  const cartCatalog: CartCatalogItem[] = (await getCatalog())
    .filter((i) => i.status !== "editorial_preview")
    .map((i) => localizeItem(i, locale))
    .map((i) => ({
      ref: i.ref,
      name: i.name,
      brand: i.brand,
      status: i.status,
      priceAED: i.priceAED,
      stock: i.stock,
      maxPerOrder: i.maxPerOrder,
      image: i.images[0],
      demo: i.demo,
    }));

  const chatReady = await conciergeReady();

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    legalName: site.legalName,
    url: site.url,
    description: t.meta.description,
    logo: `${site.url}/brand/sevn-hevn-wordmark.svg`,
    email: site.contact.email,
    telephone: site.contact.phoneE164,
    address: { "@type": "PostalAddress", addressLocality: site.location.locality, addressCountry: site.location.country },
    sameAs: [site.social.instagram.url, ...(site.social.facebook.url ? [site.social.facebook.url] : [])],
    contactPoint: [{ "@type": "ContactPoint", telephone: site.contact.phoneE164, email: site.contact.email, contactType: "customer service", availableLanguage: ["English", "Arabic"] }],
  };

  return (
    <I18nProvider locale={locale} ui={t.ui}>
      <SiteProvider catalog={cartCatalog} websiteEnquiries={supabaseWriteConfig() !== null}>
        <a href="#main" className="skip-link">
          {t.ui.skip}
        </a>
        <Header />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <Footer chat={chatReady} />
        <WhatsAppFloat />
        {chatReady && <ConciergeLauncher />}
        <SitePanels />
        <RevealObserver />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd).replace(/</g, "\\u003c") }} />
      </SiteProvider>
    </I18nProvider>
  );
}
