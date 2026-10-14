import type { BrandId } from "@/data/brands";
import type { CategoryId } from "@/data/taxonomy";
import type { Item } from "@/data/types";

/**
 * Shop addresses (before the language prefix; wrap with localePath / href).
 *   /bags                 category
 *   /bags/hermes          category + house
 *   /bags?type=clutches   type, colour, price … are filters in the query string
 *   /product/SH-0001      a piece
 *   /collection?q=kelly   every category (search results)
 * Old addresses (/collection?category=…, /collection?item=…) redirect here permanently (src/proxy.ts).
 */
export const categoryPath = (category: CategoryId, brand?: BrandId) => (brand ? `/${category}/${brand}` : `/${category}`);

export const productPath = (ref: string) => `/product/${encodeURIComponent(ref)}`;

/**
 * The fields the browser needs for cards, the menu, search and the bag. Long descriptive text stays
 * on the server; the product page loads it with the piece itself.
 */
export type ShopItem = Omit<
  Item,
  "description" | "conditionNotes" | "authentication" | "delivery" | "returns" | "included" | "editorialNote" | "tagline" | "draftNote" | "stones" | "dimensions"
>;

const SERVER_ONLY_FIELDS = [
  "description", "conditionNotes", "authentication", "delivery", "returns", "included", "editorialNote", "tagline", "draftNote", "stones", "dimensions",
] as const;

export function toShopItem(item: Item): ShopItem {
  const out: Partial<Item> = { ...item };
  for (const k of SERVER_ONLY_FIELDS) delete out[k];
  return out as ShopItem;
}
