/**
 * Analytics event boundary. Events are ONLY forwarded when NEXT_PUBLIC_ANALYTICS_ENABLED=true
 * and the visitor has granted consent (window.sevnConsent.analytics === true), which a consent
 * banner must set before any tracking tool is added. Never pass names, phone numbers, emails
 * or free-text form content here.
 */
export type AnalyticsEvent =
  | "collection_view"
  | "product_view"
  | "whatsapp_click"
  | "call_click"
  | "email_click"
  | "sourcing_prepared"
  | "viewing_prepared"
  | "enquiry_sent"
  | "add_to_bag"
  | "checkout_start"
  | "filter_change"
  | "search";

type Props = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    sevnConsent?: { analytics?: boolean };
  }
}

const enabled = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "true";

export function track(event: AnalyticsEvent, props: Props = {}) {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "development") console.debug("[analytics]", event, props);
  if (!enabled || window.sevnConsent?.analytics !== true) return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...props });
}
