import type { Locale } from "../config";
import { ar } from "./ar";
import { en, type Dictionary } from "./en";
import { fr } from "./fr";
import { ru } from "./ru";

export type { Dictionary, UiDictionary } from "./en";

const dictionaries: Record<Locale, Dictionary> = { en, ar, ru, fr };

/** The full wording for one language. Client components receive only `ui` (see I18nProvider). */
export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
