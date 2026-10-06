import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, IBM_Plex_Sans_Arabic, Jost } from "next/font/google";
import { indexingEnabled, site } from "@/config/site";
import "./globals.css";

const jost = Jost({ subsets: ["latin"], weight: ["300", "400", "500"], display: "swap", variable: "--font-jost" });
// Editorial display serif (SIL Open Font License 1.1), self-hosted by next/font.
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500"], style: ["normal", "italic"], display: "swap", variable: "--font-serif" });
// Arabic text in the concierge chat (SIL Open Font License 1.1). Not preloaded: the browser fetches
// it only when Arabic is actually shown.
const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "500"], display: "swap", preload: false, variable: "--font-arabic" });

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below adds the "js" class to <html> before React hydrates.
    <html lang="en" className={`${jost.variable} ${cormorant.variable} ${arabic.variable}`} suppressHydrationWarning>
      <head>
        {/* Marks JS as available so reveal animations never hide content without it. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
