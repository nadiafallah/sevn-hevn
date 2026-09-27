import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { getCatalog, isGenuine } from "@/lib/catalog";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const genuine = (await getCatalog()).filter(isGenuine);
  return [
    { url: `${site.url}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${site.url}/collection`, changeFrequency: "daily", priority: 0.8 },
    ...genuine.map((i) => ({
      url: `${site.url}/collection?item=${encodeURIComponent(i.ref)}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
