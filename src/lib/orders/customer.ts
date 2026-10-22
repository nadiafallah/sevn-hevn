/**
 * How an order's state reads to the customer (order page, chat and e-mails). Plain English, no
 * internal detail: supplier names, notes, serial numbers and staff never appear here.
 */

export const orderStatusText: Record<string, string> = {
  draft: "Being prepared",
  awaiting_confirmation: "Waiting for your confirmation and payment",
  confirmed: "Confirmed",
  processing: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const paymentText: Record<string, string> = {
  unpaid: "Not paid yet",
  pending: "Payment being confirmed",
  deposit_paid: "Partly paid",
  paid: "Paid",
  failed: "Payment didn’t go through",
  partially_refunded: "Partly refunded",
  refund_pending: "Refund on its way",
  refunded: "Refunded",
  refund_failed: "Refund being retried by our team",
};

export const fulfilmentText: Record<string, string> = {
  not_started: "Being arranged",
  awaiting_stock: "Waiting for the piece",
  sourcing: "Being sourced for you",
  quality_check: "Being checked by our team",
  packed: "Packed",
  ready_to_dispatch: "Ready to dispatch",
  shipped: "Shipped",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  collected: "Collected",
  delivery_exception: "Delivery delayed: we are on it",
  returned_to_sender: "Returned to us by the carrier",
};

export const itemStageText: Record<string, string> = {
  pending: "Waiting for confirmation",
  sourcing: "Being sourced",
  in_hand: "With us, being checked",
  qc_passed: "Checked, being prepared",
  qc_failed: "Being checked again",
  shipped: "Shipped",
  delivered: "Delivered",
  collected: "Collected",
  cancelled: "Cancelled",
};

export const returnStatusText: Record<string, string> = {
  requested: "Received, waiting for review",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Not accepted",
  awaiting_collection: "Waiting for collection",
  in_transit: "On its way back to us",
  received: "Received by us",
  inspected: "Inspected",
  resolved: "Resolved",
};

export const returnReasonText: Record<string, string> = {
  change_of_mind: "I changed my mind",
  defective: "It is faulty",
  damaged_in_transit: "It arrived damaged",
  not_authentic: "I have doubts about its authenticity",
  wrong_item: "I received the wrong item",
  not_as_described: "It is not as described",
  other: "Something else",
};

export const shipmentText: Record<string, string> = {
  handed_over: "With the carrier",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Delayed",
  returned_to_sender: "Returned to us",
  lost: "Being investigated with the carrier",
};

/** One line per customer-visible history entry. */
export function eventText(kind: string, to: string | null): string | null {
  const [area] = kind.split(".");
  if (kind === "order.status" && to) return orderStatusText[to] ?? null;
  if (kind === "payment.status" && to) return paymentText[to] ?? null;
  if (kind === "fulfilment.status" && to) return fulfilmentText[to] ?? null;
  if (area === "shipment" && to) return shipmentText[to] ? `Parcel: ${shipmentText[to].toLowerCase()}` : null;
  if (area === "return" && to) return returnStatusText[to] ? `Return: ${returnStatusText[to].toLowerCase()}` : null;
  if (kind === "refund.pending") return "Refund sent to your bank or card";
  if (kind === "refund.succeeded") return "Refund completed";
  if (kind === "quote.accepted") return "You accepted the quote";
  if (kind === "collection.done") return "Collected in Dubai";
  if (kind === "order.note" || kind === "shipment.note") return "Update from SEVN HEVN";
  return null;
}
