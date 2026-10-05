/**
 * Central brand, contact and social settings.
 * Change contact details here only — every link on the site reads from this file.
 */

const DEFAULT_SITE_URL = "https://www.sevnhevn.ae";

function resolveSiteUrl() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  // Production: the public production hostname (custom domain once connected), never the
  // per-deployment URL, which sits behind Vercel Authentication.
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return DEFAULT_SITE_URL;
}

export const site = {
  name: "SEVN HEVN",
  /** Company name exactly as written in the supplied document. */
  legalName: "SEVN HEVN MAISON GENERAL TRADING L.L.C.",
  tagline: "Welcome to your happy place.",
  supportingLine: "Exceptional pieces. Personally sourced in Dubai.",
  description:
    "SEVN HEVN is a Dubai maison for exceptional luxury pieces — bags, watches including vintage, shoes and jewellery — with private sourcing and private viewings by request.",
  url: resolveSiteUrl(),
  canonicalHost: "www.sevnhevn.ae",
  location: {
    display: "Dubai, UAE",
    locality: "Dubai",
    country: "AE",
    /** Leave null until a confirmed address is supplied. Never invent one. */
    streetAddress: null as string | null,
    /** Leave null until confirmed opening hours are supplied. */
    openingHours: null as string | null,
  },
  contact: {
    phoneE164: "+971528877200",
    phoneDisplay: "+971 52 887 7200",
    telHref: "tel:+971528877200",
    whatsappNumber: "971528877200",
    whatsappBase: "https://wa.me/971528877200",
    email: "info@sevnhevn.ae",
    emailHref: "mailto:info@sevnhevn.ae",
  },
  social: {
    instagram: {
      url: "https://www.instagram.com/sevnhevn.maison/",
      handle: "@sevnhevn.maison",
    },
    /** Hidden everywhere until a real URL is supplied. */
    facebook: {
      url: (process.env.NEXT_PUBLIC_FACEBOOK_URL?.trim() || null) as string | null,
    },
  },
  /** Final trade licence details. Leave null until the final licence is issued. */
  licence: null as null | { authority: string; number: string },
  resellerStatement:
    "SEVN HEVN is an independent business. We are not affiliated with, authorised by or endorsed by any of the brands mentioned on this website. Brand names are used only to describe items and sourcing requests.",
  /** Houses clients can name in a sourcing request (not a claim of stock or partnership). */
  sourcingBrands: ["Audemars Piguet", "Rolex", "Hermès", "Bvlgari", "Gucci", "Louis Vuitton"],
} as const;

/** Indexing is off unless explicitly enabled for the public launch. */
export const indexingEnabled =
  process.env.SITE_INDEXING === "true" &&
  (process.env.VERCEL_ENV === undefined || process.env.VERCEL_ENV === "production");

/** Demo records exist only to test cart behaviour locally. Never on production. */
export const demoInventoryEnabled =
  process.env.DEMO_INVENTORY === "true" && process.env.VERCEL_ENV !== "production";
