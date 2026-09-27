import "server-only";
import { demoInventoryEnabled } from "@/config/site";
import { demoItems } from "@/data/demo";
import { editorialPreviews } from "@/data/editorial";
import { products } from "@/data/products";
import type { Item } from "@/data/types";

const REF_PATTERN = /^[A-Za-z0-9-]{2,40}$/;

/**
 * Applies honesty rules so data mistakes can never produce a misleading listing:
 * - an "available" item without a price, stock or delivery details becomes "enquiry_only";
 * - "available" with zero stock becomes "sold";
 * - a price of 0 or less is removed.
 */
function normalise(item: Item, demo = false): Item {
  const next: Item = { ...item, demo: demo || undefined };
  if (next.priceAED !== undefined && !(next.priceAED > 0)) delete next.priceAED;
  if (next.status === "available") {
    if (next.stock !== undefined && next.stock <= 0) next.status = "sold";
    else if (!next.priceAED || !next.stock || !next.delivery) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[catalog] ${item.ref} marked available but missing price/stock/delivery — shown as enquiry_only.`);
      }
      next.status = "enquiry_only";
    }
  }
  return next;
}

function build(): Item[] {
  const seen = new Set<string>();
  const all = [
    ...products.map((p) => normalise(p)),
    ...editorialPreviews.map((p) => normalise({ ...p, status: "editorial_preview" })),
    ...(demoInventoryEnabled ? demoItems.map((p) => normalise(p, true)) : []),
  ];
  return all.filter((item) => {
    if (!REF_PATTERN.test(item.ref) || seen.has(item.ref)) {
      console.warn(`[catalog] Skipping item with invalid or duplicate ref: ${item.ref}`);
      return false;
    }
    seen.add(item.ref);
    return true;
  });
}

const catalog = build();

export function getCatalog(): Item[] {
  return catalog;
}

export function getItem(ref: string | null | undefined): Item | undefined {
  if (!ref) return undefined;
  const key = ref.toUpperCase();
  return catalog.find((i) => i.ref.toUpperCase() === key);
}

/** Genuine, non-demo items — the only ones eligible for Product structured data or checkout. */
export function isGenuine(item: Item) {
  return !item.demo && item.status !== "editorial_preview";
}

export function getFeatured(limit = 4): Item[] {
  const genuine = catalog.filter((i) => isGenuine(i) && i.featured && i.status !== "sold");
  if (genuine.length >= 3) return genuine.slice(0, limit);
  return catalog.filter((i) => i.status === "editorial_preview" && i.featured).slice(0, limit);
}

export function hasGenuineInventory() {
  return catalog.some((i) => isGenuine(i));
}
