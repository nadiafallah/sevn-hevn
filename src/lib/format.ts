import type { Item } from "@/data/types";

const aed = new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 });

export function formatAED(amount: number) {
  return aed.format(amount);
}

const englishPriceWords = { preview: "Editorial preview", sold: "Sold", enquire: "Enquire for details" };

/**
 * Never shows AED 0 for an unknown price. The amount is formatted the same way ("AED 12,345") in
 * every language, so a language switch never changes how a price reads.
 */
export function priceLabel(item: Pick<Item, "priceAED" | "status">, words: typeof englishPriceWords = englishPriceWords) {
  if (item.status === "editorial_preview") return words.preview;
  if (item.status === "sold") return words.sold;
  if (item.priceAED && item.priceAED > 0) return formatAED(item.priceAED);
  return words.enquire;
}

export function isPurchasable(item: Pick<Item, "status" | "priceAED" | "stock" | "demo">) {
  return item.status === "available" && !!item.priceAED && (item.stock ?? 0) > 0;
}

export function maxQuantity(item: Pick<Item, "stock" | "maxPerOrder">) {
  return Math.max(1, Math.min(item.stock ?? 1, item.maxPerOrder ?? 1));
}
