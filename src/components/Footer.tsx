"use client";

import Link from "next/link";
import { site } from "@/config/site";
import { policyIds } from "@/content/policies";
import { useI18n } from "@/i18n/I18nProvider";
import { rich } from "@/i18n/rich";
import { track } from "@/lib/analytics";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { Wordmark } from "./Wordmark";
import { useSite } from "./SiteProvider";

export function Footer({ chat = false }: { chat?: boolean }) {
  const { openPanel } = useSite();
  const { t, href, fmt } = useI18n();
  const f = t.footer;
  const year = new Date().getFullYear();
  const wa = whatsappUrl(generalMessage(t.messages));

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <p className="site-footer__tagline">{rich(f.tagline)}</p>
            <p className="site-footer__note">{fmt(f.note, { location: t.location })}</p>
            <a className="btn btn--light site-footer__wa" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "footer-cta" })}>
              {f.whatsapp}
            </a>
          </div>

          <div>
            <h2 className="footer-heading">{f.contact}</h2>
            <ul className="footer-list">
              <li>
                <a href={wa} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "footer" })}>
                  {t.contact.whatsapp}
                </a>
              </li>
              <li>
                <a href={site.contact.telHref} dir="ltr" onClick={() => track("call_click", { source: "footer" })}>
                  {site.contact.phoneDisplay}
                </a>
              </li>
              <li>
                <a href={site.contact.emailHref} dir="ltr" onClick={() => track("email_click", { source: "footer" })}>
                  {site.contact.email}
                </a>
              </li>
              <li>
                <a href={site.social.instagram.url} target="_blank" rel="noopener noreferrer">
                  {t.contact.instagram} <bdi dir="ltr">{site.social.instagram.handle}</bdi>
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
            <h2 className="footer-heading">{f.services}</h2>
            <ul className="footer-list">
              <li>
                <Link href={href("/collection")}>{f.collection}</Link>
              </li>
              {chat && (
                <li>
                  <Link href={href("/chat")}>{f.chat}</Link>
                </li>
              )}
              <li>
                <button type="button" onClick={() => openPanel({ type: "sourcing" })}>
                  {f.sourcing}
                </button>
              </li>
              <li>
                <button type="button" onClick={() => openPanel({ type: "viewing" })}>
                  {f.viewing}
                </button>
              </li>
              <li>
                <button type="button" onClick={() => openPanel({ type: "contact" })}>
                  {f.contactLink}
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="footer-heading">{f.information}</h2>
            <ul className="footer-list">
              {policyIds.map((id) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      openPanel({ type: "policy", id });
                    }}
                  >
                    {t.policies[id].title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Link href={href("/")} aria-label={t.nav.home} className="site-footer__logo">
          <Wordmark title={null} />
        </Link>

        <div className="site-footer__legal">
          <p>
            <bdi dir="ltr">{site.legalName}</bdi> · {t.location}
            {site.licence && ` · ${fmt(f.licence, site.licence)}`}
          </p>
          <p>{f.reseller}</p>
          <p>
            {f.previews} © {year} {site.name}
          </p>
        </div>
      </div>
    </footer>
  );
}
