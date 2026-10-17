import { brandAllowedIn, brandsFor, findBrand } from "@/data/brands";
import { categories, isCategoryId } from "@/data/taxonomy";
import { categoryPath, productPath } from "@/lib/paths";
import { MAX_PHOTOS } from "../config";
import type { SiteLink, SitePhoto } from "../contracts/run";

/**
 * The pages an article may link to and the photos it may show. Built by code from the shop's own
 * rules and catalogue, so a model can only choose among addresses that exist (category pages,
 * house pages only for houses offered in that category, the concierge chat, the collection and
 * published pieces) and among the shop's own photos of published pieces. Photos from other
 * websites are never used: they belong to their owners.
 */
export function staticLinks(): SiteLink[] {
  return [
    ...categories.map((c) => ({ href: categoryPath(c.id), label: c.label, kind: "category" as const })),
    ...categories.flatMap((c) => brandsFor(c.id).map((b) => ({ href: categoryPath(c.id, b.id), label: `${b.name} ${c.label.toLowerCase()}`, kind: "house" as const }))),
    { href: "/collection", label: "The whole collection", kind: "collection" },
    { href: "/chat", label: "Private concierge (sourcing, viewings, questions)", kind: "concierge" },
  ];
}

type ProductRow = {
  ref: string;
  name: string;
  category: string;
  brand: string | null;
  product_images?: { storage_path: string; width: number; height: number; alt: string; position?: number }[];
};

export interface Site {
  links: SiteLink[];
  photos: SitePhoto[];
  /** Published pieces, e.g. "Hermès Kelly Dépêches 25 (bags)", for the ideator. */
  pieces: string[];
}

const PHOTOS_PER_PIECE = 2;

/** Published pieces and their photos. The public key can't read anything else (row-level security). */
export async function publishedProducts(api: { url: string; key: string } | null): Promise<Site> {
  if (!api) return { links: [], photos: [], pieces: [] };
  const params = new URLSearchParams({
    select: "ref,name,category,brand,product_images(storage_path,width,height,alt,position)",
    published: "is.true",
    order: "listed_at.desc.nullslast",
    limit: "100",
  });
  const res = await fetch(`${api.url}/rest/v1/products?${params}`, {
    headers: { apikey: api.key, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`catalogue read failed with HTTP ${res.status}`);
  const rows = ((await res.json()) as ProductRow[]).filter(
    (r) => isCategoryId(r.category) && brandAllowedIn(r.category, r.brand) && /^[A-Za-z0-9-]{2,40}$/.test(r.ref),
  );
  const photos: SitePhoto[] = [];
  for (const r of rows) {
    const piece = `${findBrand(r.brand)!.name} ${r.name}`.slice(0, 120);
    const images = [...(r.product_images ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).slice(0, PHOTOS_PER_PIECE);
    for (const img of images) {
      if (photos.length >= MAX_PHOTOS * 8) break;
      photos.push({
        id: `P${photos.length + 1}`,
        piece,
        alt: (img.alt || piece).slice(0, 200),
        href: productPath(r.ref),
        src: `${api.url}/storage/v1/object/public/product-images/${img.storage_path.split("/").map(encodeURIComponent).join("/")}`,
        width: img.width,
        height: img.height,
      });
    }
  }
  return {
    links: rows.map((r) => ({ href: productPath(r.ref), label: `${findBrand(r.brand)!.name} ${r.name}`.slice(0, 120), kind: "product" as const })),
    photos,
    pieces: rows.map((r) => `${findBrand(r.brand)!.name} ${r.name} (${r.category})`),
  };
}

export async function loadSite(api: { url: string; key: string } | null): Promise<Site> {
  const p = await publishedProducts(api);
  return { ...p, links: [...p.links, ...staticLinks()] };
}
