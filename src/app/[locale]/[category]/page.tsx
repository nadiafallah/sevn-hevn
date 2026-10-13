import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { categoryIds, isCategoryId } from "@/data/taxonomy";
import { isLocale } from "@/i18n/config";
import { ListingJsonLd, listingMetadata } from "@/lib/listing-page";
import { ListingView } from "@/components/ListingView";

type Props = PageProps<"/[locale]/[category]">;

// Only the four categories exist: /bags, /shoes, /watches, /jewellery. Anything else is a 404.
export const dynamicParams = false;
export function generateStaticParams() {
  return categoryIds.map((category) => ({ category }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, category } = await params;
  if (!isLocale(locale) || !isCategoryId(category)) return {};
  return listingMetadata(locale, { category });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale, category } = await params;
  if (!isLocale(locale) || !isCategoryId(category)) notFound();
  // Filters live in the query string; reading it renders the listing on the server with them applied.
  await searchParams;
  return (
    <>
      <Suspense>
        <ListingView category={category} />
      </Suspense>
      <ListingJsonLd locale={locale} category={category} />
    </>
  );
}
