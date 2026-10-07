/** Plain-English labels for the private panel. */

export const requestStatusLabels: Record<string, string> = {
  new: "New",
  in_progress: "In progress",
  awaiting_approval: "Waiting for price / availability approval",
  awaiting_customer: "Waiting for the customer",
  converted: "Converted to an order",
  closed: "Closed",
};

export const staffSettableStatuses = ["new", "in_progress", "awaiting_approval", "awaiting_customer", "closed"];

export const requestTypeLabels: Record<string, string> = {
  sourcing: "Find a piece",
  question: "Question",
  order_followup: "Order follow-up",
  callback: "Call back",
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
  duplicate: "That already exists.",
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
