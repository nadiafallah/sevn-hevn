import type { Locale } from "../config";
import { en, type Dictionary } from "./en";

export type { Dictionary, UiDictionary } from "./en";

const dictionaries: Record<Locale, Dictionary> = { en };

/** The site's wording (English only). Client components receive only `ui` (see I18nProvider). */
export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
