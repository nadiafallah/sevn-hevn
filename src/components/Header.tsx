"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { site } from "@/config/site";
import { categories, type CategoryId } from "@/data/taxonomy";
import { useI18n } from "@/i18n/I18nProvider";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { categoryPath, productPath } from "@/lib/paths";
import { Wordmark } from "./Wordmark";
import { useSite } from "./SiteProvider";
import { categoryMenu, type CategoryMenu } from "./menuData";
import { ArrowIcon, BagIcon, ChevronIcon, MenuIcon, SearchIcon, WhatsAppIcon } from "./icons";

const HOVER_OPEN_MS = 140;
const HOVER_CLOSE_MS = 260;

/**
 * Site header: utility bar, wordmark with search / WhatsApp / bag, and the shop's four categories.
 *
 * On wide screens each category opens a panel with its houses, types and one or two real pieces.
 * The panel opens on click or keyboard (Enter / Space / ↓; Escape closes and returns focus) and,
 * for a mouse, also on hover — it never depends on hover alone. On narrower screens the categories
 * are plain links under the header and the menu drawer holds the same structure (SitePanels).
 */
export function Header() {
  const pathname = usePathname();
  const { openPanel, cart, items } = useSite();
  const { t, href, plural } = useI18n();
  const s = t.shop;
  const [open, setOpen] = useState<CategoryId | null>(null);
  const openedBy = useRef<"hover" | "click" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const menus = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, categoryMenu(items, c.id)])) as Record<CategoryId, CategoryMenu>, [items]);

  // Navigating closes the panel.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(null);
  }

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const close = useCallback((focusTrigger?: CategoryId) => {
    clearTimer();
    setOpen(null);
    openedBy.current = null;
    if (focusTrigger) navRef.current?.querySelector<HTMLButtonElement>(`[data-trigger="${focusTrigger}"]`)?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close(open);
    };
    const onPointer = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  useEffect(() => clearTimer, []);

  function toggle(id: CategoryId) {
    clearTimer();
    if (open === id && openedBy.current === "click") return close();
    openedBy.current = "click";
    setOpen(id);
  }

  function hover(id: CategoryId | null, pointerType: string) {
    if (pointerType !== "mouse") return;
    clearTimer();
    if (id) {
      timer.current = setTimeout(() => {
        if (openedBy.current !== "click" || open !== id) openedBy.current = "hover";
        setOpen(id);
      }, open ? 0 : HOVER_OPEN_MS);
    } else if (openedBy.current === "hover") {
      timer.current = setTimeout(() => close(), HOVER_CLOSE_MS);
    }
  }

  // ↓ on a category opens its panel and moves focus to the first link, once the panel is shown.
  const [focusInto, setFocusInto] = useState<CategoryId | null>(null);
  useEffect(() => {
    if (!focusInto || open !== focusInto) return;
    document.getElementById(`mega-${focusInto}`)?.querySelector<HTMLElement>("a, button")?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusInto(null);
  }, [open, focusInto]);

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>, id: CategoryId) {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    openedBy.current = "click";
    setOpen(id);
    setFocusInto(id);
  }

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
          </div>
        </div>
      </div>
      <header className="site-header" data-menu-open={open ? "" : undefined}>
        <div className="container site-header__inner">
          <div className="site-header__left">
            <button type="button" className="icon-btn site-header__menu" onClick={() => openPanel({ type: "menu" })} aria-label={t.nav.menu}>
              <MenuIcon />
            </button>
            <nav aria-label={s.menu.services} className="site-nav">
              <button type="button" onClick={() => openPanel({ type: "sourcing" })}>
                {t.nav.sourcing}
              </button>
              <button type="button" onClick={() => openPanel({ type: "viewing" })}>
                {t.nav.viewing}
              </button>
              <button type="button" onClick={() => openPanel({ type: "contact" })}>
                {t.panels.menuContact}
              </button>
            </nav>
          </div>
          <Link href={href("/")} className="site-header__logo" aria-label={t.nav.home}>
            <Wordmark title={null} />
          </Link>
          <div className="site-header__right">
            <button type="button" className="icon-btn" onClick={() => openPanel({ type: "search" })} aria-label={t.nav.search}>
              <SearchIcon />
            </button>
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

        {/* Wide screens: the four categories with their panels. */}
        <nav ref={navRef} aria-label={s.shop} className="shop-nav" onPointerLeave={(e) => hover(null, e.pointerType)}>
          <ul className="container shop-nav__list">
            {categories.map((c) => (
              <li key={c.id} className="shop-nav__item" onPointerEnter={(e) => hover(c.id, e.pointerType)}>
                <button
                  type="button"
                  className="shop-nav__trigger"
                  data-trigger={c.id}
                  aria-expanded={open === c.id}
                  aria-controls={`mega-${c.id}`}
                  onClick={() => toggle(c.id)}
                  onKeyDown={(e) => onTriggerKey(e, c.id)}
                >
                  {t.categories[c.id]}
                  <ChevronIcon size={12} />
                </button>
              </li>
            ))}
          </ul>
          {categories.map((c) => (
            <MegaPanel key={c.id} id={c.id} menu={menus[c.id]} open={open === c.id} onPointerEnter={(type) => hover(c.id, type)} />
          ))}
        </nav>
      </header>

      {/* Narrow screens: the same four categories as plain links (the drawer holds the details). */}
      <nav aria-label={s.shop} className="cat-quick">
        <ul className="container cat-quick__list">
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={href(c.path)}>{t.categories[c.id]}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function MegaPanel({ id, menu, open, onPointerEnter }: { id: CategoryId; menu: CategoryMenu; open: boolean; onPointerEnter: (pointerType: string) => void }) {
  const { openPanel } = useSite();
  const { t, href, fmt, plural } = useI18n();
  const s = t.shop;
  const label = t.categories[id];
  const request = (brand?: string) => openPanel({ type: "sourcing", prefill: { category: id, brand } });

  return (
    <div id={`mega-${id}`} className="mega" role="region" aria-label={label} hidden={!open} onPointerEnter={(e) => onPointerEnter(e.pointerType)}>
      <div className="container mega__inner">
        <div className="mega__cols">
          <div className="mega__col">
            <p className="mega__title">{menu.brands.length ? s.menu.houses : s.menu.requestFrom}</p>
            <ul className="mega__list">
              {menu.brands.length
                ? menu.brands.map((b) => (
                    <li key={b.id}>
                      <Link href={href(categoryPath(id, b.id))} lang="en" dir="ltr">
                        {b.label}
                      </Link>
                      <span className="mega__count" aria-label={plural(b.count, s.listing.count)}>
                        {b.count}
                      </span>
                    </li>
                  ))
                : menu.allowed.map((b) => (
                    <li key={b.id}>
                      <button type="button" onClick={() => request(b.name)} lang="en" dir="ltr">
                        {b.name}
                      </button>
                    </li>
                  ))}
            </ul>
          </div>

          {menu.types.length > 0 && (
            <div className="mega__col">
              <p className="mega__title">{s.menu.types}</p>
              <ul className="mega__list">
                {menu.types.map((ty) => (
                  <li key={ty.id}>
                    <Link href={href(`${categoryPath(id)}?type=${ty.id}`)}>{s.types[ty.id] ?? ty.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mega__col mega__col--actions">
            {menu.count > 0 ? (
              <Link href={href(categoryPath(id))} className="text-link">
                {fmt(s.menu.shopAll, { category: label })} <ArrowIcon size={14} />
              </Link>
            ) : (
              <p className="mega__note">
                {s.listing.emptyCategory[id]} {s.listing.emptyRequest}
              </p>
            )}
            <button type="button" className="text-link" onClick={() => request()}>
              {s.menu.request} <ArrowIcon size={14} />
            </button>
          </div>
        </div>

        {menu.picks.length > 0 && (
          <ul className="mega__picks" aria-label={s.menu.newIn}>
            {menu.picks.map((p) => (
              <li key={p.ref}>
                <Link href={href(productPath(p.ref))} className="mega-pick">
                  <span className="mega-pick__media">
                    {p.image && <Image src={p.image.src} alt={p.image.alt} width={p.image.width} height={p.image.height} sizes="180px" className="mega-pick__img" />}
                  </span>
                  <span className="mega-pick__brand" lang="en" dir="ltr">
                    {p.brand}
                  </span>
                  <span className="mega-pick__name">{p.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
