/** Plain-English labels for the private panel. */
import type { Condition } from "@/data/types";
import { en } from "@/i18n/dictionaries/en";

/** Item condition grades, worded as on the English website. */
export const conditionLabels: Record<Condition, string> = en.ui.conditions;

export const requestStatusLabels: Record<string, string> = {
  new: "New",
  in_progress: "In progress",
  awaiting_approval: "Waiting for price / availability approval",
  awaiting_customer: "Waiting for the customer",
  converted: "Converted to an order",
  closed: "Closed",
};

/**
 * Languages a request, customer or knowledge entry may be marked with. The website and the chat are
 * English only since October 2026 (new requests are always "en"); older records may carry another.
 */
const languageNames: Record<string, string> = { en: "English", ar: "Arabic", ru: "Russian", fr: "French" };
export const recordLanguages = Object.entries(languageNames).map(([code, label]) => ({ code, label }));
export const languageLabel = (code?: string | null) => (code ? (languageNames[code] ?? code) : "—");
export const languageCode = (value: string | null | undefined) => (value && value in languageNames ? value : null);

export const staffSettableStatuses = ["new", "in_progress", "awaiting_approval", "awaiting_customer", "closed"];

export const requestTypeLabels: Record<string, string> = {
  sourcing: "Find a piece",
  question: "Question",
  order_followup: "Order follow-up",
  callback: "Call back",
  purchase: "Purchase request (website checkout)",
};

export const reviewLabels: Record<string, string> = {
  price: "Price",
  availability: "Availability",
  shipping: "Shipping terms",
  authenticity: "Authenticity",
  returns: "Returns",
  order: "Order status",
  other: "Other question",
};

export const methodLabels: Record<string, string> = { whatsapp: "WhatsApp", call: "Phone call", email: "Email" };

export const callOutcomeLabels: Record<string, string> = {
  reached: "Reached",
  no_answer: "No answer",
  left_message: "Left a message",
  wrong_number: "Wrong number",
  call_back_later: "Call back later",
};

export const notificationLabels: Record<string, string> = {
  pending: "Waiting to send",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  not_configured: "Needs connection",
};

export const orderStatusLabels: Record<string, string> = { open: "Open", completed: "Completed", cancelled: "Cancelled" };
export const paymentLabels: Record<string, string> = { unpaid: "Unpaid", partially_paid: "Partly paid", paid: "Paid", refunded: "Refunded" };
export const fulfilmentLabels: Record<string, string> = {
  not_started: "Not started",
  preparing: "Preparing",
  ready: "Ready",
  shipped: "Shipped",
  delivered: "Delivered",
  collected: "Collected",
  cancelled: "Cancelled",
};

export const availabilityLabels: Record<string, string> = {
  available: "Available",
  unavailable: "Not available",
  on_request: "On request",
  sourcing: "Being sourced",
};

export const knowledgeTopics = ["shipping", "returns", "authenticity", "warranty", "payment", "viewing", "general"];

/** Compliance ledger (UAE rules the website follows; see docs/COMPLIANCE.md). */
export const complianceAreaLabels: Record<string, string> = {
  licensing: "Licensing",
  disclosure: "Information shown to buyers",
  returns: "Returns and refunds",
  pricing: "Pricing and discounts",
  vat: "VAT",
  e_invoicing: "E-invoicing",
  insurance: "Insurance",
  aml: "Anti-money-laundering",
  privacy: "Personal data",
  security: "Security",
  enforcement: "Enforcement and penalties",
};

export const certaintyLabels: Record<string, string> = {
  confirmed: "Confirmed",
  disputed: "Sources disagree",
  needs_lawyer: "Ask a lawyer",
  unverified: "Not yet verified",
};

export const appliesToLabels: Record<string, string> = {
  all: "All sales",
  pre_owned: "Pre-owned pieces",
  new_goods: "New pieces",
  precious_metals_stones: "Precious metals and stones",
  b2b: "Sales to companies",
  free_zone: "Free-zone licence",
};

export const changeTypeLabels: Record<string, string> = {
  new_rule: "New rule",
  amended: "Change",
  repealed: "Repealed",
  verified: "Checked against the official text",
  deadline: "Deadline",
};

export const severityLabels: Record<string, string> = { high: "Important", medium: "Medium", low: "Minor" };

export const changeStatusLabels: Record<string, string> = {
  pending_review: "Waiting for you",
  approved: "Approved",
  applied: "Approved and applied",
  rejected: "Rejected",
};

export const errorMessages: Record<string, string> = {
  owner_only: "Only the owner can do that.",
  not_authorized: "You don’t have access to that.",
  invalid_request: "Some details were missing or not valid. Please check and try again.",
  not_found: "That record no longer exists.",
  last_owner: "There must always be at least one active owner.",
  has_order: "This request has an order, so it can’t be deleted.",
  not_retryable: "That notification can’t be retried.",
  needs_photo: "Add at least one photo before publishing. A published piece must keep at least one photo.",
  available_incomplete: "“Available to buy” needs a price, stock (at least 1) and delivery details. Fill them in or choose “Enquire only”.",
  photo_limit: "A piece can have up to 12 photos.",
  brand_not_allowed: "Choose one of the shop’s houses: Hermès or Chanel — or, for Bags and Shoes only, Miu Miu or Loro Piana.",
  out_of_scope: "This piece can’t be published: only Bags, Shoes, Watches and Jewellery from the shop’s houses can be on the website.",
  duplicate: "That already exists.",
  journal_meta: "Add the meta title, meta description and summary before publishing (Edit → Save).",
  already_decided: "That change was already decided (perhaps by your reply to the weekly email).",
  condition_notes_needed: "Add condition notes before publishing: a pre-owned piece (excellent, very good, good or fair) must say what wear it shows (UAE consumer protection rules).",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  unreachable: "The database couldn’t be reached. Please try again.",
  db_error: "Something went wrong. Please try again.",
};

const dubai = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" });
const dubaiDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Asia/Dubai" });

export const when = (iso?: string | null) => (iso ? dubai.format(new Date(iso)) : "—");
export const day = (iso?: string | null) => (iso ? dubaiDate.format(new Date(iso)) : "—");

export function money(amount: number | string | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined || !currency) return "—";
  const n = Number(amount);
  try {
    return new Intl.NumberFormat("en-AE", { style: "currency", currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

/** <input type="datetime-local"> value in Dubai time for an ISO timestamp, and back. */
export function toDubaiLocal(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 4 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export function fromDubaiLocal(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? new Date(`${value}:00+04:00`).toISOString() : null;
}
