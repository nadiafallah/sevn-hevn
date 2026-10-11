"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";

/** 404 inside the site frame, in the language of the address that was requested. */
export default function NotFound() {
  const { t: ui, href } = useI18n();
  const t = ui.notFound;
  return (
    <section className="container nf">
      <title>{`${t.eyebrow} | SEVN HEVN`}</title>
      <meta name="robots" content="noindex" />
      <p className="eyebrow">{t.eyebrow}</p>
      <h1 className="display display--sm">{t.title}</h1>
      <p>{t.text}</p>
      <div className="stack-actions">
        <Link href={href("/collection")} className="btn btn--dark">
          {t.explore}
        </Link>
        <Link href={href("/")} className="btn btn--line">
          {t.home}
        </Link>
      </div>
    </section>
  );
}
