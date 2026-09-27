"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { site } from "@/config/site";
import { categoryById, type CategoryId } from "@/data/taxonomy";
import { Wordmark } from "./Wordmark";
import { useSite } from "./SiteProvider";
import { BagIcon, MenuIcon, SearchIcon } from "./icons";

// Order and wording of the category row follow the homepage concept.
const navCategories: CategoryId[] = ["bags", "watches", "shoes", "clothing", "eyewear", "accessories", "jewellery", "lifestyle"];

export function Header() {
  const pathname = usePathname();
  const { openPanel, cart } = useSite();
  const onHome = pathname === "/";
  const [condensed, setCondensed] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // The wordmark sits large at the top of the page and settles to a compact size once the visitor
  // scrolls. The gap between the two thresholds stops it flickering around a single scroll position.
  useEffect(() => {
    const update = () => setCondensed((was) => (was ? window.scrollY > 8 : window.scrollY > 80));
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  // Sticky elements below the header (the Collection filter bar, anchor offsets) follow its real height.
  useEffect(() => {
    const el = headerRef.current;
    if (!el || !("ResizeObserver" in window)) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${Math.round(el.offsetHeight)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // On Home the service links scroll to their sections; elsewhere they open the panel.
  const service = (anchor: "sourcing" | "visit", label: string) =>
    onHome ? (
      <a href={`#${anchor}`}>{label}</a>
    ) : (
      <button type="button" onClick={() => openPanel({ type: anchor === "visit" ? "viewing" : "sourcing" })}>
        {label}
      </button>
    );

  return (
    <>
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <span>{site.location.locality} / Collection preview</span>
          <nav aria-label="Services" className="utility-bar__links">
            {service("sourcing", "Personal shopper")}
            {service("visit", "Private viewing")}
            <button type="button" onClick={() => openPanel({ type: "contact" })}>
              Contact
            </button>
            <a href={site.contact.telHref}>{site.contact.phoneDisplay}</a>
          </nav>
        </div>
      </div>
      <header ref={headerRef} className={`site-header${condensed ? " is-condensed" : ""}`}>
        <div className="container site-header__inner">
          <div className="site-header__left">
            <button type="button" className="menu-btn" onClick={() => openPanel({ type: "menu" })} aria-label="Open menu">
              <MenuIcon />
              <span className="menu-btn__label" aria-hidden="true">
                Menu
              </span>
            </button>
          </div>
          <Link href="/" className="site-header__logo" aria-label="SEVN HEVN — home">
            <Wordmark title={null} />
          </Link>
          <div className="site-header__right">
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
        <nav aria-label="Categories" className="cat-nav">
          <ul className="container cat-nav__list">
            <li>
              <Link href="/collection" aria-current={pathname === "/collection" ? "page" : undefined}>
                The Collection
              </Link>
            </li>
            {navCategories.map((id) => categoryById[id]).map((c) => (
              <li key={c.id} className={c.launch ? "cat-nav__priority" : undefined}>
                <Link href={`/collection?category=${c.id}`}>{c.id === "watches" ? "Vintage watches" : c.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
    </>
  );
}
