import Image from "next/image";
import Link from "next/link";
import { site } from "@/config/site";
import { getFeatured } from "@/lib/catalog";
import { ItemCard } from "@/components/ItemCard";
import { PanelButton } from "@/components/PanelButton";
import { SourcingForm } from "@/components/SourcingForm";
import { ViewingForm } from "@/components/ViewingForm";
import { ContactList } from "@/components/SitePanels";
import { ArrowIcon } from "@/components/icons";

const categoryDoors = [
  { id: "bags", label: "Bags", note: "Top-handle, shoulder, clutches and travel", image: { src: "/images/editorial/bag-cognac.jpg", width: 1122, height: 1028, alt: "Cognac leather top-handle bag on a travertine plinth" } },
  { id: "watches", label: "Watches", note: "Including vintage — by reference, year and condition", image: { src: "/images/editorial/watch-gold-rectangular.jpg", width: 1122, height: 1402, alt: "Rectangular gold-tone watch on a dark leather strap" } },
  { id: "shoes", label: "Shoes", note: "Loafers, mules, sandals and more", image: { src: "/images/editorial/loafer-cobalt-suede.jpg", width: 1122, height: 1402, alt: "Cobalt suede loafers with gold-tone detail" } },
];

export default async function HomePage() {
  const featured = await getFeatured(4);
  const previewsOnly = featured.every((i) => i.status === "editorial_preview");

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
          <p className="eyebrow">Bags · Vintage watches · Shoes · Jewellery</p>
          <h1 id="hero-title" className="display">
            Welcome to your happy place.
          </h1>
          <p className="hero__lead">{site.supportingLine}</p>
          <div className="hero__actions">
            <Link href="/collection" className="btn btn--dark">
              Explore the Collection
            </Link>
            <PanelButton panel={{ type: "sourcing" }} className="btn btn--line">
              Request a Piece
            </PanelButton>
          </div>
        </div>
      </section>

      {/* 2 · Maison introduction */}
      <section className="intro container" aria-labelledby="intro-title" data-reveal>
        <p className="eyebrow">Welcome to SEVN HEVN</p>
        <h2 id="intro-title" className="h2">
          A feeling of complete happiness.
        </h2>
        <p className="intro__text">
          SEVN HEVN is the pleasure of finding something exceptional. From Dubai, we bring together bags, watches — vintage among them — shoes and jewellery chosen for their
          character and beauty, with the attentive, personal service a meaningful piece deserves.
        </p>
        <ul className="pillars">
          <li>
            <h3>Considered selection</h3>
            <p>Distinctive pieces chosen for design, craft and character, rather than volume.</p>
          </li>
          <li>
            <h3>Personal service</h3>
            <p>Speak with a person. We reply on WhatsApp, by phone or by email.</p>
          </li>
          <li>
            <h3>Simple to ask</h3>
            <p>Enquire about a piece, request one you don’t see, or arrange a private viewing in Dubai.</p>
          </li>
        </ul>
      </section>

      {/* 3 · Category discovery */}
      <section className="container section" aria-labelledby="cat-title">
        <div className="section__head" data-reveal>
          <div>
            <p className="eyebrow">Discover</p>
            <h2 id="cat-title" className="h2">
              Begin with a category.
            </h2>
          </div>
        </div>
        <ul className="doors">
          {categoryDoors.map((c, i) => (
            <li key={c.id} data-reveal style={{ transitionDelay: `${i * 80}ms` }}>
              <Link href={`/collection?category=${c.id}`} className="door">
                <div className="door__media">
                  <Image src={c.image.src} alt={c.image.alt} width={c.image.width} height={c.image.height} sizes="(min-width: 800px) 33vw, 100vw" className="door__img" />
                </div>
                <div className="door__text">
                  <h3>{c.label}</h3>
                  <p>{c.note}</p>
                  <span className="door__cta">
                    Explore {c.label.toLowerCase()} <ArrowIcon size={14} />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <p className="doors__more" data-reveal>
          Looking for jewellery, accessories or something else entirely?{" "}
          <PanelButton panel={{ type: "sourcing" }} className="link-btn">
            Request a piece
          </PanelButton>
        </p>
      </section>

      {/* 4 · Curated selection */}
      <section className="container section section--rule" aria-labelledby="edit-title">
        <div className="section__head" data-reveal>
          <div>
            <p className="eyebrow">The edit</p>
            <h2 id="edit-title" className="h2">
              Find your next favourite.
            </h2>
          </div>
          {previewsOnly && <span className="tag tag--line">Editorial preview</span>}
        </div>
        <div className="grid grid--4" data-reveal>
          {featured.map((item) => (
            <ItemCard key={item.ref} item={item} sizes="(min-width: 1100px) 25vw, 50vw" />
          ))}
        </div>
        <div className="section__foot" data-reveal>
          {previewsOnly && <p className="muted small">AI-generated editorial images — not items for sale. Listings with real photographs, condition and prices will appear in the Collection.</p>}
          <Link href="/collection" className="text-link">
            View the Collection <ArrowIcon size={14} />
          </Link>
        </div>
      </section>

      {/* 5 · Private sourcing */}
      <section id="sourcing" className="band band--dark" aria-labelledby="sourcing-title">
        <div className="container band__grid">
          <div className="band__copy" data-reveal>
            <p className="eyebrow eyebrow--champagne">Private sourcing</p>
            <h2 id="sourcing-title" className="h2">
              Something on your mind?
            </h2>
            <p>
              Tell us the piece you’re looking for — designer, model or reference, colour, size and an approximate budget. We’ll prepare a WhatsApp message for you to send, and a
              member of our team will reply personally.
            </p>
            <p className="band__houses">
              From {site.sourcingBrands.slice(0, 2).join(" and ")} to {site.sourcingBrands.slice(2, -1).join(", ")} and {site.sourcingBrands.at(-1)} — tell us what you have in
              mind.
            </p>
            <p className="band__fine">We are independent and not affiliated with any brand named on this site.</p>
          </div>
          <div className="band__form" data-reveal>
            <SourcingForm tone="dark" />
          </div>
        </div>
      </section>

      {/* 6 · Private viewing */}
      <section id="visit" className="container section visit" aria-labelledby="visit-title">
        <div className="visit__copy" data-reveal>
          <p className="eyebrow">{site.location.display}</p>
          <h2 id="visit-title" className="h2">
            Arrange a private viewing.
          </h2>
          <p>
            See a piece in person, or sit down with us to talk through what you’re looking for. Share a preferred date and time, and our team will reply to arrange it. Requests
            are confirmed personally — nothing is booked until we confirm with you.
          </p>
          <ContactList />
        </div>
        <div className="visit__form" data-reveal>
          <ViewingForm />
        </div>
      </section>
    </>
  );
}
