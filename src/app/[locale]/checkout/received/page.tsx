import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { ReceivedView } from "@/components/ReceivedView";

type Props = PageProps<"/[locale]/checkout/received">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).meta.receivedTitle, robots: { index: false, follow: false } };
}

export default async function ReceivedPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <Suspense>
      <ReceivedView />
    </Suspense>
  );
}
