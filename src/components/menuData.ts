import { brandsFor, type Brand } from "@/data/brands";
import type { CategoryId } from "@/data/taxonomy";
import type { ItemImage } from "@/data/types";
import type { ShopItem } from "@/lib/paths";
import { facets, sortItems, type Facets } from "@/lib/shop";

export interface CategoryMenu {
  count: number;
  /** Houses with at least one listed piece in this category (links to /category/house). */
  brands: Facets["brands"];
  /** Houses allowed in this category, offered as sourcing requests when nothing is listed. */
  allowed: Brand[];
  /** Types with at least one listed piece. */
  types: Facets["types"];
  /** Up to two real pieces to show, newest first, with a photo. */
  picks: { ref: string; brand?: string; name: string; image?: ItemImage }[];
}

export function categoryMenu(items: ShopItem[], category: CategoryId): CategoryMenu {
  const scope = items.filter((i) => i.category === category);
  const f = facets(scope, category);
  const picks = sortItems(
    scope.filter((i) => i.images.length && i.status !== "sold"),
    "newest",
  )
    .slice(0, 2)
    .map((i) => ({ ref: i.ref, brand: i.brand, name: i.name, image: i.images[0] }));
  return { count: scope.length, brands: f.brands, allowed: brandsFor(category), types: f.types, picks };
}
