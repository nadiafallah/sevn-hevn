import { Cormorant_Garamond, Jost } from "next/font/google";

/* Brand fonts, self-hosted by next/font (both SIL Open Font License 1.1). The site is English only, so
   the Latin subsets are all it needs (latin-ext covers accented house names such as Hermès). */
export const jost = Jost({ subsets: ["latin", "latin-ext"], weight: ["300", "400", "500"], display: "swap", variable: "--font-jost" });

// Editorial display serif.
export const cormorant = Cormorant_Garamond({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif",
});

export const fontVariables = `${jost.variable} ${cormorant.variable}`;
