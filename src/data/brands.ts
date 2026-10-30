import type { CategoryId } from "./taxonomy";

/**
 * The only houses the shop lists: the houses SEVN HEVN actually holds (owner decision, 28 Oct 2026).
 *
 * - Hermès and Chanel: bags, shoes, watches and jewellery.
 * - Miu Miu and Loro Piana: bags and shoes.
 *
 * Louis Vuitton, Gucci, Cartier, Van Cleef & Arpels and Bvlgari were listed until 28 Oct 2026 and are
 * no longer offered anywhere (menus, filters, sourcing form, chat, panel); add a house back here and
 * in the database when a piece of it is held again.
 *
 * The same list is enforced in the database (supabase/migrations/*_shop_four_categories.sql), so a
 * piece outside it can't be published from the panel or an import either. Keep the two in step.
 * Listing a brand here is not a claim of stock, partnership or authorisation.
 */
export type BrandId = "hermes" | "chanel" | "miu-miu" | "loro-piana";

export interface Brand {
  id: BrandId;
  /** The one spelling shown everywhere. */
  name: string;
  /** Other spellings that mean the same house (accents, case and punctuation are ignored anyway). */
  aliases: string[];
  categories: readonly CategoryId[];
}

const ALL: readonly CategoryId[] = ["bags", "shoes", "watches", "jewellery"];
const BAGS_AND_SHOES: readonly CategoryId[] = ["bags", "shoes"];

/** In display order. */
export const brands: Brand[] = [
  { id: "hermes", name: "Hermès", aliases: ["Hermes", "Hermes Paris", "Hermès Paris"], categories: ALL },
  { id: "chanel", name: "Chanel", aliases: [], categories: ALL },
  { id: "miu-miu", name: "Miu Miu", aliases: ["MiuMiu", "Miu-Miu"], categories: BAGS_AND_SHOES },
  { id: "loro-piana", name: "Loro Piana", aliases: ["LoroPiana", "Loro-Piana"], categories: BAGS_AND_SHOES },
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
