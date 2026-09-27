/**
 * Full category taxonomy from the brand PDF.
 * `launch: true` categories are shown as discovery doors. Others stay in the data
 * for later growth and appear in the Collection filters automatically once an item uses them.
 */
export type CategoryId =
  | "bags"
  | "watches"
  | "shoes"
  | "jewellery"
  | "accessories"
  | "clothing"
  | "eyewear"
  | "lifestyle";

export interface Category {
  id: CategoryId;
  label: string;
  /** Subcategories kept for later filters and sourcing requests. */
  sub: string[];
  launch: boolean;
}

export const categories: Category[] = [
  { id: "bags", label: "Bags", sub: ["Handbags", "Crossbody bags", "Clutches", "Wallets", "Travel"], launch: true },
  { id: "watches", label: "Watches", sub: ["Vintage watches", "Contemporary watches"], launch: true },
  { id: "shoes", label: "Shoes", sub: ["Sandals", "Mules", "Loafers", "Sneakers", "Boots", "Pumps"], launch: true },
  { id: "jewellery", label: "Jewellery", sub: ["Bracelets", "Earrings", "Necklaces", "Rings"], launch: false },
  { id: "accessories", label: "Accessories", sub: ["Belts", "Scarves", "Charms"], launch: false },
  { id: "clothing", label: "Clothing", sub: [], launch: false },
  { id: "eyewear", label: "Eyewear", sub: ["Optical", "Sunglasses"], launch: false },
  { id: "lifestyle", label: "Lifestyle", sub: ["Beauty", "Fragrance", "Home accessories"], launch: false },
];

export const categoryById = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<CategoryId, Category>;

export function isCategoryId(value: string | null | undefined): value is CategoryId {
  return !!value && value in categoryById;
}
