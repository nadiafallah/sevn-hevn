"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { site } from "@/config/site";
import { categories } from "@/data/taxonomy";
import { splitLocale } from "@/i18n/config";
import { useI18n } from "@/i18n/I18nProvider";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { Wordmark } from "./Wordmark";
import { useSite } from "./SiteProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { BagIcon, MenuIcon, SearchIcon, WhatsAppIcon } from "./icons";

const noopSubscribe = () => () => {};

export function Header() {
  const pathname = usePathname();
  const { openPanel, cart } = useSite();
  const { t, href, plural } = useI18n();
  // False while hydrating: the prerendered HTML must not depend on the path, or hydration fails.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const home = href("/");

  // The same element on server and client. On Home the link scrolls to its section;
  // elsewhere the click opens the matching panel instead.
  const service = (anchor: "sourcing" | "visit", label: string) => (
    <a
      href={`${home}#${anchor}`}
      onClick={(e) => {
        if (window.location.pathname === home) return;
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
          <span className="utility-bar__text">
            {t.location}
            <span className="utility-bar__service"> · {t.utility}</span>
          </span>
          <div className="utility-bar__end">
            <a href={site.contact.telHref} className="utility-bar__phone" dir="ltr">
              {site.contact.phoneDisplay}
            </a>
            <LanguageSwitcher variant="bar" />
          </div>
        </div>
      </div>
      <header className="site-header">
        <div className="container site-header__inner">
          <div className="site-header__left">
            <button type="button" className="icon-btn site-header__menu" onClick={() => openPanel({ type: "menu" })} aria-label={t.nav.menu}>
              <MenuIcon />
            </button>
            <nav aria-label={t.nav.main} className="site-nav">
              <Link href={href("/collection")} aria-current={hydrated && splitLocale(pathname).path === "/collection" ? "page" : undefined}>
                {t.nav.collection}
              </Link>
              {service("sourcing", t.nav.sourcing)}
              {service("visit", t.nav.viewing)}
            </nav>
          </div>
          <Link href={home} className="site-header__logo" aria-label={t.nav.home}>
            <Wordmark title={null} />
          </Link>
          <div className="site-header__right">
            <a
              className="icon-btn site-header__wa"
              href={whatsappUrl(generalMessage(t.messages))}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t.nav.whatsapp}
              onClick={() => track("whatsapp_click", { source: "header" })}
            >
              <WhatsAppIcon size={19} />
            </a>
            <button type="button" className="icon-btn" onClick={() => openPanel({ type: "search" })} aria-label={t.nav.search}>
              <SearchIcon />
            </button>
            <button
              type="button"
              className="icon-btn bag-btn"
              onClick={() => openPanel({ type: "cart" })}
              aria-label={cart.ready && cart.count > 0 ? plural(cart.count, t.nav.bagCount) : t.nav.bag}
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
      <nav aria-label={t.nav.categories} className="cat-row">
        <ul className="container cat-row__inner">
          <li>
            <Link href={href("/collection")}>{t.nav.allPieces}</Link>
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={href(`/collection?category=${c.id}`)}>{t.categories[c.id]}</Link>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => openPanel({ type: "sourcing" })}>
              {t.nav.requestPiece}
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
