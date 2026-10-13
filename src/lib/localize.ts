import type { Locale } from "@/i18n/config";
import type { Item, ItemText } from "@/data/types";

const TEXT_KEYS = [
  "name", "description", "tagline", "editorialNote", "colour", "material", "hardware", "conditionNotes",
  "size", "dimensions", "stones", "authentication", "delivery", "returns", "draftNote",
] as const satisfies readonly (keyof ItemText & keyof Item)[];

/**
 * An item as shown in one language: translated descriptive text where it exists, English otherwise.
 * Brand, model reference, codes, price, stock, year, condition grade, type and status are never
 * changed. The translations themselves are dropped so they are not sent to the browser.
 */
export function localizeItem(item: Item, locale: Locale): Item {
  const { translations, ...base } = item;
  const tr = locale === "en" ? undefined : translations?.[locale];
  const out: Item = { ...base };
  if (tr) {
    for (const key of TEXT_KEYS) if (tr[key]) out[key] = tr[key];
    if (tr.included?.length) out.included = tr.included;
    if (tr.imageAlts?.length) out.images = item.images.map((im, i) => (tr.imageAlts?.[i] ? { ...im, alt: tr.imageAlts[i] } : im));
  }
  // Search finds a piece by its English or translated wording.
  out.searchText = [item.name, item.colour, item.material, tr?.name, tr?.colour, tr?.material].filter(Boolean).join(" ");
  return out;
}
