"use client";

import Link from "next/link";
import { site } from "@/config/site";
import { policyIds } from "@/content/policies";
import { useI18n } from "@/i18n/I18nProvider";
import { track } from "@/lib/analytics";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { NewsletterForm } from "./NewsletterForm";
import { Wordmark } from "./Wordmark";
import { useSite } from "./SiteProvider";

/**
 * Site footer: the wordmark, then four columns — Support, Follow us, Contact, Newsletter — and the
 * legal lines underneath.
 */
export function Footer({ chat = false }: { chat?: boolean }) {
  const { openPanel } = useSite();
  const { t, href, fmt } = useI18n();
  const f = t.footer;
  const year = new Date().getFullYear();
  const wa = whatsappUrl(generalMessage(t.messages));

  return (
    <footer className="site-footer">
      <div className="container">
        <Link href={href("/")} aria-label={t.nav.home} className="site-footer__logo">
          <Wordmark title={null} />
        </Link>

        <div className="site-footer__grid">
          <nav aria-labelledby="footer-support">
            <h2 id="footer-support" className="footer-heading">
              {f.support}
            </h2>
            <ul className="footer-list">
              <li>
                <Link href={href("/collection")}>{f.collection}</Link>
              </li>
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
              {chat && (
                <li>
                  <Link href={href("/chat")}>{f.chat}</Link>
                </li>
              )}
              <li>
                <button type="button" onClick={() => openPanel({ type: "contact" })}>
                  {f.contactLink}
                </button>
              </li>
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
          </nav>

          <div>
            <h2 className="footer-heading">{f.follow}</h2>
            <ul className="footer-list">
              <li>
                <a href={site.social.instagram.url} target="_blank" rel="noopener noreferrer" aria-label={`${t.contact.instagram} ${site.social.instagram.handle}`}>
                  <bdi dir="ltr">{site.social.instagram.handle}</bdi>
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
            <h2 className="footer-heading">{f.contact}</h2>
            <address className="footer-contact">
              <p>{site.location.streetAddress ? `${site.location.streetAddress}, ${t.location}` : t.location}</p>
              <p>
                <a className="footer-contact__link" href={site.contact.telHref} dir="ltr" onClick={() => track("call_click", { source: "footer" })}>
                  {site.contact.phoneDisplay}
                </a>
              </p>
              <p>
                <a className="footer-contact__link" href={site.contact.emailHref} dir="ltr" onClick={() => track("email_click", { source: "footer" })}>
                  {site.contact.email}
                </a>
              </p>
              <p>
                <a className="footer-contact__link" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "footer" })}>
                  {t.contact.whatsapp}
                </a>
              </p>
            </address>
          </div>

          <div className="site-footer__newsletter">
            <h2 className="footer-heading">{f.newsletter.title}</h2>
            <p className="footer-intro">{f.newsletter.intro}</p>
            <NewsletterForm />
          </div>
        </div>

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
