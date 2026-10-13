import type { ReactNode } from "react";
import { site } from "@/config/site";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/lib/catalog";
import { localizeItem } from "@/lib/localize";
import { supabaseWriteConfig } from "@/lib/supabase";
import { conciergeReady } from "@/lib/concierge/config";
import { toShopItem } from "@/lib/paths";
import { SiteProvider } from "./SiteProvider";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { SitePanels } from "./SitePanels";
import { RevealObserver, WhatsAppFloat } from "./Chrome";
import { ConciergeLauncher } from "./concierge/ConciergeLauncher";
import "./concierge/concierge.css";

/** The public website frame: header, footer, panels, WhatsApp button and the concierge chat. */
export async function SiteChrome({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = getDictionary(locale);
  // Every listed piece, without its long text: the menu, search, cards and the bag use these.
  const items = (await getCatalog()).map((i) => toShopItem(localizeItem(i, locale)));

  const chatReady = await conciergeReady();

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    alternateName: site.alternateNames,
    legalName: site.legalName,
    url: site.url,
    description: t.meta.description,
    logo: `${site.url}/brand/sevn-hevn-wordmark.svg`,
    email: site.contact.email,
    telephone: site.contact.phoneE164,
    address: { "@type": "PostalAddress", addressLocality: site.location.locality, addressCountry: site.location.country },
    sameAs: [site.social.instagram.url, ...(site.social.facebook.url ? [site.social.facebook.url] : [])],
    contactPoint: [{ "@type": "ContactPoint", telephone: site.contact.phoneE164, email: site.contact.email, contactType: "customer service", availableLanguage: ["English", "Arabic", "Russian", "French"] }],
  };

  return (
    <I18nProvider locale={locale} ui={t.ui}>
      <SiteProvider items={items} websiteEnquiries={supabaseWriteConfig() !== null}>
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
