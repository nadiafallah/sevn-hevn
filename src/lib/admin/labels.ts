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

export const orderStatusLabels: Record<string, string> = {
  draft: "Draft quote",
  awaiting_confirmation: "Quote sent · waiting for the customer",
  confirmed: "Confirmed",
  processing: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const paymentLabels: Record<string, string> = {
  unpaid: "Unpaid",
  pending: "Payment pending",
  deposit_paid: "Partly paid",
  paid: "Paid",
  failed: "Payment failed",
  partially_refunded: "Partly refunded",
  refund_pending: "Refund pending",
  refunded: "Refunded",
  refund_failed: "Refund failed",
};
export const fulfilmentLabels: Record<string, string> = {
  not_started: "Not started",
  awaiting_stock: "Waiting for stock",
  sourcing: "Sourcing",
  quality_check: "Quality check",
  packed: "Packed",
  ready_to_dispatch: "Ready to dispatch",
  shipped: "Shipped",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  collected: "Collected",
  delivery_exception: "Delivery problem",
  returned_to_sender: "Returned to sender",
};
/** Stages the team sets by hand; shipped and later come from shipments. */
export const manualStages = ["awaiting_stock", "sourcing", "quality_check", "packed", "ready_to_dispatch"];

export const channelLabels: Record<string, string> = {
  website: "Website checkout", chat: "Concierge chat", whatsapp: "WhatsApp", instagram: "Instagram", phone: "Phone", email: "Email",
  in_person: "In person", panel: "Panel",
};
export const itemAvailabilityLabels: Record<string, string> = { in_stock: "In stock", on_request: "On request (sourced after payment)" };
export const itemStageLabels: Record<string, string> = {
  pending: "Waiting for confirmation", sourcing: "Sourcing", in_hand: "In hand · to check", qc_passed: "Checked", qc_failed: "Check failed",
  shipped: "Shipped", delivered: "Delivered", collected: "Collected", cancelled: "Cancelled",
};
export const vatTreatmentLabels: Record<string, string> = {
  standard: "Standard VAT", zero_rated: "Zero-rated (export)", not_applicable: "Not applicable", unknown: "Not decided",
};
export const dutiesLabels: Record<string, string> = {
  recipient_pays: "Paid by the recipient on arrival", included: "Included in the price", not_applicable: "Not applicable", unknown: "Not decided",
};
export const sourcingStatusLabels: Record<string, string> = {
  open: "Open", supplier_contacted: "Supplier contacted", supplier_confirmed: "Supplier confirmed", on_the_way: "On its way to us",
  received: "Received", failed: "Supplier can’t deliver", cancelled: "Cancelled",
};
export const shipmentStatusLabels: Record<string, string> = {
  preparing: "Preparing", label_created: "Label created (not shipped)", handed_over: "Handed to the carrier", in_transit: "In transit",
  out_for_delivery: "Out for delivery", delivered: "Delivered", exception: "Problem", returned_to_sender: "Returned to sender", lost: "Lost",
  cancelled: "Cancelled",
};
export const exceptionLabels: Record<string, string> = {
  delay: "Delay", failed_attempt: "Failed delivery attempt", address_issue: "Address problem", customs: "Customs", damaged: "Damaged", lost: "Lost", other: "Other",
};
export const insuranceLabels: Record<string, string> = { carrier: "Carrier cover", third_party: "Separate insurance", none: "None", unknown: "Not decided" };
export const paymentMethodLabels: Record<string, string> = {
  hosted_checkout: "Online (hosted checkout)", bank_transfer: "Bank transfer", cash: "Cash", card_terminal: "Card terminal", other: "Other",
};
export const paymentRowLabels: Record<string, string> = {
  created: "Started", pending: "Pending", succeeded: "Received", failed: "Failed", cancelled: "Cancelled", expired: "Expired",
};
export const refundStatusLabels: Record<string, string> = {
  approved: "Approved · not sent yet", pending: "Sent · waiting for confirmation", succeeded: "Refunded", failed: "Failed", cancelled: "Cancelled",
};
export const refundRouteLabels: Record<string, string> = { original_payment: "Original payment", bank_transfer: "Bank transfer (exception)", other: "Other (exception)" };
export const returnStatusLabels: Record<string, string> = {
  requested: "Requested", under_review: "Under review", approved: "Approved", rejected: "Rejected", awaiting_collection: "Waiting for collection",
  in_transit: "On its way back", received: "Received", inspected: "Inspected", resolved: "Resolved",
};
export const returnReasonLabels: Record<string, string> = {
  change_of_mind: "Change of mind", defective: "Faulty", damaged_in_transit: "Damaged in transit", not_authentic: "Doubts about authenticity",
  wrong_item: "Wrong item", not_as_described: "Not as described", other: "Other",
};
export const inspectionLabels: Record<string, string> = {
  as_described: "As described (same piece, same condition)", damaged: "Damaged", not_the_item_sold: "Not the piece we sold", incomplete: "Parts missing", other: "Other",
};
export const resolutionLabels: Record<string, string> = { refund: "Refund", replacement: "Replacement", repair: "Repair", returned_to_customer: "Sent back to the customer" };
export const collectionLabels: Record<string, string> = {
  courier_collection: "We book a courier collection", prepaid_label: "We send a prepaid label", customer_drop_off: "Customer drops it off", customer_sends: "Customer sends it",
};
export const evidenceLabels: Record<string, string> = {
  product: "Photo of the piece", serial: "Serial / reference", document: "Document", condition: "Condition", packing: "Packing", handover: "Handover",
  delivery: "Proof of delivery", return: "Returned piece", inspection: "Inspection", payment: "Payment proof",
};

export const availabilityLabels: Record<string, string> = {
  available: "Available",
  unavailable: "Not available",
  on_request: "On request",
  sourcing: "Being sourced",
};

export const knowledgeTopics = ["shipping", "returns", "authenticity", "warranty", "payment", "viewing", "general"];

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
  brand_not_allowed: "Choose one of the shop’s houses: Hermès, Louis Vuitton, Gucci or Chanel — or, for Jewellery only, Cartier, Van Cleef & Arpels or Bvlgari.",
  out_of_scope: "This piece can’t be published: only Bags, Shoes, Watches and Jewellery from the shop’s houses can be on the website.",
  duplicate: "That already exists.",
  journal_meta: "Add the meta title, meta description and summary before publishing (Edit → Save).",
  invalid_transition: "That step isn’t possible from the order’s current state.",
  reason_required: "Please give the reason. It is kept in the order’s history.",
  already_dispatched: "Something has already left with the carrier, so the order can’t be cancelled. Use a return instead.",
  not_delivered: "The order can be completed only once everything is delivered or collected.",
  insufficient_stock: "Not enough stock for this order any more. Change the line to “On request” or cancel and refund.",
  not_for_sale: "A piece on this order is no longer available to buy.",
  quote_incomplete: "The quote isn’t complete yet: it needs prices, shipping (or collection), the VAT treatment, duties for international orders and, for on-request pieces, the delivery estimate and cancellation terms.",
  quote_sent: "The quote has been sent. Return it to draft to change amounts.",
  quote_expired: "This quote has expired.",
  quote_not_accepted: "The customer hasn’t accepted the quote yet.",
  order_closed: "This order is closed.",
  invalid_amounts: "The total would be zero or negative. Check the prices, discount and shipping.",
  unknown_version: "That version code doesn’t match a version of this piece.",
  unknown_piece: "That product code doesn’t exist.",
  country_in_another_zone: "A country can be in one shipping zone only.",
  version_exists: "That version already exists for this policy. Use a new version name.",
  not_editable: "Approved texts can’t be edited. Write a new version and approve it.",
  checks_missing: "Every piece needs a passed quality check first.",
  shipment_missing: "Prepare the shipment first (carrier, contents and the pieces in it).",
  shipment_incomplete: "Fill in the carrier, tracking number, contents, the pieces in the parcel, the declared value and the insurance first.",
  photo_required: "Add at least one photo first.",
  coverage_unconfirmed: "The carrier hasn’t confirmed cover for this value and destination. Confirm it first, or (owner only) give the reason for sending without it.",
  evidence_required: "Delivered needs the carrier’s proof of delivery (its reference in the note), or the owner’s documented exception.",
  refund_exceeds_payment: "That is more than is left to refund on this payment.",
  refund_not_confirmed: "The refund isn’t confirmed yet. Close the return once it is.",
  not_restockable: "Only an inspected return of the same piece, as described, can go back into stock, and only once.",
  task_exists: "There is already an open sourcing task for this piece.",
  policies_unapproved: "Approve the terms of sale and the returns policy first (Settings).",
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
