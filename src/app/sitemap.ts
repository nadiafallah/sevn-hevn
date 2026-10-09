import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { categories } from "@/data/taxonomy";
import { languageAlternates, localePath, locales } from "@/i18n/config";
import { getCatalog, isGenuine } from "@/lib/catalog";

/** Every page in all four languages, each entry listing its language versions (hreflang). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const genuine = (await getCatalog()).filter(isGenuine);
  const pages: { path: string; changeFrequency: "daily" | "weekly"; priority: number }[] = [
    { path: "/", changeFrequency: "weekly", priority: 1 },
    { path: "/collection", changeFrequency: "daily", priority: 0.8 },
    ...categories.map((c) => ({ path: `/collection?category=${c.id}`, changeFrequency: "daily" as const, priority: 0.7 })),
    ...genuine.map((i) => ({ path: `/collection?item=${encodeURIComponent(i.ref)}`, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
  const absolute = (path: string) => `${site.url}${path}`;
  return pages.flatMap((p) => {
    const languages = Object.fromEntries(Object.entries(languageAlternates(p.path)).map(([l, path]) => [l, absolute(path)]));
    return locales.map((locale) => ({
      url: absolute(localePath(locale, p.path)),
      changeFrequency: p.changeFrequency,
      priority: p.priority,
      alternates: { languages },
    }));
  });
}
