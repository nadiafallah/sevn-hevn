"use client";

import Link from "next/link";
import { site } from "@/config/site";
import { policies } from "@/content/policies";
import { track } from "@/lib/analytics";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { Wordmark } from "./Wordmark";
import { useSite } from "./SiteProvider";

export function Footer({ chat = false }: { chat?: boolean }) {
  const { openPanel } = useSite();
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <p className="site-footer__tagline">
              Welcome to your <em>happy place.</em>
            </p>
            <p className="site-footer__note">Independent resale in {site.location.display}. Exceptional pieces, personal service.</p>
            <a className="btn btn--light site-footer__wa" href={whatsappUrl(generalMessage())} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "footer-cta" })}>
              Chat on WhatsApp
            </a>
          </div>

          <div>
            <h2 className="footer-heading">Contact</h2>
            <ul className="footer-list">
              <li>
                <a href={whatsappUrl(generalMessage())} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "footer" })}>
                  WhatsApp
                </a>
              </li>
              <li>
                <a href={site.contact.telHref} onClick={() => track("call_click", { source: "footer" })}>
                  {site.contact.phoneDisplay}
                </a>
              </li>
              <li>
                <a href={site.contact.emailHref} onClick={() => track("email_click", { source: "footer" })}>
                  {site.contact.email}
                </a>
              </li>
              <li>
                <a href={site.social.instagram.url} target="_blank" rel="noopener noreferrer">
                  Instagram {site.social.instagram.handle}
                </a>
              </li>
              {site.social.facebook.url && (
                <li>
                  <a href={site.social.facebook.url} target="_blank" rel="noopener noreferrer">
                    Facebook
                  </a>
                </li>
              )}
            </ul>
          </div>

          <div>
            <h2 className="footer-heading">Client services</h2>
            <ul className="footer-list">
              <li>
                <Link href="/collection">Collection</Link>
              </li>
              {chat && (
                <li>
                  <Link href="/chat">Concierge chat</Link>
                </li>
              )}
              <li>
                <button type="button" onClick={() => openPanel({ type: "sourcing" })}>
                  Private sourcing
                </button>
              </li>
              <li>
                <button type="button" onClick={() => openPanel({ type: "viewing" })}>
                  Arrange a private viewing
                </button>
              </li>
              <li>
                <button type="button" onClick={() => openPanel({ type: "contact" })}>
                  Contact
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="footer-heading">Information</h2>
            <ul className="footer-list">
              {policies.map((p) => (
                <li key={p.id}>
                  <a
                    href={`#${p.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      openPanel({ type: "policy", id: p.id });
                    }}
                  >
                    {p.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Link href="/" aria-label="SEVN HEVN — home" className="site-footer__logo">
          <Wordmark title={null} />
        </Link>

        <div className="site-footer__legal">
          <p>
            {site.legalName} · {site.location.display}
            {site.licence && ` · ${site.licence.authority} licence ${site.licence.number}`}
          </p>
          <p>{site.resellerStatement}</p>
          <p>
            Images marked “Editorial preview” are AI-generated mood imagery, not items for sale. © {year} {site.name}
          </p>
        </div>
      </div>
    </footer>
  );
}
