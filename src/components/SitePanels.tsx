"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { site } from "@/config/site";
import { policyFinal } from "@/content/policies";
import { categories } from "@/data/taxonomy";
import { useI18n } from "@/i18n/I18nProvider";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { Dialog } from "./Dialog";
import { Wordmark } from "./Wordmark";
import { CartPanel } from "./CartPanel";
import { SourcingForm } from "./SourcingForm";
import { ViewingForm } from "./ViewingForm";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useSite } from "./SiteProvider";
import { InstagramIcon, MailIcon, PhoneIcon, SearchIcon, WhatsAppIcon } from "./icons";

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
  const { closePanel } = useSite();
  const { t, href } = useI18n();
  const [q, setQ] = useState("");
  const id = useId();
  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    track("search", { length: query.length });
    closePanel();
    router.push(href(query ? `/collection?q=${encodeURIComponent(query)}` : "/collection"));
  }
  return (
    <form role="search" onSubmit={submit} className="search-form">
      <label htmlFor={id} className="visually-hidden">
        {t.panels.searchLabel}
      </label>
      <SearchIcon size={22} />
      <input id={id} type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.panels.searchPlaceholder} maxLength={80} enterKeyHint="search" dir="auto" />
      <button type="submit" className="btn btn--dark">
        {t.panels.searchButton}
      </button>
    </form>
  );
}

function MenuPanel() {
  const { closePanel, openPanel } = useSite();
  const { t, href } = useI18n();
  return (
    <nav aria-label={t.nav.main} className="menu-panel">
      <Link href={href("/")} className="menu-panel__logo" aria-label={t.nav.home} onClick={closePanel}>
        <Wordmark title={null} />
      </Link>
      <ul className="menu-panel__primary">
        <li>
          <Link href={href("/collection")} onClick={closePanel}>
            {t.panels.menuCollection}
          </Link>
        </li>
        {categories.map((c) => (
          <li key={c.id} className="menu-panel__sub">
            <Link href={href(`/collection?category=${c.id}`)} onClick={closePanel}>
              {t.categories[c.id]}
            </Link>
          </li>
        ))}
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
      <LanguageSwitcher variant="menu" />
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
          carryKey="sourcing:panel"
        />
      </Dialog>

      <Dialog open={is("viewing")} onClose={closePanel} title={p.viewingTitle} eyebrow={t.location}>
        <p className="dlg__intro">{p.viewingIntro}</p>
        <ViewingForm key={JSON.stringify(panel?.type === "viewing" ? panel.prefill : null)} prefill={panel?.type === "viewing" ? panel.prefill : undefined} carryKey="viewing:panel" />
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
