import Image from "next/image";
import Link from "next/link";
import { site } from "@/config/site";
import { getFeatured } from "@/lib/catalog";
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
  { id: "bags", label: "Bags", note: "Top-handle, shoulder, clutches and travel", image: { src: "/images/editorial/bag-cognac.jpg", width: 1122, height: 1028, alt: "Cognac leather top-handle bag on a travertine plinth" } },
  { id: "watches", label: "Watches", note: "Contemporary and vintage, by reference and year", image: { src: "/images/editorial/watch-gold-rectangular.jpg", width: 1122, height: 1402, alt: "Rectangular gold-tone watch on a dark leather strap" } },
  { id: "shoes", label: "Shoes", note: "Loafers, mules, sandals and more", image: { src: "/images/editorial/loafer-cobalt-suede.jpg", width: 1122, height: 1402, alt: "Cobalt suede loafers with gold-tone detail" } },
];

const pillars = [
  { title: "Considered selection", text: "Distinctive pieces chosen for design, craft and character, rather than volume." },
  { title: "Personal service", text: "Speak with a person. We reply on WhatsApp, by phone or by email." },
  { title: "Simple to ask", text: "Enquire about a piece, request one you don’t see, or arrange a private viewing in Dubai." },
];

const steps = [
  { title: "Tell us the piece", text: "Designer, model or reference, colour, size and an approximate budget." },
  { title: "We reply personally", text: "A member of our team answers on WhatsApp or by email." },
  { title: "View, then decide", text: "See it privately in Dubai, or talk through the details first." },
];

export default async function HomePage() {
  const featured = await getFeatured(6);
  const previewsOnly = featured.every((i) => i.status === "editorial_preview");
  const houses = site.sourcingBrands;

  return (
    <>
      {/* 1 · Hero */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__media">
          <Image
            src="/images/editorial/hero-emerald-noir.jpg"
            alt="An emerald top-handle bag and a black quilted shoulder bag on a travertine plinth in warm light"
            width={1672}
            height={941}
            priority
            sizes="100vw"
            className="hero__img"
          />
          <span className="media-label">AI-generated editorial image</span>
        </div>
        <div className="container hero__content">
          <p className="eyebrow hero__eyebrow">Bags · Watches · Shoes · Accessories</p>
          <h1 id="hero-title" className="hero__title">
            <span className="hero__line">
              <span>Welcome to</span>
            </span>{" "}
            <span className="hero__line">
              <span>
                your <em>happy</em>
              </span>
            </span>{" "}
            <span className="hero__line">
              <span>
                <em>place.</em>
              </span>
            </span>
          </h1>
          <p className="hero__lead">{site.supportingLine}</p>
          <div className="hero__actions">
            <Link href="/collection" className="btn btn--dark">
              Explore the Collection
            </Link>
            <PanelButton panel={{ type: "sourcing" }} className="text-link hero__alt">
              Request a piece <ArrowIcon size={14} />
            </PanelButton>
          </div>
        </div>
      </section>

      {/* 2 · Maison introduction */}
      <section className="intro container" aria-labelledby="intro-title">
        <div className="intro__head" data-reveal>
          <p className="eyebrow">Welcome to SEVN HEVN</p>
          <h2 id="intro-title" className="h2 h2--xl">
            A feeling of <em>complete happiness.</em>
          </h2>
        </div>
        <div className="intro__body" data-reveal>
          <p className="intro__text">
            SEVN HEVN is the pleasure of finding something exceptional. From Dubai, we bring together bags, watches — vintage among them — shoes and accessories chosen for their
            character and beauty, with the attentive, personal service a meaningful piece deserves.
          </p>
          <ol className="pillars">
            {pillars.map((p) => (
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
            <p className="eyebrow">Discover</p>
            <h2 id="cat-title" className="h2">
              Begin with a <em>category.</em>
            </h2>
          </div>
          <Link href="/collection" className="text-link">
            All pieces <ArrowIcon size={14} />
          </Link>
        </div>
        <ul className="doors">
          {categoryDoors.map((c, i) => (
            <li key={c.id} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
              <Link href={`/collection?category=${c.id}`} className={`door door--${c.id}`}>
                <div className="door__media">
                  <Image src={c.image.src} alt={c.image.alt} width={c.image.width} height={c.image.height} sizes="(min-width: 1000px) 25vw, 50vw" className="door__img" />
                  <span className="media-label">AI editorial image</span>
                </div>
                <div className="door__text">
                  <span className="door__num" aria-hidden="true">
                    0{i + 1}
                  </span>
                  <h3>{c.label}</h3>
                  <p>{c.note}</p>
                  <span className="door__cta">
                    Explore <ArrowIcon size={14} />
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
              <h3>
                Accessories <em>&amp; beyond</em>
              </h3>
              <p>Belts, scarves, charms or a piece you’ve been looking for — tell us, and we’ll see what’s possible.</p>
              <PanelButton panel={{ type: "sourcing", prefill: { category: "accessories" } }} className="btn btn--light">
                Request a piece
              </PanelButton>
            </div>
          </li>
        </ul>
      </section>

      {/* 4 · Curated selection */}
      <section className="section section--edit" aria-labelledby="edit-title">
        <div className="container section__head" data-reveal>
          <div>
            <p className="eyebrow">The edit</p>
            <h2 id="edit-title" className="h2">
              Find your next <em>favourite.</em>
            </h2>
          </div>
          {previewsOnly && <span className="tag tag--line">Editorial preview</span>}
        </div>
        <div className="container" data-reveal>
          <EditRail label={previewsOnly ? "Editorial previews" : "Selected pieces"}>
            {featured.map((item) => (
              <ItemCard key={item.ref} item={item} sizes="(min-width: 1000px) 25vw, 70vw" />
            ))}
          </EditRail>
        </div>
        <div className="container section__foot" data-reveal>
          {previewsOnly && <p className="muted small">AI-generated editorial images — not items for sale. Listings with real photographs, condition and prices will appear in the Collection.</p>}
          <Link href="/collection" className="text-link">
            View the Collection <ArrowIcon size={14} />
          </Link>
        </div>
      </section>

      {/* 5 · Private sourcing */}
      <section id="sourcing" className="band band--dark" aria-labelledby="sourcing-title">
        <div className="container">
          <div className="band__intro" data-reveal>
            <p className="eyebrow eyebrow--champagne">Private sourcing</p>
            <h2 id="sourcing-title" className="h2 h2--xl">
              Something on your <em>mind?</em>
            </h2>
          </div>
          <div className="houses" data-reveal>
            <p className="houses__label">Houses our clients often ask us about</p>
            <ul className="houses__list">
              {houses.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
            <p className="houses__fine">We are independent and not affiliated with any brand named on this site.</p>
          </div>
          <div className="band__grid">
            <div className="band__copy" data-reveal>
              <p>Tell us the piece you’re looking for. We’ll prepare a WhatsApp message for you to send, and a member of our team will reply personally.</p>
              <ol className="steps">
                {steps.map((s) => (
                  <li key={s.title}>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="band__form" data-reveal>
              <SourcingForm tone="dark" />
            </div>
          </div>
        </div>
      </section>

      {/* 6 · Private viewing */}
      <section id="visit" className="container section visit" aria-labelledby="visit-title">
        <div className="visit__copy" data-reveal>
          <p className="eyebrow">{site.location.display} · By appointment</p>
          <h2 id="visit-title" className="h2 h2--xl">
            Arrange a private <em>viewing.</em>
          </h2>
          <p>
            See a piece in person, or sit down with us to talk through what you’re looking for. Share a preferred date and time, and our team will reply to arrange it. Requests
            are confirmed personally — nothing is booked until we confirm with you.
          </p>
          <div className="visit__actions">
            <a className="btn btn--dark" href={whatsappUrl(generalMessage())} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon size={18} /> Chat on WhatsApp
            </a>
            <a className="btn btn--line" href={site.contact.telHref}>
              Call {site.contact.phoneDisplay}
            </a>
          </div>
          <ContactList />
        </div>
        <div className="visit__form" data-reveal>
          <p className="eyebrow">Viewing request</p>
          <ViewingForm />
        </div>
      </section>
    </>
  );
}
