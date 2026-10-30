/**
 * The shop's four categories, in menu order (owner decision, Oct 2026): Bags | Shoes | Watches |
 * Jewellery. Jewellery replaces Accessories and is for fine jewellery only. Navigation, the menu,
 * search, the sourcing form, the chat and the private panel offer only these. Catalogue rows in any
 * other category are never shown on the website (see lib/catalog.ts).
 *
 * Types (subcategories) are deliberately few. A type is shown in the menu or as a filter only when at
 * least one listed piece belongs to it, so no empty group is ever offered.
 */
export type CategoryId = "bags" | "shoes" | "watches" | "jewellery";

export const categoryIds = ["bags", "shoes", "watches", "jewellery"] as const satisfies readonly CategoryId[];

export interface Subcategory {
  /** Stored in the database and used in the address (?type=clutches). */
  id: string;
  /** English name (panel and fallback). Each language has its own in `ui.types`. */
  label: string;
  /** Other spellings found in older records or imports; matched case-insensitively. */
  aliases?: string[];
}

export interface Category {
  id: CategoryId;
  label: string;
  /** URL path segment, e.g. /bags. */
  path: `/${CategoryId}`;
  sub: Subcategory[];
}

export const categories: Category[] = [
  {
    id: "bags",
    label: "Bags",
    path: "/bags",
    sub: [
      { id: "handbags", label: "Handbags", aliases: ["handbag", "top handle", "top-handle", "tote", "totes"] },
      { id: "shoulder", label: "Shoulder & crossbody", aliases: ["shoulder bags", "shoulder bag", "crossbody", "crossbody bags", "cross-body"] },
      { id: "clutches", label: "Clutches", aliases: ["clutch", "evening bags"] },
      // Canvas and leather cases carried by hand, e.g. Hermès Bride-à-Brac.
      { id: "pouches", label: "Pouches & cases", aliases: ["pouch", "case", "cases", "toiletry case", "toiletry cases"] },
    ],
  },
  {
    id: "shoes",
    label: "Shoes",
    path: "/shoes",
    sub: [
      { id: "sandals", label: "Sandals", aliases: ["sandal", "slides"] },
      { id: "sneakers", label: "Sneakers", aliases: ["sneaker", "trainers"] },
      // Backless loafer-style mules (e.g. Hermès Oz) sit with loafers rather than in a group of their own.
      { id: "loafers", label: "Loafers & mules", aliases: ["loafers", "loafer", "mules", "mule", "moccasins"] },
      { id: "heels", label: "Heels", aliases: ["pumps", "pump", "heeled", "slingbacks"] },
    ],
  },
  {
    id: "watches",
    label: "Watches",
    path: "/watches",
    // Watches are grouped by brand first; women's / men's / unisex appear once enough pieces exist.
    sub: [
      { id: "women", label: "Women’s", aliases: ["womens", "women's", "ladies"] },
      { id: "men", label: "Men’s", aliases: ["mens", "men's", "gents"] },
      { id: "unisex", label: "Unisex" },
    ],
  },
  {
    id: "jewellery",
    label: "Jewellery",
    path: "/jewellery",
    sub: [
      { id: "rings", label: "Rings", aliases: ["ring"] },
      { id: "bracelets", label: "Bracelets", aliases: ["bracelet", "bangles", "bangle", "cuffs"] },
      { id: "necklaces", label: "Necklaces", aliases: ["necklace", "pendants", "pendant", "chains"] },
      { id: "earrings", label: "Earrings", aliases: ["earring", "studs", "hoops"] },
    ],
  },
];

export const categoryById = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<CategoryId, Category>;

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && Object.hasOwn(categoryById, value);
}

const key = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** Resolves a stored or imported type ("Clutch", "clutches", "Mules") to its id, or undefined. */
export function subcategoryId(category: CategoryId, value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const k = key(value);
  return categoryById[category].sub.find((s) => s.id === k || key(s.label) === k || s.aliases?.some((a) => key(a) === k))?.id;
}

export function isSubcategoryOf(category: CategoryId, id: unknown): id is string {
  return typeof id === "string" && categoryById[category].sub.some((s) => s.id === id);
}
