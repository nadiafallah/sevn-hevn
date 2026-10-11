"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { localeInfo, localePath, locales, splitLocale, type Locale } from "@/i18n/config";
import { switchLocale } from "@/i18n/carry";
import { useI18n } from "@/i18n/I18nProvider";
import { useSite } from "./SiteProvider";

const noopSubscribe = () => () => {};

/**
 * Language selector, with each language shown in its own name. Every option is a real link to the
 * same page in that language (crawlable, works without JavaScript); with JavaScript the choice is
 * remembered and the open panel, form fields and chat come along (see i18n/carry.ts).
 *
 * "bar": compact disclosure in the top bar (every screen size). "menu": a list in the mobile menu.
 */
export function LanguageSwitcher({ variant }: { variant: "bar" | "menu" }) {
  const { locale, t } = useI18n();
  const { panel } = useSite();
  const pathname = usePathname();
  // Before hydration the links point at each language's home page, so server and client markup match
  // (the visible address can differ from the rendered route because of the English rewrite).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const hrefFor = (l: Locale) => localePath(l, hydrated ? splitLocale(pathname).path : "/");

  function choose(e: MouseEvent<HTMLAnchorElement>, l: Locale) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setOpen(false);
    if (l === locale) return;
    switchLocale(l, panel?.type === "menu" || panel?.type === "search" ? null : panel);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = (
    <ul className="lang__list" id={listId} aria-label={t.language}>
      {locales.map((l) => (
        <li key={l}>
          <a
            href={hrefFor(l)}
            hrefLang={l}
            lang={l}
            dir={localeInfo[l].dir}
            className="lang__option"
            aria-current={l === locale ? "true" : undefined}
            onClick={(e) => choose(e, l)}
          >
            {localeInfo[l].native}
          </a>
        </li>
      ))}
    </ul>
  );

  if (variant === "menu") {
    return (
      <div className="lang lang--menu" role="group" aria-label={t.language}>
        <p className="lang__heading">{t.language}</p>
        {options}
      </div>
    );
  }

  return (
    <div className="lang lang--bar" ref={rootRef} data-open={open || undefined}>
      <button type="button" className="lang__toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="lang__globe">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5s1.2-6.1 3.6-8.5z" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
        <span className="visually-hidden">{t.language}: </span>
        <span lang={locale}>{localeInfo[locale].native}</span>
        <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true" className="lang__chev">
          <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
        </svg>
      </button>
      <div className="lang__pop" hidden={!open}>
        {options}
      </div>
    </div>
  );
}
