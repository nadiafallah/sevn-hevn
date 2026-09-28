"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { site } from "@/config/site";
import { policyById } from "@/content/policies";
import { categories } from "@/data/taxonomy";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { Dialog } from "./Dialog";
import { Wordmark } from "./Wordmark";
import { CartPanel } from "./CartPanel";
import { SourcingForm } from "./SourcingForm";
import { ViewingForm } from "./ViewingForm";
import { useSite } from "./SiteProvider";
import { InstagramIcon, MailIcon, PhoneIcon, SearchIcon, WhatsAppIcon } from "./icons";

export function ContactList() {
  return (
    <ul className="contact-list">
      <li>
        <a href={whatsappUrl(generalMessage())} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "contact" })}>
          <WhatsAppIcon size={18} />
          <span>
            <span className="contact-list__label">WhatsApp</span>
            {site.contact.phoneDisplay}
          </span>
        </a>
      </li>
      <li>
        <a href={site.contact.telHref} onClick={() => track("call_click", { source: "contact" })}>
          <PhoneIcon />
          <span>
            <span className="contact-list__label">Call</span>
            {site.contact.phoneDisplay}
          </span>
        </a>
      </li>
      <li>
        <a href={site.contact.emailHref} onClick={() => track("email_click", { source: "contact" })}>
          <MailIcon />
          <span>
            <span className="contact-list__label">Email</span>
            {site.contact.email}
          </span>
        </a>
      </li>
      <li>
        <a href={site.social.instagram.url} target="_blank" rel="noopener noreferrer">
          <InstagramIcon />
          <span>
            <span className="contact-list__label">Instagram</span>
            {site.social.instagram.handle}
          </span>
        </a>
      </li>
    </ul>
  );
}

function SearchPanel() {
  const router = useRouter();
  const { closePanel } = useSite();
  const [q, setQ] = useState("");
  const id = useId();
  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    track("search", { length: query.length });
    closePanel();
    router.push(query ? `/collection?q=${encodeURIComponent(query)}` : "/collection");
  }
  return (
    <form role="search" onSubmit={submit} className="search-form">
      <label htmlFor={id} className="visually-hidden">
        Search the collection
      </label>
      <SearchIcon size={22} />
      <input id={id} type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search designers, pieces, colours" maxLength={80} enterKeyHint="search" />
      <button type="submit" className="btn btn--dark">
        Search
      </button>
    </form>
  );
}

function MenuPanel() {
  const { closePanel, openPanel } = useSite();
  return (
    <nav aria-label="Main" className="menu-panel">
      <Link href="/" className="menu-panel__logo" aria-label="SEVN HEVN — home" onClick={closePanel}>
        <Wordmark title={null} />
      </Link>
      <ul className="menu-panel__primary">
        <li>
          <Link href="/collection" onClick={closePanel}>
            Collection
          </Link>
        </li>
        {categories.map((c) => (
          <li key={c.id} className="menu-panel__sub">
            <Link href={`/collection?category=${c.id}`} onClick={closePanel}>
              {c.label}
            </Link>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => openPanel({ type: "sourcing" })}>
            Private sourcing
          </button>
        </li>
        <li>
          <button type="button" onClick={() => openPanel({ type: "viewing" })}>
            Private viewing
          </button>
        </li>
        <li>
          <button type="button" onClick={() => openPanel({ type: "contact" })}>
            Contact
          </button>
        </li>
      </ul>
      <p className="muted small menu-panel__loc">{site.location.display}</p>
    </nav>
  );
}

export function SitePanels() {
  const { panel, closePanel, openPanel } = useSite();
  const is = (t: string) => panel?.type === t;

  return (
    <>
      <Dialog open={is("cart")} onClose={closePanel} title="Your bag">
        <CartPanel />
      </Dialog>

      <Dialog open={is("sourcing")} onClose={closePanel} title="Request a piece" eyebrow="Private sourcing">
        <p className="dlg__intro">Tell us what you have in mind. We’ll prepare a WhatsApp message for you to send to our team in Dubai.</p>
        <SourcingForm key={JSON.stringify(panel?.type === "sourcing" ? panel.prefill : null)} prefill={panel?.type === "sourcing" ? panel.prefill : undefined} />
      </Dialog>

      <Dialog open={is("viewing")} onClose={closePanel} title="Arrange a private viewing" eyebrow={site.location.display}>
        <p className="dlg__intro">Request a time to see a piece or talk through what you’re looking for. Our team will reply to arrange it.</p>
        <ViewingForm key={JSON.stringify(panel?.type === "viewing" ? panel.prefill : null)} prefill={panel?.type === "viewing" ? panel.prefill : undefined} />
      </Dialog>

      <Dialog open={is("contact")} onClose={closePanel} title="Contact" eyebrow={site.location.display}>
        <p className="dlg__intro">Speak with our team directly.</p>
        <ContactList />
        <button type="button" className="btn btn--line btn--block" onClick={() => openPanel({ type: "viewing" })}>
          Arrange a private viewing
        </button>
      </Dialog>

      <Dialog open={is("search")} onClose={closePanel} title="Search" variant="center" hideTitle>
        <SearchPanel />
      </Dialog>

      <Dialog open={is("menu")} onClose={closePanel} title="Menu" variant="drawer-left" hideTitle>
        <MenuPanel />
      </Dialog>

      <Dialog open={is("policy")} onClose={closePanel} title={panel?.type === "policy" ? policyById[panel.id].title : "Information"} variant="wide">
        {panel?.type === "policy" && (
          <div className="policy">
            {!policyById[panel.id].final && <p className="tag tag--line">Interim notice — final policy to follow</p>}
            {policyById[panel.id].body.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <p className="muted small">
              Questions? <a href={site.contact.emailHref}>{site.contact.email}</a> · <a href={site.contact.telHref}>{site.contact.phoneDisplay}</a>
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
