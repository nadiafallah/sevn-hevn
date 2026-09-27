import type { MetadataRoute } from "next";
import { indexingEnabled, site } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  if (!indexingEnabled) {
    // Preview / pre-launch: keep the whole site out of search engines.
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
