import type { Metadata } from "next";
import { indexingEnabled, site } from "@/config/site";
import { categoryById, isCategoryId } from "@/data/taxonomy";
import { getCatalog, getItem, isGenuine } from "@/lib/catalog";
import { CollectionView } from "@/components/CollectionView";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const item = getItem(first(sp.item));

  if (item) {
    const title = item.brand ? `${item.brand} ${item.name}` : item.name;
    const genuine = isGenuine(item);
    const description = genuine
      ? `${title}${item.modelReference ? `, ref. ${item.modelReference}` : ""}. ${item.description ?? ""} Enquire with SEVN HEVN in Dubai.`.trim()
      : `Editorial preview: ${item.description ?? title}. AI-generated mood imagery, not an item for sale. Request a similar piece from SEVN HEVN in Dubai.`;
    const image = item.images[0];
    const url = `/collection?item=${encodeURIComponent(item.ref)}`;
    return {
      title: genuine ? title : `${title} — Editorial preview`,
      description,
      alternates: { canonical: genuine ? url : "/collection" },
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
  const label = isCategoryId(cat) ? categoryById[cat].label : null;
  const title = label ? `${label} — Collection` : "The Collection";
  return {
    title,
    description: `${label ?? "Bags, watches, shoes and jewellery"} at SEVN HEVN, Dubai. Browse the collection, enquire on WhatsApp or request a piece we don’t list.`,
    alternates: { canonical: label ? `/collection?category=${cat}` : "/collection" },
    openGraph: { title: `${title} | SEVN HEVN`, url: "/collection", images: ["/og-image.jpg"] },
  };
}

export default async function CollectionPage({ searchParams }: Props) {
  const sp = await searchParams;
  const items = getCatalog();
  const item = getItem(first(sp.item));

  // Product structured data only for genuine, non-demo items — never editorial previews.
  const jsonLd =
    item && isGenuine(item)
      ? {
          "@context": "https://schema.org",
          "@type": "Product",
          name: item.brand ? `${item.brand} ${item.name}` : item.name,
          sku: item.ref,
          ...(item.brand ? { brand: { "@type": "Brand", name: item.brand } } : {}),
          ...(item.modelReference ? { mpn: item.modelReference } : {}),
          ...(item.description ? { description: item.description } : {}),
          image: item.images.map((i) => `${site.url}${i.src}`),
          ...(item.status === "available" && item.priceAED
            ? {
                offers: {
                  "@type": "Offer",
                  price: item.priceAED,
                  priceCurrency: "AED",
                  availability: "https://schema.org/InStock",
                  url: `${site.url}/collection?item=${encodeURIComponent(item.ref)}`,
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
