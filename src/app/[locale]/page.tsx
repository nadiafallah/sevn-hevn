import type { Metadata } from "next";
import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { site } from "@/config/site";
import { isLocale, languageAlternates, localePath } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { rich } from "@/i18n/rich";
import { getFeatured } from "@/lib/catalog";
import { localizeItem } from "@/lib/localize";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { ItemCard } from "@/components/ItemCard";
import { EditRail } from "@/components/EditRail";
import { PanelButton } from "@/components/PanelButton";
import { SourcingForm } from "@/components/SourcingForm";
import { ViewingForm } from "@/components/ViewingForm";
import { ContactList } from "@/components/SitePanels";
import { ArrowIcon, WhatsAppIcon } from "@/components/icons";

// Category doors use detail crops of the supplied editorial images (set per door in CSS).
const categoryDoors = [
  { id: "bags", image: { src: "/images/editorial/bag-cognac.jpg", width: 1122, height: 1028 } },
  { id: "watches", image: { src: "/images/editorial/watch-gold-rectangular.jpg", width: 1122, height: 1402 } },
  { id: "shoes", image: { src: "/images/editorial/loafer-cobalt-suede.jpg", width: 1122, height: 1402 } },
] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return {
    title: { absolute: getDictionary(locale).meta.homeTitle },
    alternates: { canonical: localePath(locale, "/"), languages: languageAlternates("/") },
    openGraph: { url: localePath(locale, "/") },
  };
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const t = d.home;
  const ui = d.ui;
  const href = (path: string) => localePath(locale, path);
  const featured = (await getFeatured(6)).map((i) => localizeItem(i, locale));
  const previewsOnly = featured.every((i) => i.status === "editorial_preview");
  const houses = site.sourcingBrands;

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

      {/* 2 · Maison introduction */}
      <section className="intro container" aria-labelledby="intro-title">
        <div className="intro__head" data-reveal>
          <p className="eyebrow">{t.introEyebrow}</p>
          <h2 id="intro-title" className="h2 h2--xl">
            {rich(t.introTitle)}
          </h2>
        </div>
        <div className="intro__body" data-reveal>
          <p className="intro__text">{t.introText}</p>
          <ol className="pillars">
            {t.pillars.map((p) => (
              <li key={p.title}>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 3 · Category discovery */}
      <section className="container section section--doors" aria-labelledby="cat-title">
        <div className="section__head" data-reveal>
          <div>
            <p className="eyebrow">{t.discover}</p>
            <h2 id="cat-title" className="h2">
              {rich(t.categoryTitle)}
            </h2>
          </div>
          <Link href={href("/collection")} className="text-link">
            {t.allPieces} <ArrowIcon size={14} />
          </Link>
        </div>
        <ul className="doors">
          {categoryDoors.map((c, i) => (
            <li key={c.id} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
              <Link href={href(`/collection?category=${c.id}`)} className={`door door--${c.id}`}>
                <div className="door__media">
                  <Image src={c.image.src} alt={t.doors[c.id].alt} width={c.image.width} height={c.image.height} sizes="(min-width: 1000px) 25vw, 50vw" className="door__img" />
                  <span className="media-label">{t.aiImageShort}</span>
                </div>
                <div className="door__text">
                  <span className="door__num" aria-hidden="true">
                    0{i + 1}
                  </span>
                  <h3>{ui.categories[c.id]}</h3>
                  <p>{t.doors[c.id].note}</p>
                  <span className="door__cta">
                    {t.exploreShort} <ArrowIcon size={14} />
                  </span>
                </div>
              </Link>
            </li>
          ))}
          <li data-reveal style={{ transitionDelay: `${categoryDoors.length * 90}ms` }}>
            <div className="door door--request">
              <span className="door__num" aria-hidden="true">
                04
              </span>
              <h3>{rich(t.beyondTitle)}</h3>
              <p>{t.beyondText}</p>
              <PanelButton panel={{ type: "sourcing", prefill: { category: "accessories" } }} className="btn btn--light">
                {t.requestPiece}
              </PanelButton>
            </div>
          </li>
        </ul>
      </section>

      {/* 4 · Curated selection */}
      <section className="section section--edit" aria-labelledby="edit-title">
        <div className="container section__head" data-reveal>
          <div>
            <p className="eyebrow">{t.editEyebrow}</p>
            <h2 id="edit-title" className="h2">
              {rich(t.editTitle)}
            </h2>
          </div>
          {previewsOnly && <span className="tag tag--line">{t.editorialPreview}</span>}
        </div>
        <div className="container" data-reveal>
          <EditRail label={previewsOnly ? t.railPreviews : t.railSelected}>
            {featured.map((item) => (
              <ItemCard key={item.ref} item={item} sizes="(min-width: 1000px) 25vw, 70vw" />
            ))}
          </EditRail>
        </div>
        <div className="container section__foot" data-reveal>
          {previewsOnly && <p className="muted small">{t.previewsNote}</p>}
          <Link href={href("/collection")} className="text-link">
            {t.viewCollection} <ArrowIcon size={14} />
          </Link>
        </div>
      </section>

      {/* 5 · Private sourcing */}
      <section id="sourcing" className="band band--dark" aria-labelledby="sourcing-title">
        <div className="container">
          <div className="band__intro" data-reveal>
            <p className="eyebrow eyebrow--champagne">{t.sourcingEyebrow}</p>
            <h2 id="sourcing-title" className="h2 h2--xl">
              {rich(t.sourcingTitle)}
            </h2>
          </div>
          <div className="houses" data-reveal>
            <p className="houses__label">{t.housesLabel}</p>
            <ul className="houses__list">
              {houses.map((h) => (
                <li key={h} lang="en" dir="ltr">
                  {h}
                </li>
              ))}
            </ul>
            <p className="houses__fine">{t.housesFine}</p>
          </div>
          <div className="band__grid">
            <div className="band__copy" data-reveal>
              <p>{t.sourcingText}</p>
              <ol className="steps">
                {t.steps.map((s) => (
                  <li key={s.title}>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="band__form" data-reveal>
              <SourcingForm tone="dark" carryKey="sourcing:home" />
            </div>
          </div>
        </div>
      </section>

      {/* 6 · Private viewing */}
      <section id="visit" className="container section visit" aria-labelledby="visit-title">
        <div className="visit__copy" data-reveal>
          <p className="eyebrow">{t.visitEyebrow.replace("{location}", ui.location)}</p>
          <h2 id="visit-title" className="h2 h2--xl">
            {rich(t.visitTitle)}
          </h2>
          <p>{t.visitText}</p>
          <div className="visit__actions">
            <a className="btn btn--dark" href={whatsappUrl(generalMessage(ui.messages))} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon size={18} /> {t.chatWhatsApp}
            </a>
            <a className="btn btn--line" href={site.contact.telHref}>
              {t.call} <bdi dir="ltr">{site.contact.phoneDisplay}</bdi>
            </a>
          </div>
          <ContactList />
        </div>
        <div className="visit__form" data-reveal>
          <p className="eyebrow">{t.viewingEyebrow}</p>
          <ViewingForm carryKey="viewing:home" />
        </div>
      </section>
    </>
  );
}
