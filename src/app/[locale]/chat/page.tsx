import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, languageAlternates, localePath } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { ChatPage } from "@/components/concierge/ChatPage";

export async function generateMetadata({ params }: PageProps<"/[locale]/chat">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale).meta;
  return {
    title: t.chatTitle,
    description: t.chatDescription,
    alternates: { canonical: localePath(locale, "/chat"), languages: languageAlternates("/chat") },
  };
}

export default async function Chat({ params }: PageProps<"/[locale]/chat">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale).chatPage;
  return (
    <section className="container chat-page">
      <header className="chat-page__intro">
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 className="display display--sm">{t.title}</h1>
        <p className="chat-page__lede">{t.lede}</p>
      </header>
      <ChatPage />
    </section>
  );
}
