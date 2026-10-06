"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { site } from "@/config/site";
import { categories } from "@/data/taxonomy";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { Wordmark } from "./Wordmark";
import { useSite } from "./SiteProvider";
import { BagIcon, MenuIcon, SearchIcon, WhatsAppIcon } from "./icons";


const noopSubscribe = () => () => {};

export function Header() {
  const pathname = usePathname();
  const { openPanel, cart } = useSite();
  // False while hydrating: the prerendered HTML must not depend on the path, or hydration fails.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // The same element on server and client. On Home the link scrolls to its section;
  // elsewhere the click opens the matching panel instead.
  const service = (anchor: "sourcing" | "visit", label: string) => (
    <a
      href={`/#${anchor}`}
      onClick={(e) => {
        if (window.location.pathname === "/") return;
        e.preventDefault();
        openPanel({ type: anchor === "visit" ? "viewing" : "sourcing" });
      }}
    >
      {label}
    </a>
  );

  return (
    <>
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <span>{site.location.display} · Private sourcing &amp; viewings</span>
          <a href={site.contact.telHref} className="utility-bar__phone">
            {site.contact.phoneDisplay}
          </a>
        </div>
      </div>
      <header className="site-header">
        <div className="container site-header__inner">
          <div className="site-header__left">
            <button type="button" className="icon-btn site-header__menu" onClick={() => openPanel({ type: "menu" })} aria-label="Open menu">
              <MenuIcon />
            </button>
            <nav aria-label="Main" className="site-nav">
              <Link href="/collection" aria-current={hydrated && pathname === "/collection" ? "page" : undefined}>
                Collection
              </Link>
              {service("sourcing", "Private Sourcing")}
              {service("visit", "Private Viewing")}
            </nav>
          </div>
          <Link href="/" className="site-header__logo" aria-label="SEVN HEVN — home">
            <Wordmark title={null} />
          </Link>
          <div className="site-header__right">
            <a
              className="icon-btn site-header__wa"
              href={whatsappUrl(generalMessage())}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Chat with SEVN HEVN on WhatsApp"
              onClick={() => track("whatsapp_click", { source: "header" })}
            >
              <WhatsAppIcon size={19} />
            </a>
            <button type="button" className="icon-btn" onClick={() => openPanel({ type: "search" })} aria-label="Search the collection">
              <SearchIcon />
            </button>
            <button
              type="button"
              className="icon-btn bag-btn"
              onClick={() => openPanel({ type: "cart" })}
              aria-label={cart.ready && cart.count > 0 ? `Bag, ${cart.count} ${cart.count === 1 ? "item" : "items"}` : "Bag"}
            >
              <BagIcon />
              {cart.ready && cart.count > 0 && (
                <span className="bag-btn__count" aria-hidden="true">
                  {cart.count}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>
      {/* Category index from the brand concept. Always rendered so the markup never depends on the path;
          CSS hides it on the Collection page, which has its own tabs. */}
      <nav aria-label="Categories" className="cat-row">
        <ul className="container cat-row__inner">
          <li>
            <Link href="/collection">All pieces</Link>
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={`/collection?category=${c.id}`}>{c.label}</Link>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => openPanel({ type: "sourcing" })}>
              Request a piece
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
