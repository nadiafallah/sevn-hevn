import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { ListingJsonLd, listingMetadata } from "@/lib/listing-page";
import { ListingView } from "@/components/ListingView";

type Props = PageProps<"/[locale]/collection">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return listingMetadata(locale, {});
}

/**
 * Every category in one list, with search (?q=) and house (?brand=). Older addresses
 * (?category=…, ?item=…) are redirected to the category and product pages by src/proxy.ts.
 */
export default async function CollectionPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await searchParams;
  return (
    <>
      <Suspense>
        <ListingView />
      </Suspense>
      <ListingJsonLd locale={locale} />
    </>
  );
}
