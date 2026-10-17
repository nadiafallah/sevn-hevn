import type { Metadata } from "next";
import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { site } from "@/config/site";
import { coreBrands, jewelleryOnlyBrands, type Brand } from "@/data/brands";
import { categories, type CategoryId } from "@/data/taxonomy";
import type { ItemImage } from "@/data/types";
import { isLocale, localePath } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { plural } from "@/i18n/format";
import { rich } from "@/i18n/rich";
import { getCatalog, getNewArrivals } from "@/lib/catalog";
import { journalDate } from "@/lib/format";
import { getJournalCards } from "@/lib/journal";
import { categoryPath, toShopItem } from "@/lib/paths";
import { baseOpenGraph } from "@/lib/seo";
import { sortItems } from "@/lib/shop";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { ItemCard } from "@/components/ItemCard";
import { PanelButton } from "@/components/PanelButton";
import { ArrowIcon, WhatsAppIcon } from "@/components/icons";
import "../journal.css";

/**
 * Category images: the newest listed piece's own photo. Until a category has one, the approved
 * AI-generated editorial image (always labelled as such) stands in; Jewellery has none, so its card
 * is typographic. Never shown as a piece for sale.
 */
const editorialFallback: Partial<Record<CategoryId, ItemImage & { position: string }>> = {
  bags: { src: "/images/editorial/bag-cognac.jpg", width: 1122, height: 1028, alt: "", position: "50% 60%" },
  shoes: { src: "/images/editorial/loafer-cobalt-suede.jpg", width: 1122, height: 1402, alt: "", position: "50% 55%" },
  watches: { src: "/images/editorial/watch-gold-rectangular.jpg", width: 1122, height: 1402, alt: "", position: "50% 45%" },
};

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return {
    title: { absolute: getDictionary(locale).meta.homeTitle },
    alternates: { canonical: localePath(locale, "/") },
    openGraph: { ...baseOpenGraph(locale), url: localePath(locale, "/") },
  };
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const t = d.home;
  const ui = d.ui;
  const href = (path: string) => localePath(locale, path);
  const catalog = await getCatalog();
  const arrivals = (await getNewArrivals(4)).map(toShopItem);
  const articles = (await getJournalCards()).slice(0, 3);

  const cards = categories.map((c) => {
    const pieces = sortItems(
      catalog.filter((i) => i.category === c.id),
      "newest",
    );
    const real = pieces.find((i) => i.images.length && i.status !== "sold")?.images[0];
    return { id: c.id, count: pieces.length, image: real ? { ...real, position: "50% 50%" } : editorialFallback[c.id], ai: !real && !!editorialFallback[c.id] };
  });
  const listedBrands = new Set(catalog.map((i) => i.brandId));
  const brandLink = (b: Brand) => (listedBrands.has(b.id) ? href(`/collection?brand=${b.id}`) : null);

  // Tells search engines the site's name and the other ways people write it (Google "site names").
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    alternateName: site.alternateNames,
    url: `${site.url}/`,
    inLanguage: "en",
  };

  return (
    <>
      {/* 1 · Hero */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__media">
          <Image src="/images/editorial/hero-emerald-noir.jpg" alt={t.heroAlt} width={1672} height={941} priority sizes="100vw" className="hero__img" />
          <span className="media-label">{t.aiImage}</span>
        </div>
        <div className="container hero__content">
          <p className="eyebrow hero__eyebrow">{t.heroEyebrow}</p>
          <h1 id="hero-title" className="hero__title">
            {t.heroLines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && " "}
                <span className="hero__line">
                  <span>{rich(line)}</span>
                </span>
              </Fragment>
            ))}
          </h1>
          <p className="hero__lead">{t.heroLead}</p>
          <div className="hero__actions">
            <Link href={href("/collection")} className="btn btn--dark">
              {t.explore}
            </Link>
            <PanelButton panel={{ type: "sourcing" }} className="text-link hero__alt">
              {t.requestPiece} <ArrowIcon size={14} />
            </PanelButton>
          </div>
        </div>
      </section>

      {/* 2 · The four categories */}
      <section className="container section" aria-labelledby="cat-title">
        <div className="section__head" data-reveal>
          <div>
            <p className="eyebrow">{t.categoriesEyebrow}</p>
            <h2 id="cat-title" className="h2">
              {rich(t.categoriesTitle)}
            </h2>
          </div>
        </div>
        <ul className="cat-cards">
          {cards.map((c, i) => (
            <li key={c.id} data-reveal style={{ transitionDelay: `${i * 80}ms` }}>
              <Link href={href(categoryPath(c.id))} className={`cat-card${c.image ? "" : " cat-card--plain"}`}>
                <span className="cat-card__media">
                  {c.image && (
                    <Image
                      src={c.image.src}
                      alt={c.ai ? t.categoryAlt[c.id] : c.image.alt}
                      width={c.image.width}
                      height={c.image.height}
                      sizes="(min-width: 1000px) 24vw, 46vw"
                      className="cat-card__img"
                      style={{ objectPosition: c.image.position }}
                    />
                  )}
                  {c.ai && <span className="media-label">{t.aiImageShort}</span>}
                </span>
                <span className="cat-card__text">
                  <span className="cat-card__name">{ui.categories[c.id]}</span>
                  <span className="cat-card__meta">{c.count ? plural(locale, c.count, t.categoryCount) : t.categoryRequest}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* 3 · New arrivals (real pieces only) */}
      <section className="container section section--tight" aria-labelledby="new-title">
        <div className="section__head" data-reveal>
          <div>
            <p className="eyebrow">{t.newEyebrow}</p>
            <h2 id="new-title" className="h2">
              {rich(t.newTitle)}
            </h2>
          </div>
          {arrivals.length > 0 && (
            <Link href={href("/collection")} className="text-link">
              {t.viewAll} <ArrowIcon size={14} />
            </Link>
          )}
        </div>
        {arrivals.length > 0 ? (
          <div className="grid grid--shop" data-reveal>
            {arrivals.map((item) => (
              <ItemCard key={item.ref} item={item} />
            ))}
          </div>
        ) : (
          <p className="new-empty" data-reveal>
            {t.newEmpty.split("{handle}")[0]}
            <a href={site.social.instagram.url} target="_blank" rel="noopener noreferrer" dir="ltr">
              {site.social.instagram.handle}
            </a>
            {t.newEmpty.split("{handle}")[1]}
          </p>
        )}
      </section>

      {/* 4 · The houses */}
      <section className="section houses-band" aria-labelledby="houses-title">
        <div className="container">
          <div className="section__head" data-reveal>
            <div>
              <p className="eyebrow">{t.brandsEyebrow}</p>
              <h2 id="houses-title" className="h2">
                {rich(t.brandsTitle)}
              </h2>
            </div>
          </div>
          <ul className="house-list" data-reveal>
            {coreBrands.map((b) => (
              <li key={b.id}>
                <HouseLink brand={b} link={brandLink(b)} requestLabel={t.brandsRequest} />
              </li>
            ))}
          </ul>
          <p className="house-list__label" data-reveal>
            {t.brandsJewellery}
          </p>
          <ul className="house-list house-list--small" data-reveal>
            {jewelleryOnlyBrands.map((b) => (
              <li key={b.id}>
                <HouseLink brand={b} link={brandLink(b)} requestLabel={t.brandsRequest} jewellery />
              </li>
            ))}
          </ul>
          <p className="muted small house-list__fine">{t.brandsFine}</p>
        </div>
      </section>

      {/* 4b · The latest journal articles (only once one is published) */}
      {articles.length > 0 && (
        <section className="container section section--tight" aria-labelledby="journal-title">
          <div className="section__head" data-reveal>
            <div>
              <p className="eyebrow">{t.journalEyebrow}</p>
              <h2 id="journal-title" className="h2">
                {rich(t.journalTitle)}
              </h2>
            </div>
            <Link href={href("/journal")} className="text-link">
              {t.journalAll} <ArrowIcon size={14} />
            </Link>
          </div>
          <ol className="journal-teasers" data-reveal>
            {articles.map((a) => (
              <li key={a.slug} className="journal-teaser">
                <time className="journal-card__date" dateTime={a.publishedAt}>
                  {journalDate(a.publishedAt)}
                </time>
                <h3 className="journal-teaser__title">
                  <Link href={href(`/journal/${a.slug}`)}>{a.title}</Link>
                </h3>
                {a.summary && <p className="journal-teaser__summary">{a.summary}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 5 · Special requests */}
      <section id="sourcing" className="band band--dark request-band" aria-labelledby="request-title">
        <div className="container request-band__inner" data-reveal>
          <div>
            <p className="eyebrow eyebrow--champagne">{t.requestEyebrow}</p>
            <h2 id="request-title" className="h2">
              {rich(t.requestTitle)}
            </h2>
            <p className="request-band__text">{t.requestText}</p>
          </div>
          <div className="request-band__actions">
            <PanelButton panel={{ type: "sourcing" }} className="btn btn--light">
              {t.requestCta}
            </PanelButton>
            <a className="btn btn--outline-light" href={whatsappUrl(generalMessage(ui.messages))} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon size={18} /> {t.whatsapp}
            </a>
          </div>
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}

/** A house: a link to its pieces when any are listed, otherwise a sourcing request for it. */
function HouseLink({ brand, link, requestLabel, jewellery }: { brand: Brand; link: string | null; requestLabel: string; jewellery?: boolean }) {
  if (link) {
    return (
      <Link href={link} className="house" lang="en" dir="ltr">
        {brand.name}
      </Link>
    );
  }
  return (
    <PanelButton panel={{ type: "sourcing", prefill: { brand: brand.name, ...(jewellery ? { category: "jewellery" } : {}) } }} className="house house--request">
      <span lang="en" dir="ltr">
        {brand.name}
      </span>
      <span className="house__hint">{requestLabel}</span>
    </PanelButton>
  );
}
