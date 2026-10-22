import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { OrderView } from "@/components/OrderView";

type Props = PageProps<"/[locale]/order">;

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The customer's private order page. The link's token is after "#", so this page never sees it on the server. */
export default async function OrderPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <OrderView />;
}
