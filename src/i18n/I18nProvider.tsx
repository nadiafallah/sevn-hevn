"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { localeInfo, localePath, type Locale } from "./config";
import { fmt, plural, type Plural } from "./format";
import type { UiDictionary } from "./dictionaries";

interface I18nValue {
  locale: Locale;
  t: UiDictionary;
  /** Locale-aware internal link: href("/collection") → "/ar/collection" in Arabic. */
  href: (path: string) => string;
  fmt: typeof fmt;
  plural: (n: number, forms: Plural, vars?: Record<string, string | number>) => string;
  /** Locale for dates (Intl). */
  intl: string;
}

const I18nContext = createContext<I18nValue | null>(null);

/** Gives client components the current language and its wording (only this language is sent). */
export function I18nProvider({ locale, ui, children }: { locale: Locale; ui: UiDictionary; children: ReactNode }) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: ui,
      href: (path) => localePath(locale, path),
      fmt,
      plural: (n, forms, vars) => plural(locale, n, forms, vars),
      intl: localeInfo[locale].intl,
    }),
    [locale, ui],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
