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

/** One angle of a photo spin: a light image for turning and a larger one for zooming in. */
export interface SpinFrame {
  src: string;
  zoom: string;
  width: number;
  height: number;
}

/** A colourway that a 3D model carries itself (glTF KHR_materials_variants), with its own photos. */
export interface ModelVariant {
  /** The variant's name inside the model file. */
  name: string;
  /** What the customer sees, e.g. "Blue". */
  label: string;
  /** The same in the other languages. */
  labels?: Partial<Record<Exclude<Locale, "en">, string>>;
  images: ItemImage[];
}

/**
 * Interactive view of a piece. Only real material is used:
 * - "spin": an ordered set of photographs taken around the piece in one horizontal turn
 *   (the viewer turns it left and right only, never up or down);
 * - "model": a 3D model of the piece, which can be turned to any angle.
 */
export type ItemView =
  | { kind: "spin"; frames: SpinFrame[]; start: number; reverse?: boolean }
  | {
      kind: "model";
      src: string;
      /** Shown while the model loads. */
      poster: string;
      /** Camera orbit for the first view, e.g. "35deg 70deg auto". */
      orbit?: string;
      bytes?: number;
      variants?: ModelVariant[];
      /** Name of an animation in the file that opens the piece. Only if the file really has one. */
      openAnimation?: string;
    };

/** Where a demonstration sample came from. Samples exist only in the protected preview. */
export interface ShowcaseSource {
  /** How the view was made: a freely licensed 3D model, photos in a turn, an approximate model, or photos only. */
  type: "free-model" | "photo-spin" | "approx-model" | "gallery";
  author: string;
  source: string;
  sourceUrl: string;
  licence: string;
  licenceUrl: string;
  /** ISO date the source and licence were checked. */
  checked: string;
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
  /** 360° view. Present only when real material exists and the view is switched on. */
  view?: ItemView;
  /** Real photographs of the inside of the piece. Never invented. */
  interior?: ItemImage[];
  /** Demonstration sample (protected preview only): never for sale. */
  showcase?: ShowcaseSource;
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
