import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { categories } from "@/data/taxonomy";
import { getCatalog, isGenuine } from "@/lib/catalog";
import { categoryPath, productPath } from "@/lib/paths";

/**
 * Every page of the (English-only) site. Category and house pages are listed only once they hold a
 * genuine piece (an empty listing is noindex), and every genuine piece has its own page. Drafts and
 * demo records are never included. The retired /ar, /ru and /fr addresses redirect and are not listed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const genuine = (await getCatalog()).filter(isGenuine);
  const withPieces = (category: string, brand?: string) => genuine.some((i) => i.category === category && (!brand || i.brandId === brand));
  const houses = Array.from(new Set(genuine.map((i) => `${i.category}|${i.brandId}`))).map((k) => k.split("|"));
  const pages: { path: string; changeFrequency: "daily" | "weekly"; priority: number }[] = [
    { path: "/", changeFrequency: "weekly", priority: 1 },
    { path: "/collection", changeFrequency: "daily", priority: 0.8 },
    ...categories.filter((c) => withPieces(c.id)).map((c) => ({ path: categoryPath(c.id), changeFrequency: "daily" as const, priority: 0.8 })),
    ...houses.map(([category, brand]) => ({ path: `/${category}/${brand}`, changeFrequency: "daily" as const, priority: 0.7 })),
    ...genuine.map((i) => ({ path: productPath(i.ref), changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
  return pages.map((p) => ({ url: `${site.url}${p.path}`, changeFrequency: p.changeFrequency, priority: p.priority }));
}
