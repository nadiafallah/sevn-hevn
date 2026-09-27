import Image from "next/image";
import Link from "next/link";
import { site } from "@/config/site";
import { categoryById, type CategoryId } from "@/data/taxonomy";
import { getFeatured } from "@/lib/catalog";
import { ItemCard } from "@/components/ItemCard";
import { PanelButton } from "@/components/PanelButton";
import { SourcingForm } from "@/components/SourcingForm";
import { ViewingForm } from "@/components/ViewingForm";
import { ContactList } from "@/components/SitePanels";
import { ArrowIcon } from "@/components/icons";

const categoryDoors = [
  { id: "bags", label: "Bags", note: "Handbags, crossbody bags, clutches, wallets and travel", image: { src: "/images/editorial/bag-cognac.jpg", width: 1122, height: 1028, alt: "Cognac leather top-handle bag on a travertine plinth" } },
  { id: "watches", label: "Vintage watches", note: "By brand, reference, year, movement and condition", image: { src: "/images/editorial/watch-gold-rectangular.jpg", width: 1122, height: 1402, alt: "Rectangular gold-tone watch on a dark leather strap" } },
  { id: "shoes", label: "Shoes", note: "Loafers, mules, sandals, sneakers, boots and pumps", image: { src: "/images/editorial/loafer-cobalt-suede.jpg", width: 1122, height: 1402, alt: "Cobalt suede loafers with gold-tone detail" } },
];

const moreCategories: CategoryId[] = ["clothing", "eyewear", "accessories", "jewellery", "lifestyle"];

export default async function HomePage() {
  const featured = await getFeatured(3);
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
          <p className="eyebrow hero__eyebrow">Bags. Vintage watches. Shoes.</p>
          <h1 id="hero-title" className="display hero__title">
            <span>Welcome to</span> <span>your happy</span> <span>place.</span>
          </h1>
          <p className="hero__lead">Find the piece that feels right for you.</p>
          <div className="hero__actions">
            <Link href="/collection" className="btn btn--dark">
              Discover the edit
            </Link>
            <PanelButton panel={{ type: "sourcing" }} className="text-link hero__secondary">
              Personal shopping
            </PanelButton>
          </div>
        </div>
      </section>

      {/* 2 · Maison introduction */}
      <section className="intro container" aria-labelledby="intro-title">
        <div data-reveal>
          <p className="eyebrow">Welcome to SEVN HEVN</p>
          <h2 id="intro-title" className="h2 intro__title">
            A feeling of complete happiness.
          </h2>
          <p className="intro__text">
            SEVN HEVN is the pleasure of finding something exceptional. Discover bags, vintage watches and shoes chosen for their character, their beauty and the way they make
            you feel — with the attentive, personal service a meaningful piece deserves.
          </p>
        </div>
        <ol className="pillars">
          {[
            ["Considered selection", "Distinctive pieces chosen for design, craft and character, rather than volume."],
            ["Personal service", "Speak with a person. We reply on WhatsApp, by phone or by email."],
            ["Private viewings", "See a piece in person in Dubai, by appointment, before you decide."],
          ].map(([title, text], i) => (
            <li key={title} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="pillars__num" aria-hidden="true">
                0{i + 1}
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 3 · Category doors */}
      <section className="container section doors-section" aria-labelledby="cat-title">
        <h2 id="cat-title" className="visually-hidden">
          Shop by category
        </h2>
        <ul className="doors">
          {categoryDoors.map((c, i) => (
            <li key={c.id} data-reveal style={{ transitionDelay: `${i * 110}ms` }}>
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
        <p className="doors__note">Category images are AI-generated editorial imagery.</p>
      </section>

      {/* 4 · Latest arrivals / editorial edit */}
      <section id="edit" className="container section section--rule" aria-labelledby="edit-title">
        <div className="section__head" data-reveal>
          <div>
            <p className="eyebrow">Latest arrivals</p>
            <h2 id="edit-title" className="h2">
              Find your next favourite.
            </h2>
          </div>
          {previewsOnly && <span className="tag tag--line">Editorial preview</span>}
        </div>
        <div className="grid grid--3">
          {featured.map((item, i) => (
            <div key={item.ref} data-reveal style={{ transitionDelay: `${i * 110}ms` }}>
              <ItemCard item={item} sizes="(min-width: 900px) 33vw, 100vw" />
            </div>
          ))}
        </div>
        <div className="section__foot" data-reveal>
          {previewsOnly && <p className="muted small">Editorial images only — AI-generated, not items for sale. Product details, prices and availability will accompany actual listings.</p>}
          <Link href="/collection" className="text-link">
            View the Collection <ArrowIcon size={14} />
          </Link>
        </div>
      </section>

      {/* 5 · Personal shopping / private sourcing */}
      <section id="sourcing" className="band band--dark" aria-labelledby="sourcing-title">
        <div className="container band__grid">
          <div className="band__copy" data-reveal>
            <p className="eyebrow eyebrow--champagne">Personal shopping</p>
            <h2 id="sourcing-title" className="h2 band__title">
              Something on your mind?
            </h2>
            <p>Tell us the piece, colour, size and budget you have in mind, and start a conversation with SEVN HEVN. We’ll prepare a WhatsApp message for you to send, and a member of our team will reply personally.</p>
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

      {/* 6 · Discover more */}
      <section className="container discover" aria-labelledby="discover-title" data-reveal>
        <p id="discover-title" className="eyebrow">
          Discover more
        </p>
        <ul className="discover__list">
          {moreCategories.map((id) => (
            <li key={id}>
              <Link href={`/collection?category=${id}`}>{categoryById[id].label}</Link>
            </li>
          ))}
        </ul>
      </section>

      {/* 7 · Private viewing */}
      <section id="visit" className="visit-wrap" aria-labelledby="visit-title">
        <div className="container section visit">
          <div className="visit__copy" data-reveal>
            <p className="eyebrow">{site.location.display}</p>
            <h2 id="visit-title" className="h2">
              Arrange a private viewing.
            </h2>
            <p>
              See a piece in person, or sit down with us to talk through what you’re looking for. Share a preferred date and time, and our team will reply to arrange it.
              Requests are confirmed personally — nothing is booked until we confirm with you.
            </p>
            <ContactList />
          </div>
          <div className="visit__form" data-reveal>
            <ViewingForm />
          </div>
        </div>
      </section>
    </>
  );
}
