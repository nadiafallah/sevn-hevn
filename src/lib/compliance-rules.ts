/**
 * The compliance rules the website follows (docs/COMPLIANCE.md). The numbers come from the approved
 * rules in Supabase (public.compliance_site_settings, read by src/lib/compliance.ts); the defaults
 * below match the rules approved on 27 Oct 2026 and are used only when the database can't be read.
 * No server-only code here: the returns notice and checkout use it in the browser too.
 */

export interface SiteRules {
  /** RET-CHANGE-OF-MIND: the shop's own change-of-mind window, in days from delivery. 0 = none. Not a legal right. */
  changeOfMindDays: number;
  /** RET-NO-WARRANTY-30: pieces without a warranty are refunded if a fault is reported within this many days. */
  defectWindowDays: number;
  /** When that window starts. The official English text says from the day the fault appears. */
  defectWindowFrom: "defect_appears" | "purchase_date";
  /** DIS-PRE-ORDER: the buyer must tick that they read the returns notice and terms before sending. */
  requireTermsCheckbox: boolean;
  /** PRC-DISCOUNT-7D: a discount starting this many days after a purchase must be told to the buyer… */
  discountLookbackDays: number;
  /** …or the difference is refunded within this many days of the purchase. */
  discountRefundDays: number;
  /** "ledger": read from the approved rules. "defaults": the database couldn't be read. */
  source: "ledger" | "defaults";
}

export const defaultSiteRules: SiteRules = {
  changeOfMindDays: 7,
  defectWindowDays: 30,
  defectWindowFrom: "defect_appears",
  requireTermsCheckbox: true,
  discountLookbackDays: 7,
  discountRefundDays: 30,
  source: "defaults",
};

type RawRules = Record<string, { params?: Record<string, unknown> } | null | undefined>;

/** A whole number of days within reason, or the default. */
function days(value: unknown, fallback: number, min = 0) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= 365 ? n : fallback;
}

/** Reads the database's code → { params } object. Anything missing or malformed keeps its default. */
export function siteRulesFrom(raw: unknown): SiteRules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultSiteRules;
  const rules = raw as RawRules;
  const p = (code: string) => {
    const params = rules[code]?.params;
    return params && typeof params === "object" && !Array.isArray(params) ? params : {};
  };
  const d = defaultSiteRules;
  const change = p("RET-CHANGE-OF-MIND");
  const defect = p("RET-NO-WARRANTY-30");
  const pre = p("DIS-PRE-ORDER");
  const discount = p("PRC-DISCOUNT-7D");
  return {
    changeOfMindDays: days(change.change_of_mind_days, d.changeOfMindDays),
    defectWindowDays: days(defect.defect_window_days, d.defectWindowDays, 1),
    defectWindowFrom: defect.window_starts === "purchase_date" ? "purchase_date" : "defect_appears",
    requireTermsCheckbox: typeof pre.require_terms_checkbox === "boolean" ? pre.require_terms_checkbox : d.requireTermsCheckbox,
    discountLookbackDays: days(discount.discount_lookback_days, d.discountLookbackDays, 1),
    discountRefundDays: days(discount.refund_within_days, d.discountRefundDays, 1),
    source: "ledger",
  };
}

export interface ReturnsWording {
  grounds: string;
  defect: string;
  noWarrantyFromDefect: string;
  noWarrantyFromPurchase: string;
  changeOfMind: string;
  noChangeOfMind: string;
  priceDrop: string;
  howTo: string;
  productLine: string;
  productLineNoChangeOfMind: string;
}

const fill = (template: string, vars: Record<string, number>) => template.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? String(vars[k]) : whole));

/** The returns notice, paragraph by paragraph, from the approved rules. */
export function returnsNotice(r: SiteRules, w: ReturnsWording): string[] {
  return [
    w.grounds,
    w.defect,
    fill(r.defectWindowFrom === "purchase_date" ? w.noWarrantyFromPurchase : w.noWarrantyFromDefect, { days: r.defectWindowDays }),
    r.changeOfMindDays > 0 ? fill(w.changeOfMind, { days: r.changeOfMindDays }) : w.noChangeOfMind,
    fill(w.priceDrop, { days: r.discountLookbackDays, refundDays: r.discountRefundDays }),
    w.howTo,
  ];
}

/** The short returns line on a product page (when the piece has no returns text of its own). */
export function returnsLine(r: SiteRules, w: ReturnsWording): string {
  return r.changeOfMindDays > 0 ? fill(w.productLine, { days: r.changeOfMindDays }) : w.productLineNoChangeOfMind;
}

/** Where each rule is applied on the website, for the panel's Compliance page. */
export type CoverageState = "live" | "partial" | "not_yet" | "off_site";

export const siteCoverage: Record<string, { state: CoverageState; where: string }> = {
  "RET-CHANGE-OF-MIND": { state: "live", where: "Returns notice and product pages (days read from the rule)." },
  "RET-NO-WARRANTY-30": { state: "live", where: "Returns notice (days and start read from the rule)." },
  "RET-ONLINE-NONCONFORM": { state: "live", where: "Returns notice: when a piece can be returned, and when not." },
  "RET-DEFECT-REMEDY": { state: "live", where: "Returns notice: repair, replacement or refund at the shop’s cost." },
  "RET-NO-BLANKET-EXCLUSION": { state: "live", where: "No “final sale” or “no returns” wording anywhere on the website." },
  "RET-POLICY-PUBLISHED": { state: "partial", where: "Returns notice linked from the footer, every product page and checkout. Warranty terms in Arabic: not yet." },
  "PRC-DISCOUNT-7D": { state: "partial", where: "Stated in the returns notice. No automatic alert when a price drops after a sale yet." },
  "DIS-PRE-ORDER": {
    state: "partial",
    where: "Checkout tick box for the returns notice and terms, checked on the server and stored with the request. Country of origin and Arabic composition on product pages when filled in. Licence number not set yet.",
  },
  "DIS-CONDITION": { state: "live", where: "The database refuses to publish a pre-owned piece without condition notes; the condition is shown on the product page." },
  "DIS-ARABIC": { state: "partial", where: "Arabic composition on product pages when filled in. Warranty terms and invoices in Arabic: not yet." },
  "LIC-ECOM-LICENCE": { state: "not_yet", where: "Licence number and authority not set yet (src/config/site.ts → licence). Shown in the footer once set." },
  "LIC-FREEZONE-MAINLAND": { state: "off_site", where: "Licensing question for the business." },
  "VAT-PRICE-DISPLAY": { state: "not_yet", where: "Applies once the shop is VAT-registered: prices then shown including VAT." },
  "VAT-DIGITAL-INVOICE": { state: "not_yet", where: "Needs online payment; invoices are issued by the team for now." },
  "VAT-MARGIN-SCHEME": { state: "off_site", where: "Accounting (purchase prices are never stored in the public catalogue)." },
  "VAT-REGISTRATION": { state: "off_site", where: "Accounting." },
  "VAT-SUPPLIER-VERIFY": { state: "off_site", where: "Buying process: supplier checks before purchase." },
  "EINV-B2B": { state: "off_site", where: "Only for sales to companies, through an accredited provider." },
  "INS-COVERAGE": { state: "off_site", where: "Shipping insurance arranged per order." },
  "AML-DPMS": { state: "off_site", where: "goAML registration and checks for cash sales of AED 55,000 or more." },
  "PRV-PDPL": { state: "partial", where: "Privacy notice; consent on the checkout and newsletter forms. A cookie banner is needed before any analytics is switched on." },
  "SEC-ECOM": { state: "live", where: "HTTPS everywhere, security headers, no card data on the website." },
  "SEC-CONTINUITY": { state: "off_site", where: "Written continuity plan (daily database backups are in place)." },
  "ENF-PENALTIES": { state: "off_site", where: "Any warning from the authorities is fixed within the stated period." },
};
