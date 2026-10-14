import "server-only";
import type { Metadata } from "next";
import { indexingEnabled, site } from "@/config/site";
import { brandById, type BrandId } from "@/data/brands";
import type { CategoryId } from "@/data/taxonomy";
import { localePath, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { fmt } from "@/i18n/format";
import { getCatalog, isGenuine } from "@/lib/catalog";
import { categoryPath, productPath } from "@/lib/paths";
import { baseOpenGraph } from "@/lib/seo";

/** Genuine, published pieces in a listing's scope (the only ones that count for search engines). */
async function genuineIn(category?: CategoryId, brand?: BrandId) {
  return (await getCatalog()).filter((i) => isGenuine(i) && (!category || i.category === category) && (!brand || i.brandId === brand));
}

/**
 * Titles, canonical address and language versions of a listing. Filters never change the canonical
 * address. A listing with no genuine pieces stays out of search results (noindex) until one is
 * published, so search engines are never sent to an empty page.
 */
export async function listingMetadata(locale: Locale, scope: { category?: CategoryId; brand?: BrandId }): Promise<Metadata> {
  const d = getDictionary(locale);
  const { category, brand } = scope;
  const path = category ? categoryPath(category, brand) : "/collection";
  const label = category ? d.ui.categories[category] : undefined;
  const brandName = brand ? brandById[brand].name : undefined;
  const title = label && brandName ? fmt(d.meta.brandCategoryTitle, { brand: brandName, category: label }) : (label ?? d.meta.collectionTitle);
  const subject = label && brandName ? title : (label ?? d.meta.collectionSubject);
  const description = fmt(d.meta.collectionDescription, { subject });
  const empty = (await genuineIn(category, brand)).length === 0;
  return {
    title,
    description,
    alternates: { canonical: localePath(locale, path) },
    robots: indexingEnabled && !empty ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { ...baseOpenGraph(locale), title: `${title} | SEVN HEVN`, description, url: localePath(locale, path) },
  };
}

/** BreadcrumbList and ItemList structured data, from genuine pieces only. */
export async function ListingJsonLd({ locale, category, brand }: { locale: Locale; category?: CategoryId; brand?: BrandId }) {
  const d = getDictionary(locale);
  const pieces = await genuineIn(category, brand);
  const url = (path: string) => `${site.url}${localePath(locale, path)}`;
  const crumbs = [
    { name: d.ui.shop.home, path: "/" },
    ...(category ? [{ name: d.ui.categories[category], path: categoryPath(category) }] : [{ name: d.ui.shop.allPieces, path: "/collection" }]),
    ...(category && brand ? [{ name: brandById[brand].name, path: categoryPath(category, brand) }] : []),
  ];
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: url(c.path) })),
    },
    ...(pieces.length
      ? [
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: pieces.slice(0, 48).map((p, i) => ({ "@type": "ListItem", position: i + 1, url: url(productPath(p.ref)), name: `${p.brand} ${p.name}` })),
          },
        ]
      : []),
  ];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
