import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { indexingEnabled, site } from "@/config/site";
import { isCategoryId } from "@/data/taxonomy";
import { isLocale, languageAlternates, localePath } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { fmt } from "@/i18n/format";
import { getCatalog, getItem, isGenuine } from "@/lib/catalog";
import { localizeItem } from "@/lib/localize";
import { CollectionView } from "@/components/CollectionView";

type Props = PageProps<"/[locale]/collection">;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  const sp = await searchParams;
  const found = await getItem(first(sp.item));

  if (found) {
    const item = localizeItem(found, locale);
    const title = item.brand ? `${item.brand} ${item.name}` : item.name;
    const genuine = isGenuine(item);
    const description = genuine
      ? fmt(t.meta.itemDescription, { title, ref: item.modelReference ? fmt(t.meta.itemRef, { ref: item.modelReference }) : "", description: item.description ?? "" })
          .replace(/\s+/g, " ")
          .trim()
      : fmt(t.meta.previewDescription, { description: item.description ?? title });
    const image = item.images[0];
    const path = `/collection?item=${encodeURIComponent(item.ref)}`;
    const url = localePath(locale, path);
    return {
      title: genuine ? title : fmt(t.meta.previewTitle, { title }),
      description,
      alternates: genuine ? { canonical: url, languages: languageAlternates(path) } : { canonical: localePath(locale, "/collection"), languages: languageAlternates("/collection") },
      // Editorial previews are not items; keep them out of search results.
      robots: indexingEnabled && genuine ? { index: true, follow: true } : { index: false, follow: true },
      openGraph: {
        title: `${title} | SEVN HEVN`,
        description,
        url,
        images: image ? [{ url: image.src, width: image.width, height: image.height, alt: image.alt }] : undefined,
      },
      twitter: { card: "summary_large_image", title: `${title} | SEVN HEVN`, description, images: image ? [image.src] : undefined },
    };
  }

  const cat = first(sp.category);
  const label = isCategoryId(cat) ? t.ui.categories[cat] : null;
  const title = label ? fmt(t.meta.categoryTitle, { category: label }) : t.meta.collectionTitle;
  const path = label ? `/collection?category=${cat}` : "/collection";
  return {
    title,
    description: fmt(t.meta.collectionDescription, { subject: label ?? t.meta.collectionSubject }),
    alternates: { canonical: localePath(locale, path), languages: languageAlternates(path) },
    openGraph: { title: `${title} | SEVN HEVN`, url: localePath(locale, path), images: ["/og-image.jpg"] },
  };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const items = (await getCatalog()).map((i) => localizeItem(i, locale));
  const found = await getItem(first(sp.item));
  const item = found ? localizeItem(found, locale) : undefined;

  // Product structured data only for genuine, non-demo items — never editorial previews.
  // Name, brand, reference, price and currency are the same in every language.
  const jsonLd =
    item && isGenuine(item)
      ? {
          "@context": "https://schema.org",
          "@type": "Product",
          name: item.brand ? `${item.brand} ${item.name}` : item.name,
          sku: item.ref,
          inLanguage: locale,
          ...(item.brand ? { brand: { "@type": "Brand", name: item.brand } } : {}),
          ...(item.modelReference ? { mpn: item.modelReference } : {}),
          ...(item.description ? { description: item.description } : {}),
          image: item.images.map((i) => new URL(i.src, site.url).toString()),
          ...(item.status === "available" && item.priceAED
            ? {
                offers: {
                  "@type": "Offer",
                  price: item.priceAED,
                  priceCurrency: "AED",
                  availability: "https://schema.org/InStock",
                  url: `${site.url}${localePath(locale, `/collection?item=${encodeURIComponent(item.ref)}`)}`,
                  seller: { "@type": "Organization", name: site.name },
                },
              }
            : {}),
        }
      : null;

  return (
    <>
      <CollectionView items={items} />
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
    </>
  );
}
