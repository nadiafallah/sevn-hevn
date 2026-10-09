import type { Locale } from "@/i18n/config";
import type { CategoryId } from "./taxonomy";

/**
 * editorial_preview — visual inspiration only. Never purchasable, never in Product structured data.
 * enquiry_only      — a genuine item that can be enquired about, not bought online.
 * available         — genuine item with confirmed AED price, stock and delivery details.
 * reserved / sold   — genuine item that can no longer be bought.
 */
export type ItemStatus = "editorial_preview" | "enquiry_only" | "available" | "reserved" | "sold";

export type Condition = "new" | "unworn" | "excellent" | "very_good" | "good" | "fair";

export interface ItemImage {
  /** Path under /public, e.g. /images/items/SH-0001-1.jpg */
  src: string;
  width: number;
  height: number;
  /** Describe what is visible: colour, material, angle. */
  alt: string;
}

export interface Item {
  /** Unique, URL-safe reference. Used in /collection?item=REF and every enquiry. */
  ref: string;
  status: ItemStatus;
  name: string;
  category: CategoryId;
  subcategory?: string;
  /** Designer or house. Only for genuine items. */
  brand?: string;
  /** Manufacturer model/reference number, e.g. a watch reference. */
  modelReference?: string;
  description?: string;
  images: ItemImage[];
  /** Whole AED. Omit when unknown — the site shows "Enquire for details", never AED 0. */
  priceAED?: number;
  /** Units in stock. One-off pieces are 1. Required for `available`. */
  stock?: number;
  /** Max per order. Defaults to 1 (one-off pieces). */
  maxPerOrder?: number;
  condition?: Condition;
  conditionNotes?: string;
  year?: string;
  material?: string;
  colour?: string;
  size?: string;
  dimensions?: string;
  /** e.g. ["Original box", "Papers dated 2019", "Dust bag"] */
  included?: string[];
  /** Factual description of documentation held (never claim independent authentication without it). */
  authentication?: string;
  /** Delivery details for this item. Required for `available`. */
  delivery?: string;
  returns?: string;
  /** Show in the Home curated selection. */
  featured?: boolean;
  /** ISO date the item was listed. Used for "newest" sort. */
  listedAt?: string;
  /** Set automatically for demo records. Never set this by hand. */
  demo?: boolean;
  /** Short note shown on editorial previews. */
  editorialNote?: string;
  /** One-line mood caption for editorial previews (from the homepage concept). */
  tagline?: string;
  /**
   * Descriptive text in other languages (Arabic, Russian, French). Brand, model reference, price,
   * stock, year and condition grade are never translated. Missing fields fall back to English.
   */
  translations?: Partial<Record<Exclude<Locale, "en">, ItemText>>;
  /** Set by localizeItem: the English and translated wording, so search works in either. */
  searchText?: string;
}

/** The translatable, descriptive fields of an item. */
export interface ItemText {
  name?: string;
  description?: string;
  tagline?: string;
  editorialNote?: string;
  subcategory?: string;
  colour?: string;
  material?: string;
  conditionNotes?: string;
  size?: string;
  dimensions?: string;
  included?: string[];
  authentication?: string;
  delivery?: string;
  returns?: string;
  /** Image descriptions, in the same order as `images`. */
  imageAlts?: string[];
}
