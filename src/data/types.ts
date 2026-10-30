import type { BrandId } from "./brands";
import type { CategoryId } from "./taxonomy";

/**
 * enquiry_only — a genuine piece that can be enquired about, not bought online.
 * available    — genuine piece with confirmed AED price, stock and delivery details.
 * reserved / sold — genuine piece that can no longer be bought.
 * editorial_preview — legacy mood imagery; never part of the shop (filtered out by lib/catalog.ts).
 */
export type ItemStatus = "editorial_preview" | "enquiry_only" | "available" | "reserved" | "sold";

export type Condition = "new" | "unworn" | "excellent" | "very_good" | "good" | "fair";

export type Movement = "automatic" | "manual" | "quartz";
export type Audience = "women" | "men" | "unisex";
export type SizeSystem = "EU" | "IT" | "FR" | "UK" | "US";

export interface ItemImage {
  /** Path under /public or a Supabase Storage URL. */
  src: string;
  width: number;
  height: number;
  /** Describe what is visible: colour, material, angle. */
  alt: string;
}

/**
 * One buyable version of a model (a colour, a size, a hardware finish). Colours and sizes of the same
 * model live on one product as variants, so the shop isn't filled with near-identical cards. Price
 * and stock are read from the variant when it has its own; otherwise from the product.
 */
export interface Variant {
  /** Unique code for this version, quoted in the bag, enquiries and orders. */
  sku: string;
  colour?: string;
  size?: string;
  hardware?: string;
  material?: string;
  priceAED?: number;
  stock?: number;
  /** Index into the product's images: the photo of this version. */
  imageIndex?: number;
}

export interface Item {
  /** Unique, URL-safe reference. Used in /product/REF and every enquiry. */
  ref: string;
  status: ItemStatus;
  name: string;
  category: CategoryId;
  /** Type id from the taxonomy (e.g. "clutches"), resolved from whatever was stored. */
  subcategory?: string;
  /** Designer or house, always one of data/brands.ts once loaded (spelling normalised). */
  brand?: string;
  brandId?: BrandId;
  /** Manufacturer model/reference number, e.g. a watch reference. */
  modelReference?: string;
  description?: string;
  images: ItemImage[];
  /** Whole AED. Omit when unknown — the site shows "Price on request", never AED 0. */
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
  /** Shoes: the sizing system the size is written in. */
  sizeSystem?: SizeSystem;
  dimensions?: string;
  /** Bags and shoes: hardware finish, e.g. "Gold-tone". */
  hardware?: string;
  /** Watches: case diameter in millimetres. */
  caseDiameterMm?: number;
  movement?: Movement;
  /** Jewellery: fineness or carat as documented, e.g. "18k", "925 sterling silver". */
  purity?: string;
  /** Jewellery: confirmed stone details, e.g. "Diamonds, 0.50 ct total". */
  stones?: string;
  audience?: Audience;
  /** e.g. ["Original box", "Papers dated 2019", "Dust bag"] */
  included?: string[];
  /** Country where the piece was made, as documented (Cabinet Resolution 66/2023, Art. 40). */
  countryOfOrigin?: string;
  /** Materials and composition in Arabic (Cabinet Resolution 66/2023, Art. 40(1)(c)). */
  compositionAr?: string;
  /** Factual description of documentation held (never claim independent authentication without it). */
  authentication?: string;
  /** Delivery details for this piece. Required for `available`. */
  delivery?: string;
  returns?: string;
  variants?: Variant[];
  /** Show first in New arrivals on the home page. */
  featured?: boolean;
  /** ISO date the piece was listed. Used for "newest" sort. */
  listedAt?: string;
  /** Set automatically for demo records. Never set this by hand. */
  demo?: boolean;
  /**
   * Private-preview draft (never on production): a documented piece awaiting the owner's approval.
   * Never purchasable, never indexed, never in structured data.
   */
  draft?: boolean;
  /** Owner-facing note on a draft, e.g. what still needs confirming. */
  draftNote?: string;
  /** Legacy fields kept for old editorial records. */
  editorialNote?: string;
  tagline?: string;
}
