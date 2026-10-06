/**
 * The four active categories (owner decision, Oct 2026). Navigation, the menu, the Collection tabs,
 * the sourcing form and the chat offer only these. Catalogue rows in any other category are not
 * shown on the website (see lib/catalog.ts).
 */
export type CategoryId = "bags" | "watches" | "shoes" | "accessories";

export interface Category {
  id: CategoryId;
  label: string;
  /** Subcategories kept for later filters and sourcing requests. */
  sub: string[];
}

export const categories: Category[] = [
  { id: "bags", label: "Bags", sub: ["Handbags", "Crossbody bags", "Clutches", "Wallets", "Travel"] },
  { id: "watches", label: "Watches", sub: ["Vintage watches", "Contemporary watches"] },
  { id: "shoes", label: "Shoes", sub: ["Sandals", "Mules", "Loafers", "Sneakers", "Boots", "Pumps"] },
  { id: "accessories", label: "Accessories", sub: ["Belts", "Scarves", "Charms"] },
];

export const categoryById = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<CategoryId, Category>;

export function isCategoryId(value: string | null | undefined): value is CategoryId {
  return !!value && Object.hasOwn(categoryById, value);
}
