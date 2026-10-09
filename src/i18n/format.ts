import type { Locale } from "./config";

/** Fills "{name}" placeholders. Unknown placeholders are left as they are. */
export function fmt(template: string, vars: Record<string, string | number> = {}) {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/** Plural forms as Intl.PluralRules names them; "other" is always required. */
export type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const rules = new Map<Locale, Intl.PluralRules>();

/** Picks the right plural form ("1 piece", "2 изделия", "5 изделий", …) and fills {n}. */
export function plural(locale: Locale, n: number, forms: Plural, vars: Record<string, string | number> = {}) {
  let r = rules.get(locale);
  if (!r) {
    r = new Intl.PluralRules(locale);
    rules.set(locale, r);
  }
  return fmt(forms[r.select(n)] ?? forms.other, { n, ...vars });
}

/** Dates for messages and the viewing form, in the visitor's language. */
export function formatDay(isoDate: string, intl: string) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(intl, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
