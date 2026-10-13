import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { brandAllowedIn, brandById, brandsFor, isBrandId } from "@/data/brands";
import { categoryIds, isCategoryId } from "@/data/taxonomy";
import { isLocale } from "@/i18n/config";
import { ListingJsonLd, listingMetadata } from "@/lib/listing-page";
import { ListingView } from "@/components/ListingView";

type Props = PageProps<"/[locale]/[category]/[brand]">;

// Only houses the shop lists for that category: /bags/hermes, /jewellery/cartier — never /watches/cartier.
export const dynamicParams = false;
export function generateStaticParams() {
  return categoryIds.flatMap((category) => brandsFor(category).map((b) => ({ category, brand: b.id })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, category, brand } = await params;
  if (!isLocale(locale) || !isCategoryId(category) || !isBrandId(brand)) return {};
  return listingMetadata(locale, { category, brand });
}

export default async function CategoryBrandPage({ params, searchParams }: Props) {
  const { locale, category, brand } = await params;
  if (!isLocale(locale) || !isCategoryId(category) || !isBrandId(brand) || !brandAllowedIn(category, brandById[brand].name)) notFound();
  await searchParams;
  return (
    <>
      <Suspense>
        <ListingView category={category} brand={brand} />
      </Suspense>
      <ListingJsonLd locale={locale} category={category} brand={brand} />
    </>
  );
}
