import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { indexingEnabled, site } from "@/config/site";
import { isLocale, languageAlternates, localePath } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { fmt } from "@/i18n/format";
import { getCatalog, getItem, isGenuine } from "@/lib/catalog";
import { isPurchasable, priceRange } from "@/lib/format";
import { localizeItem } from "@/lib/localize";
import { categoryPath, productPath, toShopItem } from "@/lib/paths";
import { baseOpenGraph } from "@/lib/seo";
import { availabilityOf, related } from "@/lib/shop";
import { ProductDetail } from "@/components/ProductDetail";

type Props = PageProps<"/[locale]/product/[ref]">;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, ref } = await params;
  if (!isLocale(locale)) return {};
  const found = await getItem(decodeURIComponent(ref));
  if (!found) return { title: getDictionary(locale).ui.shop.product.notFoundTitle, robots: { index: false, follow: true } };
  const d = getDictionary(locale);
  const item = localizeItem(found, locale);
  const title = `${item.brand ?? ""} ${item.name}`.trim();
  const description = fmt(d.meta.productDescription, {
    title,
    ref: item.modelReference ? fmt(d.meta.itemRef, { ref: item.modelReference }) : "",
    description: item.description ?? "",
    status: d.ui.shop.availability[availabilityOf(item)],
  })
    .replace(/\s+/g, " ")
    .trim();
  const path = productPath(item.ref);
  const image = item.images[0];
  return {
    title,
    description,
    alternates: { canonical: localePath(locale, path), languages: languageAlternates(path) },
    // Drafts and demo records are never indexed.
    robots: indexingEnabled && isGenuine(item) ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      ...baseOpenGraph(locale),
      title: `${title} | SEVN HEVN`,
      description,
      url: localePath(locale, path),
      ...(image && { images: [{ url: image.src, width: image.width, height: image.height, alt: image.alt }] }),
    },
    twitter: { card: "summary_large_image", title: `${title} | SEVN HEVN`, description, images: image ? [image.src] : undefined },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { locale, ref } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const found = await getItem(decodeURIComponent(ref));
  if (!found) notFound();
  const d = getDictionary(locale);
  const item = localizeItem(found, locale);
  const catalog = await getCatalog();
  const others = related(catalog, found).map((i) => toShopItem(localizeItem(i, locale)));
  const url = (path: string) => `${site.url}${localePath(locale, path)}`;

  // Structured data only for genuine, published pieces — never drafts or demo records — and an
  // Offer only where a price is actually listed.
  const range = priceRange(item);
  const availability = item.status === "sold" ? "SoldOut" : item.status === "reserved" ? "OutOfStock" : isPurchasable(item) ? "InStock" : null;
  const jsonLd = isGenuine(item)
    ? [
        {
          "@context": "https://schema.org",
          "@type": "Product",
          name: `${item.brand ?? ""} ${item.name}`.trim(),
          sku: item.ref,
          inLanguage: locale,
          ...(item.brand ? { brand: { "@type": "Brand", name: item.brand } } : {}),
          ...(item.modelReference ? { mpn: item.modelReference } : {}),
          ...(item.description ? { description: item.description } : {}),
          ...(item.colour ? { color: item.colour } : {}),
          ...(item.material ? { material: item.material } : {}),
          category: d.ui.categories[item.category],
          image: item.images.map((i) => new URL(i.src, site.url).toString()),
          ...(range && availability
            ? {
                offers: {
                  "@type": "Offer",
                  price: range.min,
                  priceCurrency: "AED",
                  availability: `https://schema.org/${availability}`,
                  ...(item.condition ? { itemCondition: item.condition === "new" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition" } : {}),
                  url: url(productPath(item.ref)),
                  seller: { "@type": "Organization", name: site.name },
                },
              }
            : {}),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { name: d.ui.shop.home, path: "/" },
            { name: d.ui.categories[item.category], path: categoryPath(item.category) },
            ...(item.brandId ? [{ name: item.brand!, path: categoryPath(item.category, item.brandId) }] : []),
            { name: item.name, path: productPath(item.ref) },
          ].map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: url(c.path) })),
        },
      ]
    : null;

  return (
    <>
      <ProductDetail item={item} related={others} initialSku={first(sp.sku)} />
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
    </>
  );
}
