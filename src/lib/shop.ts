import { brandById, brandKey, findBrand, isBrandId, type BrandId } from "@/data/brands";
import { categoryById, isCategoryId, isSubcategoryOf, type CategoryId } from "@/data/taxonomy";
import { isPurchasable, priceRange } from "./format";
import type { ShopItem } from "./paths";

/** Any piece with the fields listings use (a full Item or the browser-side ShopItem). */
type Piece = ShopItem;

/**
 * Listing logic shared by the category pages, the Collection, search and the menu. Pure functions
 * (no React, no server code) so they are unit-tested in tests/shop.test.ts.
 *
 * Filters are offered only from real data: an option exists only if at least one piece has it, and a
 * filter group is shown only when it can actually narrow the list (two or more options).
 */

export type Availability = "available" | "enquiry" | "reserved" | "sold";
export const availabilityOrder: Availability[] = ["available", "enquiry", "reserved", "sold"];

export type SortId = "newest" | "price-asc" | "price-desc";
export const sortIds: SortId[] = ["newest", "price-asc", "price-desc"];

export interface ListingState {
  category?: CategoryId;
  brand?: BrandId;
  type?: string;
  q: string;
  colour: string[];
  availability: Availability[];
  size: string[];
  caseSize: string[];
  metal: string[];
  priceMin?: number;
  priceMax?: number;
  sort: SortId;
}

/** Query-string names. Brand and category are path segments on category pages, query values on /collection. */
export const PARAM = {
  category: "category",
  brand: "brand",
  type: "type",
  q: "q",
  colour: "colour",
  availability: "availability",
  size: "size",
  caseSize: "case",
  metal: "metal",
  priceMin: "price_min",
  priceMax: "price_max",
  sort: "sort",
} as const;

/** Parameters that narrow the list (everything except the search box and sort). */
export const FILTER_PARAMS = [PARAM.type, PARAM.colour, PARAM.availability, PARAM.size, PARAM.caseSize, PARAM.metal, PARAM.priceMin, PARAM.priceMax] as const;

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12) : []);
const amount = (v: string | null) => {
  // Whole dirhams only ("25000", "25,000"); anything else (negative, decimal, text) is ignored.
  if (!v || !/^\s*(aed\s*)?[\d][\d,\s]*$/i.test(v)) return undefined;
  const n = Number(v.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000_000) : undefined;
};

/** Reads the listing state from the address. `fixed` holds the category / brand a page is about. */
export function readListing(params: URLSearchParams, fixed: { category?: CategoryId; brand?: BrandId } = {}): ListingState {
  const category = fixed.category ?? (isCategoryId(params.get(PARAM.category)) ? (params.get(PARAM.category) as CategoryId) : undefined);
  const rawBrand = fixed.brand ?? params.get(PARAM.brand);
  const brand = isBrandId(rawBrand) ? rawBrand : findBrand(rawBrand)?.id;
  const type = category && isSubcategoryOf(category, params.get(PARAM.type)) ? (params.get(PARAM.type) as string) : undefined;
  const sort = params.get(PARAM.sort);
  return {
    category,
    brand,
    type,
    q: (params.get(PARAM.q) ?? "").slice(0, 80),
    colour: list(params.get(PARAM.colour)),
    availability: list(params.get(PARAM.availability)).filter((a): a is Availability => (availabilityOrder as string[]).includes(a)),
    size: list(params.get(PARAM.size)),
    caseSize: list(params.get(PARAM.caseSize)),
    metal: list(params.get(PARAM.metal)),
    priceMin: amount(params.get(PARAM.priceMin)),
    priceMax: amount(params.get(PARAM.priceMax)),
    sort: (sortIds as string[]).includes(sort ?? "") ? (sort as SortId) : "newest",
  };
}

export function availabilityOf(item: Pick<Piece, "status" | "priceAED" | "stock" | "demo" | "draft" | "variants">): Availability {
  if (item.status === "sold") return "sold";
  if (item.status === "reserved") return "reserved";
  return isPurchasable(item) ? "available" : "enquiry";
}

/** Text compared without accents or case, so "hermes kelly" finds "Hermès Kelly". */
export function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Stable key for a free-text value such as a colour ("Noir (black)" → "noir (black)"). */
export const valueKey = (s: string) => fold(s).replace(/\s+/g, " ").trim();

/** Everything a visitor might type to find a piece: brand, model, reference, version codes, colour. */
export function searchHaystack(item: Piece, extra: string[] = []) {
  const b = item.brandId ? brandById[item.brandId] : findBrand(item.brand);
  return fold(
    [
      item.brand,
      ...(b ? [b.name, ...b.aliases] : []),
      item.name,
      item.modelReference,
      item.ref,
      ...(item.variants ?? []).flatMap((v) => [v.sku, v.colour, v.size]),
      item.colour,
      item.material,
      item.hardware,
      item.purity,
      item.searchText,
      ...extra,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function matchesQuery(item: Piece, q: string, extra: string[] = []) {
  const terms = fold(q.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const h = searchHaystack(item, extra);
  // "LV" and "VCA" are short aliases: compare them as whole brand keys too.
  return terms.every((t) => h.includes(t) || (!!item.brand && brandKey(item.brand) === brandKey(t)));
}

/** Colours of a piece and its versions, as written. */
export function coloursOf(item: Piece) {
  return uniq([item.colour, ...(item.variants ?? []).map((v) => v.colour)]);
}

/** Sizes of a piece and its versions, as written ("40.5", "25"). */
export function sizesOf(item: Piece) {
  return uniq([item.size, ...(item.variants ?? []).map((v) => v.size)]);
}

export function caseSizeOf(item: Piece) {
  return item.caseDiameterMm ? `${item.caseDiameterMm}` : undefined;
}

/** Jewellery metal as documented, e.g. "18k yellow gold", "Silver". */
export function metalOf(item: Piece) {
  return item.category === "jewellery" ? ([item.material, item.purity].filter(Boolean).join(" · ") || undefined) : undefined;
}

function uniq(values: (string | undefined)[]) {
  const seen = new Map<string, string>();
  for (const v of values) if (v && v.trim() && !seen.has(valueKey(v))) seen.set(valueKey(v), v.trim());
  return [...seen.values()];
}

/** Pieces of the page's scope: category, brand and type. */
export function inScope<T extends Piece>(items: T[], s: Pick<ListingState, "category" | "brand" | "type">): T[] {
  return items.filter((i) => (!s.category || i.category === s.category) && (!s.brand || i.brandId === s.brand) && (!s.type || i.subcategory === s.type));
}

/** True when the piece passes every filter (search, colour, availability, sizes, price). */
export function passes<T extends Piece>(item: T, s: ListingState, extra?: (i: T) => string[]) {
  if (!matchesQuery(item, s.q, extra?.(item))) return false;
  if (s.colour.length && !coloursOf(item).some((c) => s.colour.includes(valueKey(c)))) return false;
  if (s.availability.length && !s.availability.includes(availabilityOf(item))) return false;
  if (s.size.length && !sizesOf(item).some((z) => s.size.includes(valueKey(z)))) return false;
  if (s.caseSize.length && !s.caseSize.includes(caseSizeOf(item) ?? "")) return false;
  if (s.metal.length && !s.metal.includes(valueKey(metalOf(item) ?? ""))) return false;
  if (s.priceMin !== undefined || s.priceMax !== undefined) {
    // A piece without a listed price can't be compared, so a price filter leaves it out.
    const r = priceRange(item);
    if (!r) return false;
    if (s.priceMin !== undefined && r.max < s.priceMin) return false;
    if (s.priceMax !== undefined && r.min > s.priceMax) return false;
  }
  return true;
}

/** Newest first by default; by price with unpriced pieces always last (never treated as AED 0). */
export function sortItems<T extends Piece>(items: T[], sort: SortId): T[] {
  const newest = (a: T, b: T) => (b.listedAt ?? "").localeCompare(a.listedAt ?? "") || Number(!!b.featured) - Number(!!a.featured) || a.ref.localeCompare(b.ref);
  return [...items].sort((a, b) => {
    if (sort !== "newest") {
      const pa = priceRange(a)?.min;
      const pb = priceRange(b)?.min;
      if (pa === undefined && pb !== undefined) return 1;
      if (pb === undefined && pa !== undefined) return -1;
      if (pa !== undefined && pb !== undefined && pa !== pb) return sort === "price-asc" ? pa - pb : pb - pa;
    }
    return newest(a, b);
  });
}

export interface Option {
  id: string;
  label: string;
  count: number;
}

function count(items: Piece[], values: (i: Piece) => string[]): Option[] {
  const map = new Map<string, Option>();
  for (const i of items) {
    for (const v of values(i)) {
      const id = valueKey(v);
      const o = map.get(id) ?? { id, label: v, count: 0 };
      o.count += 1;
      map.set(id, o);
    }
  }
  return [...map.values()];
}

export interface Facets {
  brands: (Option & { id: BrandId })[];
  types: Option[];
  colour: Option[];
  availability: (Option & { id: Availability })[];
  size: Option[];
  caseSize: Option[];
  metal: Option[];
  /** Pieces with a listed price; the price filter and price sorting need two or more. */
  priced: number;
  priceBounds?: { min: number; max: number };
}

/** Options available in a scope. Counts are over the scope, before the visitor's own filters. */
export function facets(items: Piece[], category?: CategoryId): Facets {
  const brandCounts = count(items, (i) => (i.brandId ? [i.brandId] : []));
  const prices = items.map((i) => priceRange(i)).filter((r): r is { min: number; max: number } => !!r);
  return {
    brands: brandCounts
      .filter((o): o is Option & { id: BrandId } => isBrandId(o.id))
      .map((o) => ({ ...o, label: brandById[o.id].name }))
      .sort((a, b) => Object.keys(brandById).indexOf(a.id) - Object.keys(brandById).indexOf(b.id)),
    types: category
      ? categoryById[category].sub.map((s) => ({ id: s.id, label: s.label, count: items.filter((i) => i.subcategory === s.id).length })).filter((o) => o.count > 0)
      : [],
    colour: count(items, coloursOf).sort((a, b) => a.label.localeCompare(b.label)),
    availability: availabilityOrder
      .map((id) => ({ id, label: id, count: items.filter((i) => availabilityOf(i) === id).length }))
      .filter((o) => o.count > 0),
    size: count(items, sizesOf).sort((a, b) => parseFloat(a.label) - parseFloat(b.label) || a.label.localeCompare(b.label)),
    caseSize: count(items, (i) => (caseSizeOf(i) ? [caseSizeOf(i)!] : [])).sort((a, b) => Number(a.id) - Number(b.id)),
    metal: count(items, (i) => (metalOf(i) ? [metalOf(i)!] : [])),
    priced: prices.length,
    priceBounds: prices.length ? { min: Math.min(...prices.map((p) => p.min)), max: Math.max(...prices.map((p) => p.max)) } : undefined,
  };
}

/** A group is worth showing when it can narrow the list, or when the visitor already chose from it. */
export const offers = (options: Option[], selected: string[] = []) => options.length >= 2 || selected.length > 0;

/** The full listing: scope → filters → sort. */
export function listing<T extends Piece>(items: T[], s: ListingState, extra?: (i: T) => string[]) {
  const scoped = inScope(items, s);
  return { scoped, results: sortItems(scoped.filter((i) => passes(i, s, extra)), s.sort) };
}

/** Writes one change into the query string; empty values are removed. */
export function setParam(params: URLSearchParams, key: string, value: string | string[] | number | undefined) {
  const v = Array.isArray(value) ? value.join(",") : value === undefined ? "" : String(value);
  if (v) params.set(key, v);
  else params.delete(key);
  return params;
}

/** Related pieces: same category, same brand first, then newest; never the piece itself. */
export function related<T extends Piece>(items: T[], item: Piece, limit = 4): T[] {
  return sortItems(items.filter((i) => i.ref !== item.ref && i.category === item.category && i.status !== "sold"), "newest")
    .sort((a, b) => Number(b.brandId === item.brandId) - Number(a.brandId === item.brandId))
    .slice(0, limit);
}
