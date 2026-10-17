import type { Item, Variant } from "@/data/types";

const aed = new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 });

export function formatAED(amount: number) {
  return aed.format(amount);
}

const englishPriceWords = { preview: "Editorial preview", sold: "Sold", enquire: "Price on request", from: "From {price}" };
export type PriceWords = typeof englishPriceWords;

type Priced = Pick<Item, "status" | "priceAED" | "stock" | "demo" | "draft" | "variants">;

const positive = (n: number | undefined) => (n !== undefined && n > 0 ? n : undefined);

/** The variant with this code, if the item has one. */
export function findVariant(item: Pick<Item, "variants">, sku: string | null | undefined): Variant | undefined {
  if (!sku) return undefined;
  const key = sku.toUpperCase();
  return item.variants?.find((v) => v.sku.toUpperCase() === key);
}

/** Price of a version: its own price if set, otherwise the product's. Never 0. */
export function unitPrice(item: Pick<Item, "priceAED">, variant?: Variant) {
  return positive(variant?.priceAED) ?? positive(item.priceAED);
}

/** Stock of a version: its own count if set, otherwise the product's. */
export function unitStock(item: Pick<Item, "stock">, variant?: Variant) {
  return variant?.stock ?? item.stock;
}

/** Lowest and highest known prices across the item (and its versions). Undefined when none is known. */
export function priceRange(item: Pick<Item, "priceAED" | "variants">): { min: number; max: number } | undefined {
  const prices = (item.variants?.length ? item.variants.map((v) => unitPrice(item, v)) : [positive(item.priceAED)]).filter((p): p is number => p !== undefined);
  if (!prices.length) return undefined;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * Never shows AED 0 for an unknown price. The amount is formatted the same way ("AED 12,345") in
 * every language, so a language switch never changes how a price reads.
 */
export function priceLabel(item: Pick<Item, "priceAED" | "status" | "variants">, words: PriceWords = englishPriceWords, variant?: Variant) {
  if (item.status === "editorial_preview") return words.preview;
  if (item.status === "sold") return words.sold;
  if (variant) {
    const p = unitPrice(item, variant);
    return p ? formatAED(p) : words.enquire;
  }
  const range = priceRange(item);
  if (!range) return words.enquire;
  return range.min === range.max ? formatAED(range.min) : words.from.replace("{price}", formatAED(range.min));
}

/**
 * Can be added to the bag. An item with versions is bought as one of them, so it needs a chosen
 * version with a price and stock. Drafts are never purchasable.
 */
export function isPurchasable(item: Priced, variant?: Variant) {
  if (item.status !== "available" || item.draft) return false;
  if (item.variants?.length) {
    if (!variant) return item.variants.some((v) => !!unitPrice(item, v) && (unitStock(item, v) ?? 0) > 0);
    return !!unitPrice(item, variant) && (unitStock(item, variant) ?? 0) > 0;
  }
  return !!positive(item.priceAED) && (item.stock ?? 0) > 0;
}

export function maxQuantity(item: Pick<Item, "stock" | "maxPerOrder">, variant?: Variant) {
  return Math.max(1, Math.min(unitStock(item, variant) ?? 1, item.maxPerOrder ?? 1));
}

/** "17 October 2026", in Dubai time (journal dates). */
export function journalDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso));
}
