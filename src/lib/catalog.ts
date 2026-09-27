import "server-only";
import { cache } from "react";
import { demoInventoryEnabled } from "@/config/site";
import { demoItems } from "@/data/demo";
import { editorialPreviews } from "@/data/editorial";
import { products } from "@/data/products";
import { isCategoryId } from "@/data/taxonomy";
import type { Condition, Item, ItemStatus } from "@/data/types";
import { publicImageUrl, supabaseReadConfig } from "@/lib/supabase";

const REF_PATTERN = /^[A-Za-z0-9-]{2,40}$/;

/**
 * Cache strategy: genuine products come from Supabase and are cached under this tag.
 * - Any change to products/product_images makes Supabase call /api/revalidate, which expires the tag
 *   so the next visit fetches fresh data (see supabase/migrations/*_catalogue_revalidation.sql).
 * - As a fallback the cache also refreshes itself every CATALOG_REFRESH_SECONDS.
 * - Checkout always reads fresh data (never cached) before quoting a price or stock.
 */
export const CATALOG_TAG = "catalog";
const CATALOG_REFRESH_SECONDS = 300;

type ProductRow = {
  ref: string;
  status: ItemStatus;
  name: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  model_reference: string | null;
  description: string | null;
  price_aed: number | null;
  stock: number | null;
  max_per_order: number | null;
  condition: Condition | null;
  condition_notes: string | null;
  year: string | null;
  material: string | null;
  colour: string | null;
  size: string | null;
  dimensions: string | null;
  included: string[] | null;
  authentication: string | null;
  delivery: string | null;
  returns: string | null;
  featured: boolean;
  editorial_note: string | null;
  listed_at: string | null;
  product_images: { storage_path: string; width: number; height: number; alt: string }[];
};

const PRODUCT_COLUMNS = [
  "ref", "status", "name", "category", "subcategory", "brand", "model_reference", "description", "price_aed", "stock",
  "max_per_order", "condition", "condition_notes", "year", "material", "colour", "size", "dimensions", "included",
  "authentication", "delivery", "returns", "featured", "editorial_note", "listed_at",
  "product_images(storage_path,width,height,alt)",
].join(",");

const opt = <T,>(v: T | null) => (v === null ? undefined : v);

function fromRow(url: string, r: ProductRow): Item | null {
  if (!isCategoryId(r.category)) return null;
  return {
    ref: r.ref,
    status: r.status,
    name: r.name,
    category: r.category,
    subcategory: opt(r.subcategory),
    brand: opt(r.brand),
    modelReference: opt(r.model_reference),
    description: opt(r.description),
    images: (r.product_images ?? []).map((i) => ({ src: publicImageUrl(url, i.storage_path), width: i.width, height: i.height, alt: i.alt })),
    priceAED: opt(r.price_aed),
    stock: opt(r.stock),
    maxPerOrder: opt(r.max_per_order),
    condition: opt(r.condition),
    conditionNotes: opt(r.condition_notes),
    year: opt(r.year),
    material: opt(r.material),
    colour: opt(r.colour),
    size: opt(r.size),
    dimensions: opt(r.dimensions),
    included: r.included?.length ? r.included : undefined,
    authentication: opt(r.authentication),
    delivery: opt(r.delivery),
    returns: opt(r.returns),
    featured: r.featured,
    editorialNote: opt(r.editorial_note),
    listedAt: opt(r.listed_at),
  };
}

/**
 * Genuine inventory: Supabase when configured (published rows only — enforced by RLS and by the
 * filter below), otherwise the static file src/data/products.ts for offline development.
 * Errors are thrown rather than returning an empty list, so a failed refresh keeps serving the
 * last good catalogue instead of caching an empty shop.
 */
async function fetchGenuine(fresh: boolean): Promise<Item[]> {
  const cfg = supabaseReadConfig();
  if (!cfg) return products;
  const params = new URLSearchParams({
    select: PRODUCT_COLUMNS,
    published: "is.true",
    order: "listed_at.desc.nullslast,ref.asc",
    "product_images.order": "position.asc,id.asc",
  });
  const res = await fetch(`${cfg.url}/rest/v1/products?${params}`, {
    headers: { apikey: cfg.key, accept: "application/json" },
    signal: AbortSignal.timeout(8000),
    ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: CATALOG_REFRESH_SECONDS, tags: [CATALOG_TAG] } }),
  });
  if (!res.ok) throw new Error(`[catalog] Supabase catalogue request failed with HTTP ${res.status}`);
  const rows = (await res.json()) as ProductRow[];
  return rows.flatMap((r) => fromRow(cfg.url, r) ?? []);
}

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

function build(genuine: Item[]): Item[] {
  const seen = new Set<string>();
  const all = [
    ...genuine.map((p) => normalise(p)),
    ...editorialPreviews.map((p) => normalise({ ...p, status: "editorial_preview" })),
    ...(demoInventoryEnabled ? demoItems.map((p) => normalise(p, true)) : []),
  ];
  return all.filter((item) => {
    const key = item.ref.toUpperCase();
    if (!REF_PATTERN.test(item.ref) || seen.has(key)) {
      console.warn(`[catalog] Skipping item with invalid or duplicate ref: ${item.ref}`);
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** Deduplicated per request; the underlying fetch is shared across requests via the data cache. */
const load = cache(async (fresh: boolean) => build(await fetchGenuine(fresh)));

/** `fresh: true` bypasses the cache — use it wherever price or stock must be current (checkout). */
export function getCatalog({ fresh = false } = {}): Promise<Item[]> {
  return load(fresh);
}

export function findItem(items: Item[], ref: string | null | undefined): Item | undefined {
  if (!ref) return undefined;
  const key = ref.toUpperCase();
  return items.find((i) => i.ref.toUpperCase() === key);
}

export async function getItem(ref: string | null | undefined): Promise<Item | undefined> {
  return ref ? findItem(await getCatalog(), ref) : undefined;
}

/** Genuine, non-demo items — the only ones eligible for Product structured data or checkout. */
export function isGenuine(item: Item) {
  return !item.demo && item.status !== "editorial_preview";
}

export async function getFeatured(limit = 4): Promise<Item[]> {
  const catalog = await getCatalog();
  const genuine = catalog.filter((i) => isGenuine(i) && i.featured && i.status !== "sold");
  if (genuine.length >= 3) return genuine.slice(0, limit);
  return catalog.filter((i) => i.status === "editorial_preview" && i.featured).slice(0, limit);
}

export async function hasGenuineInventory() {
  return (await getCatalog()).some((i) => isGenuine(i));
}
