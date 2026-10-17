import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { indexingEnabled, site } from "@/config/site";
import { isLocale, localePath } from "@/i18n/config";
import { fmt } from "@/i18n/format";
import { getDictionary } from "@/i18n/dictionaries";
import { conciergeReady } from "@/lib/concierge/config";
import { journalDate } from "@/lib/format";
import { coverPhoto, getJournalPost } from "@/lib/journal";
import { baseOpenGraph } from "@/lib/seo";
import { JournalBody } from "@/components/JournalBody";
import { NewsletterForm } from "@/components/NewsletterForm";
import "../../../journal.css";

type Props = PageProps<"/[locale]/journal/[slug]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const post = await getJournalPost(slug);
  if (!post) return { title: getDictionary(locale).journal.title, robots: { index: false, follow: true } };
  const path = localePath(locale, `/journal/${post.slug}`);
  const description = post.metaDescription ?? post.summary ?? undefined;
  return {
    // The SEO agent wrote and code counted this title; it is used exactly as written.
    title: { absolute: post.metaTitle ?? `${post.title} | SEVN HEVN` },
    description,
    keywords: post.keywords,
    alternates: { canonical: path },
    robots: indexingEnabled ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      ...baseOpenGraph(locale),
      type: "article",
      title: post.metaTitle ?? post.title,
      description,
      url: path,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
    },
  };
}

export default async function JournalArticle({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const post = await getJournalPost(slug);
  if (!post) notFound();
  const t = getDictionary(locale).journal;
  const href = (path: string) => localePath(locale, path);
  const url = `${site.url}${href(`/journal/${post.slug}`)}`;

  // Cover: the article's first photo (the shop's own photo of a piece it lists).
  const cover = coverPhoto(post);
  const chat = await conciergeReady();

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.metaDescription ?? post.summary ?? undefined,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
      inLanguage: locale,
      keywords: post.keywords.join(", ") || undefined,
      mainEntityOfPage: url,
      url,
      ...(post.media.some((m) => m.type === "photo") ? { image: post.media.flatMap((m) => (m.type === "photo" ? [m.src] : [])) } : {}),
      author: { "@type": "Organization", name: site.name, url: site.url },
      publisher: { "@type": "Organization", name: site.name, url: site.url, logo: { "@type": "ImageObject", url: `${site.url}/brand/sevn-hevn-wordmark.svg` } },
    },
    ...(post.faq.length
      ? [{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: post.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
        }]
      : []),
  ];

  return (
    <article className="journal-article">
      <header className="container journal-article__head">
        <p className="eyebrow">
          <Link href={href("/journal")}>{t.eyebrow}</Link>
        </p>
        <h1 className="display display--sm journal-article__title">{post.title}</h1>
        <p className="journal-article__date">
          <time dateTime={post.publishedAt}>{fmt(t.published, { date: journalDate(post.publishedAt) })}</time>
        </p>
        {post.summary && <p className="journal-article__lede">{post.summary}</p>}
      </header>
      {cover && (
        <figure className="container journal-article__cover">
          <Image src={cover.src} alt={`${cover.piece}, ${cover.alt}`} width={cover.width} height={cover.height} sizes="(max-width: 899px) 100vw, 760px" quality={85} priority />
        </figure>
      )}
      <div className="container journal-article__body">
        <JournalBody md={post.bodyMd} href={href} media={post.media} hide={cover ? `photo:${cover.id}` : undefined} />
        {post.faq.length > 0 && (
          <section className="journal-faq" aria-labelledby="journal-faq">
            <h2 id="journal-faq">{t.faqTitle}</h2>
            {post.faq.map((f, i) => (
              <details key={i} className="journal-faq__item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </section>
        )}
        <aside className="journal-closing">
          <h2>{t.closingTitle}</h2>
          <p>{t.closingText}</p>
          <p className="journal-closing__links">
            {chat && <Link className="btn btn--dark" href={href("/chat")}>{t.closingCta}</Link>}
            <Link className="btn btn--line" href={href("/collection")}>{t.collectionCta}</Link>
          </p>
        </aside>
        <aside className="journal-signup" aria-labelledby="journal-signup">
          <h2 id="journal-signup">{t.signupTitle}</h2>
          <p>{t.signupText}</p>
          <NewsletterForm />
        </aside>
        <p className="journal-article__back">
          <Link href={href("/journal")}>← {t.back}</Link>
        </p>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </article>
  );
}
