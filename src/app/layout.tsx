import type { Metadata, Viewport } from "next";
import { Jost } from "next/font/google";
import { indexingEnabled, site } from "@/config/site";
import { getCatalog } from "@/lib/catalog";
import { supabaseWriteConfig } from "@/lib/supabase";
import { SiteProvider, type CartCatalogItem } from "@/components/SiteProvider";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SitePanels } from "@/components/SitePanels";
import { RevealObserver, WhatsAppFloat } from "@/components/Chrome";
import "./globals.css";

const jost = Jost({ subsets: ["latin"], weight: ["300", "400", "500"], display: "swap", variable: "--font-jost" });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "SEVN HEVN | Bags, Watches & Private Sourcing in Dubai",
    template: "%s | SEVN HEVN",
  },
  description: site.description,
  applicationName: site.name,
  alternates: { canonical: "/" },
  robots: indexingEnabled ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: site.name,
    locale: "en_AE",
    url: "/",
    title: "SEVN HEVN — Welcome to your happy place.",
    description: site.description,
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "SEVN HEVN editorial image: an emerald top-handle bag and a black quilted bag on travertine" }],
  },
  twitter: { card: "summary_large_image", title: "SEVN HEVN — Welcome to your happy place.", description: site.description, images: ["/og-image.jpg"] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#F5F0E8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: site.name,
  legalName: site.legalName,
  url: site.url,
  logo: `${site.url}/brand/sevn-hevn-wordmark.svg`,
  email: site.contact.email,
  telephone: site.contact.phoneE164,
  address: { "@type": "PostalAddress", addressLocality: site.location.locality, addressCountry: site.location.country },
  sameAs: [site.social.instagram.url, ...(site.social.facebook.url ? [site.social.facebook.url] : [])],
  contactPoint: [{ "@type": "ContactPoint", telephone: site.contact.phoneE164, email: site.contact.email, contactType: "customer service", availableLanguage: ["English"] }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cartCatalog: CartCatalogItem[] = (await getCatalog())
    .filter((i) => i.status !== "editorial_preview")
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

  return (
    // suppressHydrationWarning: the inline script below adds the "js" class to <html> before React hydrates.
    <html lang="en" className={jost.variable} suppressHydrationWarning>
      <head>
        {/* Marks JS as available so reveal animations never hide content without it. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <SiteProvider catalog={cartCatalog} websiteEnquiries={supabaseWriteConfig() !== null}>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <Header />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <Footer />
          <WhatsAppFloat />
          <SitePanels />
          <RevealObserver />
        </SiteProvider>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
      </body>
    </html>
  );
}
