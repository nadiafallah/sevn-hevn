import { Cormorant_Garamond, IBM_Plex_Sans_Arabic, Jost, Noto_Naskh_Arabic } from "next/font/google";

/*
 * Brand fonts, self-hosted by next/font (all SIL Open Font License 1.1). Jost and Cormorant cover
 * Latin (English, French) and Cyrillic (Russian); the browser downloads a subset only when a page
 * contains its characters. The two Arabic fonts are not preloaded for the same reason.
 */
export const jost = Jost({ subsets: ["latin", "latin-ext", "cyrillic"], weight: ["300", "400", "500"], display: "swap", variable: "--font-jost" });

// Editorial display serif.
export const cormorant = Cormorant_Garamond({
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif",
});

// Arabic text (body and the concierge chat).
export const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["300", "400", "500"], display: "swap", preload: false, variable: "--font-arabic" });

// Arabic headings: a refined naskh that pairs with the Latin display serif.
export const arabicSerif = Noto_Naskh_Arabic({ subsets: ["arabic"], weight: ["400", "500"], display: "swap", preload: false, variable: "--font-arabic-serif" });

export const fontVariables = `${jost.variable} ${cormorant.variable} ${arabic.variable} ${arabicSerif.variable}`;
