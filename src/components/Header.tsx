"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { site } from "@/config/site";
import { Wordmark } from "./Wordmark";
import { useSite } from "./SiteProvider";
import { BagIcon, MenuIcon, SearchIcon } from "./icons";

export function Header() {
  const pathname = usePathname();
  const { openPanel, cart } = useSite();
  const onHome = pathname === "/";

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
          <span>{site.location.display} · Sourcing &amp; private viewings</span>
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
              <Link href="/collection" aria-current={pathname === "/collection" ? "page" : undefined}>
                Collection
              </Link>
              {service("sourcing", "Private Sourcing")}
              {service("visit", "Visit Us")}
            </nav>
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
      </header>
    </>
  );
}
