import type { CategoryId } from "./taxonomy";

/**
 * The only houses the shop lists (owner decision, Oct 2026).
 *
 * - Bags, shoes and watches: Hermès, Louis Vuitton, Gucci and Chanel only.
 * - Jewellery: the same four, plus Cartier, Van Cleef & Arpels and Bvlgari — for genuine pieces
 *   SEVN HEVN actually holds. This exception does not extend to watches.
 *
 * The same list is enforced in the database (supabase/migrations/*_shop_four_categories.sql), so a
 * piece outside it can't be published from the panel or an import either. Keep the two in step.
 * Listing a brand here is not a claim of stock, partnership or authorisation.
 */
export type BrandId = "hermes" | "louis-vuitton" | "gucci" | "chanel" | "cartier" | "van-cleef-arpels" | "bvlgari";

export interface Brand {
  id: BrandId;
  /** The one spelling shown everywhere. */
  name: string;
  /** Other spellings that mean the same house (accents, case and punctuation are ignored anyway). */
  aliases: string[];
  categories: readonly CategoryId[];
}

const ALL: readonly CategoryId[] = ["bags", "shoes", "watches", "jewellery"];
const JEWELLERY_ONLY: readonly CategoryId[] = ["jewellery"];

export const brands: Brand[] = [
  { id: "hermes", name: "Hermès", aliases: ["Hermes", "Hermes Paris", "Hermès Paris"], categories: ALL },
  { id: "louis-vuitton", name: "Louis Vuitton", aliases: ["LV", "Louis-Vuitton", "Vuitton"], categories: ALL },
  { id: "gucci", name: "Gucci", aliases: [], categories: ALL },
  { id: "chanel", name: "Chanel", aliases: [], categories: ALL },
  { id: "cartier", name: "Cartier", aliases: [], categories: JEWELLERY_ONLY },
  { id: "van-cleef-arpels", name: "Van Cleef & Arpels", aliases: ["Van Cleef and Arpels", "Van Cleef", "VCA"], categories: JEWELLERY_ONLY },
  { id: "bvlgari", name: "Bvlgari", aliases: ["Bulgari"], categories: JEWELLERY_ONLY },
];

export const brandById = Object.fromEntries(brands.map((b) => [b.id, b])) as Record<BrandId, Brand>;

/** "Hermès", "HERMES", "hermes paris" → "hermes paris"-style key: no accents, case, "&"/"and" or punctuation. */
export function brandKey(raw: string) {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const byKey = new Map<string, Brand>();
for (const b of brands) for (const name of [b.name, b.id, ...b.aliases]) byKey.set(brandKey(name), b);

/** The house a typed or imported name refers to, if it is one of ours. */
export function findBrand(raw: string | null | undefined): Brand | undefined {
  return raw ? byKey.get(brandKey(raw)) : undefined;
}

export function isBrandId(value: unknown): value is BrandId {
  return typeof value === "string" && Object.hasOwn(brandById, value);
}

/** Whether a piece of this brand may be listed in this category. */
export function brandAllowedIn(category: CategoryId, raw: string | null | undefined) {
  const b = findBrand(raw);
  return !!b && b.categories.includes(category);
}

/** The houses that may be listed in a category, in display order. */
export function brandsFor(category: CategoryId) {
  return brands.filter((b) => b.categories.includes(category));
}

/** The four houses offered in every category. */
export const coreBrands = brands.filter((b) => b.categories.length === ALL.length);
/** Houses offered for jewellery only. */
export const jewelleryOnlyBrands = brands.filter((b) => b.categories.length === 1);
