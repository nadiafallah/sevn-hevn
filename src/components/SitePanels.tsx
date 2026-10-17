"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { site } from "@/config/site";
import { policyFinal } from "@/content/policies";
import { categories, type CategoryId } from "@/data/taxonomy";
import { useI18n } from "@/i18n/I18nProvider";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { priceLabel } from "@/lib/format";
import { categoryPath, productPath } from "@/lib/paths";
import { matchesQuery, sortItems } from "@/lib/shop";
import { Dialog } from "./Dialog";
import { Wordmark } from "./Wordmark";
import { CartPanel } from "./CartPanel";
import { SourcingForm } from "./SourcingForm";
import { ViewingForm } from "./ViewingForm";
import { useSite, type Panel } from "./SiteProvider";
import { categoryMenu } from "./menuData";
import { ArrowIcon, InstagramIcon, MailIcon, PhoneIcon, PlusIcon, SearchIcon, WhatsAppIcon } from "./icons";

export function ContactList() {
  const { t } = useI18n();
  return (
    <ul className="contact-list">
      <li>
        <a href={whatsappUrl(generalMessage(t.messages))} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "contact" })}>
          <WhatsAppIcon size={18} />
          <span>
            <span className="contact-list__label">{t.contact.whatsapp}</span>
            <bdi dir="ltr">{site.contact.phoneDisplay}</bdi>
          </span>
        </a>
      </li>
      <li>
        <a href={site.contact.telHref} onClick={() => track("call_click", { source: "contact" })}>
          <PhoneIcon />
          <span>
            <span className="contact-list__label">{t.contact.call}</span>
            <bdi dir="ltr">{site.contact.phoneDisplay}</bdi>
          </span>
        </a>
      </li>
      <li>
        <a href={site.contact.emailHref} onClick={() => track("email_click", { source: "contact" })}>
          <MailIcon />
          <span>
            <span className="contact-list__label">{t.contact.email}</span>
            <bdi dir="ltr">{site.contact.email}</bdi>
          </span>
        </a>
      </li>
      <li>
        <a href={site.social.instagram.url} target="_blank" rel="noopener noreferrer">
          <InstagramIcon />
          <span>
            <span className="contact-list__label">{t.contact.instagram}</span>
            <bdi dir="ltr">{site.social.instagram.handle}</bdi>
          </span>
        </a>
      </li>
    </ul>
  );
}

function SearchPanel() {
  const router = useRouter();
  const { closePanel, items } = useSite();
  const { t, href, plural, fmt } = useI18n();
  const s = t.shop;
  const [q, setQ] = useState("");
  const id = useId();
  const query = q.trim();
  // Live results by house, model, product or version code (accents and case ignored).
  const results = useMemo(
    () => (query.length < 2 ? [] : sortItems(items.filter((i) => matchesQuery(i, query, [t.categories[i.category], i.subcategory ? (s.types[i.subcategory] ?? "") : ""])), "newest")),
    [items, query, t.categories, s.types],
  );
  const all = href(query ? `/collection?q=${encodeURIComponent(query)}` : "/collection");
  function submit(e: FormEvent) {
    e.preventDefault();
    track("search", { length: query.length });
    closePanel();
    router.push(all);
  }
  return (
    <div className="search">
      <form role="search" onSubmit={submit} className="search-form">
        <label htmlFor={id} className="visually-hidden">
          {t.panels.searchLabel}
        </label>
        <SearchIcon size={22} />
        <input
          id={id}
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={s.search.placeholder}
          maxLength={80}
          enterKeyHint="search"
          dir="auto"
          aria-describedby={`${id}-status`}
          autoComplete="off"
        />
        <button type="submit" className="btn btn--dark">
          {t.panels.searchButton}
        </button>
      </form>
      <p id={`${id}-status`} className="search__status muted small" aria-live="polite">
        {query.length < 2 ? s.search.hint : results.length ? plural(results.length, s.listing.count) : fmt(s.search.none, { q: query })}
      </p>
      {results.length > 0 && (
        <>
          <ul className="search__results" aria-label={s.search.results}>
            {results.slice(0, 6).map((i) => (
              <li key={i.ref}>
                <Link href={href(productPath(i.ref))} className="search-hit" onClick={closePanel}>
                  <span className="search-hit__media">
                    {i.images[0] && <Image src={i.images[0].src} alt="" width={i.images[0].width} height={i.images[0].height} sizes="64px" />}
                  </span>
                  <span className="search-hit__text">
                    <span className="search-hit__brand" lang="en" dir="ltr">
                      {i.brand}
                    </span>
                    <span className="search-hit__name">{i.name}</span>
                    <span className="search-hit__meta muted small">
                      {t.categories[i.category]} · <bdi dir="ltr">{i.ref}</bdi>
                    </span>
                  </span>
                  <span className="search-hit__price">{priceLabel(i, t.price)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href={all} className="text-link" onClick={closePanel}>
            {plural(results.length, s.search.seeAll)} <ArrowIcon size={14} />
          </Link>
        </>
      )}
      {query.length >= 2 && results.length === 0 && (
        <div className="search__none">
          <p className="muted">{s.search.noneHelp}</p>
          <PanelLink panel={{ type: "sourcing", prefill: { details: query } }}>{s.listing.request}</PanelLink>
        </div>
      )}
    </div>
  );
}

function PanelLink({ panel, children }: { panel: Panel; children: ReactNode }) {
  const { openPanel } = useSite();
  return (
    <button type="button" className="btn btn--line" onClick={() => openPanel(panel)}>
      {children}
    </button>
  );
}

/** Phone and tablet menu: each category opens in place with its houses, types and newest pieces. */
function MenuPanel() {
  const { closePanel, openPanel, items, journal } = useSite();
  const { t, href, fmt } = useI18n();
  const s = t.shop;
  const [open, setOpen] = useState<CategoryId | null>(null);
  const uid = useId();
  return (
    <nav aria-label={t.nav.main} className="menu-panel">
      <Link href={href("/")} className="menu-panel__logo" aria-label={t.nav.home} onClick={closePanel}>
        <Wordmark title={null} />
      </Link>
      <ul className="menu-acc">
        {categories.map((c) => {
          const m = categoryMenu(items, c.id);
          const expanded = open === c.id;
          const panelId = `${uid}-${c.id}`;
          return (
            <li key={c.id} className="menu-acc__item">
              <button type="button" className="menu-acc__trigger" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen(expanded ? null : c.id)}>
                {t.categories[c.id]}
                <PlusIcon size={16} />
              </button>
              <div id={panelId} className="menu-acc__panel" hidden={!expanded}>
                {m.count > 0 ? (
                  <Link href={href(categoryPath(c.id))} className="menu-acc__all" onClick={closePanel}>
                    {fmt(s.menu.shopAll, { category: t.categories[c.id] })} <ArrowIcon size={14} />
                  </Link>
                ) : (
                  <p className="muted small">
                    {s.listing.emptyCategory[c.id]} {s.listing.emptyRequest}
                  </p>
                )}
                {m.brands.length > 0 && (
                  <>
                    <p className="menu-acc__title">{s.menu.houses}</p>
                    <ul className="menu-acc__links">
                      {m.brands.map((b) => (
                        <li key={b.id}>
                          <Link href={href(categoryPath(c.id, b.id))} onClick={closePanel} lang="en" dir="ltr">
                            {b.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {m.types.length > 0 && (
                  <>
                    <p className="menu-acc__title">{s.menu.types}</p>
                    <ul className="menu-acc__links">
                      {m.types.map((ty) => (
                        <li key={ty.id}>
                          <Link href={href(`${categoryPath(c.id)}?type=${ty.id}`)} onClick={closePanel}>
                            {s.types[ty.id] ?? ty.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {m.picks.length > 0 && (
                  <ul className="menu-acc__picks" aria-label={s.menu.newIn}>
                    {m.picks.map((p) => (
                      <li key={p.ref}>
                        <Link href={href(productPath(p.ref))} className="mega-pick" onClick={closePanel}>
                          <span className="mega-pick__media">
                            {p.image && <Image src={p.image.src} alt={p.image.alt} width={p.image.width} height={p.image.height} sizes="40vw" className="mega-pick__img" />}
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
                <button type="button" className="text-link" onClick={() => openPanel({ type: "sourcing", prefill: { category: c.id } })}>
                  {s.menu.request} <ArrowIcon size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <ul className="menu-panel__primary">
        <li>
          <Link href={href("/collection")} onClick={closePanel}>
            {s.allPieces}
          </Link>
        </li>
        {journal && (
          <li>
            <Link href={href("/journal")} onClick={closePanel}>
              {t.nav.journal}
            </Link>
          </li>
        )}
        <li>
          <button type="button" onClick={() => openPanel({ type: "sourcing" })}>
            {t.panels.menuSourcing}
          </button>
        </li>
        <li>
          <button type="button" onClick={() => openPanel({ type: "viewing" })}>
            {t.panels.menuViewing}
          </button>
        </li>
        <li>
          <button type="button" onClick={() => openPanel({ type: "contact" })}>
            {t.panels.menuContact}
          </button>
        </li>
      </ul>
      <p className="muted small menu-panel__loc">{t.location}</p>
    </nav>
  );
}

export function SitePanels() {
  const { panel, closePanel, openPanel } = useSite();
  const { t } = useI18n();
  const p = t.panels;
  const is = (type: string) => panel?.type === type;
  const policy = panel?.type === "policy" ? t.policies[panel.id] : null;

  return (
    <>
      <Dialog open={is("cart")} onClose={closePanel} title={p.bag}>
        <CartPanel />
      </Dialog>

      <Dialog open={is("sourcing")} onClose={closePanel} title={p.sourcingTitle} eyebrow={p.sourcingEyebrow}>
        <p className="dlg__intro">{p.sourcingIntro}</p>
        <SourcingForm
          key={JSON.stringify(panel?.type === "sourcing" ? panel.prefill : null)}
          prefill={panel?.type === "sourcing" ? panel.prefill : undefined}
        />
      </Dialog>

      <Dialog open={is("viewing")} onClose={closePanel} title={p.viewingTitle} eyebrow={t.location}>
        <p className="dlg__intro">{p.viewingIntro}</p>
        <ViewingForm key={JSON.stringify(panel?.type === "viewing" ? panel.prefill : null)} prefill={panel?.type === "viewing" ? panel.prefill : undefined} />
      </Dialog>

      <Dialog open={is("contact")} onClose={closePanel} title={p.contactTitle} eyebrow={t.location}>
        <p className="dlg__intro">{p.contactIntro}</p>
        <ContactList />
        <button type="button" className="btn btn--line btn--block" onClick={() => openPanel({ type: "viewing" })}>
          {p.viewingTitle}
        </button>
      </Dialog>

      <Dialog open={is("search")} onClose={closePanel} title={p.search} variant="center" hideTitle>
        <SearchPanel />
      </Dialog>

      <Dialog open={is("menu")} onClose={closePanel} title={p.menu} variant="drawer-left" hideTitle>
        <MenuPanel />
      </Dialog>

      <Dialog open={is("policy")} onClose={closePanel} title={policy?.title ?? p.information} variant="wide">
        {panel?.type === "policy" && policy && (
          <div className="policy">
            {!policyFinal[panel.id] && <p className="tag tag--line">{p.interim}</p>}
            {policy.body.map((para) => (
              <p key={para}>{para}</p>
            ))}
            <p className="muted small">
              {p.questions} <a href={site.contact.emailHref} dir="ltr">{site.contact.email}</a> · <a href={site.contact.telHref} dir="ltr">{site.contact.phoneDisplay}</a>
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
