import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { indexingEnabled } from "@/config/site";
import { isLocale, localePath } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { journalDate } from "@/lib/format";
import { getJournalCards } from "@/lib/journal";
import { baseOpenGraph } from "@/lib/seo";
import "../../journal.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/journal">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale).journal;
  const posts = await getJournalCards();
  return {
    title: t.title,
    description: t.description,
    alternates: { canonical: localePath(locale, "/journal") },
    // An empty journal is not worth indexing.
    robots: indexingEnabled && posts.length ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { ...baseOpenGraph(locale), title: `${t.title} | SEVN HEVN`, description: t.description, url: localePath(locale, "/journal") },
  };
}

export default async function JournalIndex({ params }: PageProps<"/[locale]/journal">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale).journal;
  const posts = await getJournalCards();
  return (
    <section className="container journal-index">
      <header className="journal-index__intro">
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 className="display display--sm">{t.heading}</h1>
        <p className="journal-index__lede">{t.intro}</p>
      </header>
      {posts.length ? (
        <ol className="journal-list">
          {posts.map((p) => (
            <li key={p.slug} className="journal-card">
              <time className="journal-card__date" dateTime={p.publishedAt}>
                {journalDate(p.publishedAt)}
              </time>
              <h2 className="journal-card__title">
                <Link href={localePath(locale, `/journal/${p.slug}`)}>{p.title}</Link>
              </h2>
              {p.summary && <p className="journal-card__summary">{p.summary}</p>}
              <Link className="journal-card__more" href={localePath(locale, `/journal/${p.slug}`)} aria-hidden="true" tabIndex={-1}>
                {t.read}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="journal-index__empty">{t.empty}</p>
      )}
    </section>
  );
}
