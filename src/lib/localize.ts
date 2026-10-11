import type { Locale } from "@/i18n/config";
import type { Item, ItemText } from "@/data/types";

const TEXT_KEYS = [
  "name", "description", "tagline", "editorialNote", "subcategory", "colour", "material", "conditionNotes",
  "size", "dimensions", "authentication", "delivery", "returns",
] as const satisfies readonly (keyof ItemText & keyof Item)[];

/**
 * An item as shown in one language: translated descriptive text where it exists, English otherwise.
 * Brand, model reference, price, stock, year, condition grade and status are never changed. The
 * translations themselves are dropped so they are not sent to the browser.
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
  out.searchText = [item.name, item.description, item.tagline, item.colour, item.material, item.subcategory, tr?.name, tr?.description, tr?.tagline, tr?.colour, tr?.material, tr?.subcategory]
    .filter(Boolean)
    .join(" ");
  return out;
}
