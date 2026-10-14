import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import { demoInventoryEnabled, draftPreviewEnabled } from "@/config/site";
import { brandAllowedIn, findBrand } from "@/data/brands";
import { demoItems } from "@/data/demo";
import { products } from "@/data/products";
import { isCategoryId, subcategoryId } from "@/data/taxonomy";
import type { Audience, Condition, Item, ItemStatus, Movement, SizeSystem, Variant } from "@/data/types";
import { publicImageUrl, supabaseReadConfig } from "@/lib/supabase";

const REF_PATTERN = /^[A-Za-z0-9-]{2,40}$/;

/**
 * Cache strategy: genuine products come from Supabase and are cached under this tag.
 * - Any change to products/product_images/product_variants makes Supabase call /api/revalidate,
 *   which expires the tag so the next visit fetches fresh data.
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
  // Added by the shop migration (20261013120000); absent on a database that hasn't run it yet.
  hardware?: string | null;
  size_system?: SizeSystem | null;
  case_diameter_mm?: number | string | null;
  movement?: Movement | null;
  purity?: string | null;
  stones?: string | null;
  audience?: Audience | null;
  product_variants?: { sku: string; colour: string | null; size: string | null; hardware: string | null; material: string | null; price_aed: number | null; stock: number | null; image_id: number | null }[];
  product_images: { id?: number; storage_path: string; width: number; height: number; alt: string }[];
};

const BASE_COLUMNS = [
  "ref", "status", "name", "category", "subcategory", "brand", "model_reference", "description", "price_aed", "stock",
  "max_per_order", "condition", "condition_notes", "year", "material", "colour", "size", "dimensions", "included",
  "authentication", "delivery", "returns", "featured", "editorial_note", "listed_at",
];
const SHOP_COLUMNS = ["hardware", "size_system", "case_diameter_mm", "movement", "purity", "stones", "audience"];
const SELECT_FULL = [
  ...BASE_COLUMNS, ...SHOP_COLUMNS,
  "product_images(id,storage_path,width,height,alt)",
  "product_variants(sku,colour,size,hardware,material,price_aed,stock,image_id)",
].join(",");
const SELECT_LEGACY = [...BASE_COLUMNS, "product_images(storage_path,width,height,alt)"].join(",");

const opt = <T,>(v: T | null | undefined) => (v === null ? undefined : v);

function fromRow(url: string, r: ProductRow): Item | null {
  if (!isCategoryId(r.category)) return null;
  const images = r.product_images ?? [];
  const variants: Variant[] = (r.product_variants ?? []).map((v) => ({
    sku: v.sku,
    colour: opt(v.colour),
    size: opt(v.size),
    hardware: opt(v.hardware),
    material: opt(v.material),
    priceAED: opt(v.price_aed),
    stock: opt(v.stock),
    imageIndex: v.image_id ? Math.max(0, images.findIndex((i) => i.id === v.image_id)) : undefined,
  }));
  const diameter = r.case_diameter_mm === null || r.case_diameter_mm === undefined ? undefined : Number(r.case_diameter_mm);
  return {
    ref: r.ref,
    status: r.status,
    name: r.name,
    category: r.category,
    subcategory: opt(r.subcategory),
    brand: opt(r.brand),
    modelReference: opt(r.model_reference),
    description: opt(r.description),
    images: images.map((i) => ({ src: publicImageUrl(url, i.storage_path), width: i.width, height: i.height, alt: i.alt })),
    priceAED: opt(r.price_aed),
    stock: opt(r.stock),
    maxPerOrder: opt(r.max_per_order),
    condition: opt(r.condition),
    conditionNotes: opt(r.condition_notes),
    year: opt(r.year),
    material: opt(r.material),
    colour: opt(r.colour),
    size: opt(r.size),
    sizeSystem: opt(r.size_system),
    dimensions: opt(r.dimensions),
    hardware: opt(r.hardware),
    caseDiameterMm: diameter && Number.isFinite(diameter) ? diameter : undefined,
    movement: opt(r.movement),
    purity: opt(r.purity),
    stones: opt(r.stones),
    audience: opt(r.audience),
    included: r.included?.length ? r.included : undefined,
    authentication: opt(r.authentication),
    delivery: opt(r.delivery),
    returns: opt(r.returns),
    variants: variants.length ? variants : undefined,
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
  const request = (select: string) => {
    const params = new URLSearchParams({
      select,
      published: "is.true",
      order: "listed_at.desc.nullslast,ref.asc",
      "product_images.order": "position.asc,id.asc",
      ...(select === SELECT_FULL ? { "product_variants.order": "position.asc,id.asc" } : {}),
    });
    return fetch(`${cfg.url}/rest/v1/products?${params}`, {
      headers: { apikey: cfg.key, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: CATALOG_REFRESH_SECONDS, tags: [CATALOG_TAG] } }),
    });
  };
  let res = await request(SELECT_FULL);
  // Until the shop migration has run, the new columns and the variants table don't exist (HTTP 400):
  // read the original columns so the shop keeps working.
  if (res.status === 400) res = await request(SELECT_LEGACY);
  if (!res.ok) throw new Error(`[catalog] Supabase catalogue request failed with HTTP ${res.status}`);
  const rows = (await res.json()) as ProductRow[];
  return rows.flatMap((r) => fromRow(cfg.url, r) ?? []);
}

/**
 * Private-preview drafts: documented pieces awaiting the owner's approval, generated locally by
 * scripts/drafts/build.mjs into a git-ignored file. Never loaded on production.
 */
async function fetchDrafts(): Promise<Item[]> {
  if (!draftPreviewEnabled) return [];
  try {
    const raw = await readFile(join(process.cwd(), "src/data/drafts.generated.json"), "utf8");
    const items = JSON.parse(raw) as Item[];
    return items.map((i) => ({ ...i, draft: true, status: "enquiry_only" as const }));
  } catch {
    return [];
  }
}

/**
 * Only the four categories and the permitted houses are ever shown (data/brands.ts). The brand's
 * spelling is normalised ("Hermes" → "Hermès") and the type resolved to its id.
 */
/** Composed accents ("ê", not "e" + combining mark), so every typeface draws them in place. */
const TEXT_FIELDS = ["name", "description", "colour", "material", "hardware", "conditionNotes", "size", "dimensions", "stones", "purity"] as const;
function composed(item: Item): Item {
  const out: Item = { ...item };
  for (const k of TEXT_FIELDS) if (typeof out[k] === "string") (out as unknown as Record<string, string>)[k] = (out[k] as string).normalize("NFC");
  return out;
}

function inShop(raw: Item): Item | null {
  const item = composed(raw);
  if (!isCategoryId(item.category) || item.status === "editorial_preview") return null;
  if (!brandAllowedIn(item.category, item.brand)) {
    if (process.env.NODE_ENV !== "production") console.warn(`[catalog] ${item.ref} hidden: brand “${item.brand ?? "—"}” is not listed for ${item.category}.`);
    return null;
  }
  const b = findBrand(item.brand)!;
  return { ...item, brand: b.name, brandId: b.id, subcategory: subcategoryId(item.category, item.subcategory) };
}

/**
 * Applies honesty rules so data mistakes can never produce a misleading listing:
 * - an "available" item without a price, stock or delivery details becomes "enquiry_only";
 * - "available" with zero stock everywhere becomes "sold";
 * - a price of 0 or less is removed.
 */
function normalise(item: Item, demo = false): Item {
  const next: Item = { ...item, demo: demo || undefined };
  if (next.priceAED !== undefined && !(next.priceAED > 0)) delete next.priceAED;
  if (next.variants) next.variants = next.variants.map((v) => (v.priceAED !== undefined && !(v.priceAED > 0) ? { ...v, priceAED: undefined } : v));
  if (next.status === "available") {
    const stocks = next.variants?.length ? next.variants.map((v) => v.stock ?? next.stock ?? 0) : [next.stock ?? 0];
    const hasPrice = next.variants?.length ? next.variants.some((v) => (v.priceAED ?? next.priceAED ?? 0) > 0) : !!next.priceAED;
    if ((next.stock !== undefined || next.variants?.length) && stocks.every((s) => s <= 0)) next.status = "sold";
    else if (!hasPrice || !next.delivery) {
      if (process.env.NODE_ENV !== "production") console.warn(`[catalog] ${item.ref} marked available but missing price/stock/delivery — shown as enquiry_only.`);
      next.status = "enquiry_only";
    }
  }
  return next;
}

function build(genuine: Item[], drafts: Item[]): Item[] {
  const seen = new Set<string>();
  const all = [
    ...genuine.map((p) => normalise(p)),
    ...drafts.map((p) => normalise(p)),
    ...(demoInventoryEnabled ? demoItems.map((p) => normalise(p, true)) : []),
  ];
  return all
    .map(inShop)
    .filter((item): item is Item => {
      if (!item) return false;
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
const load = cache(async (fresh: boolean) => build(await fetchGenuine(fresh), await fetchDrafts()));

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

/** Genuine, published pieces — the only ones eligible for structured data, the sitemap or checkout. */
export function isGenuine(item: Item) {
  return !item.demo && !item.draft && item.status !== "editorial_preview";
}

/** The newest pieces still on offer: featured first, then by listing date. */
export async function getNewArrivals(limit = 8): Promise<Item[]> {
  const live = (await getCatalog()).filter((i) => i.status !== "sold" && !i.demo);
  return [...live]
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || (b.listedAt ?? "").localeCompare(a.listedAt ?? ""))
    .slice(0, limit);
}
