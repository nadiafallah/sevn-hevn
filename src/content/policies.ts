/**
 * Interim customer information. These are NOT final business policies.
 * They describe only what is true today. Replace each `body` with the approved final
 * policy text once the business confirms it, and set `final: true`.
 */
export type PolicyId = "shipping" | "returns" | "privacy" | "terms";

export interface Policy {
  id: PolicyId;
  title: string;
  final: boolean;
  body: string[];
}

export const policies: Policy[] = [
  {
    id: "shipping",
    title: "Shipping & delivery",
    final: false,
    body: [
      "Our delivery policy is being finalised and will be published here.",
      "Until then, no online orders are taken. For any piece, delivery options, timing and any costs are confirmed with you personally — on WhatsApp, by phone or by email — before you agree to a purchase.",
      "We do not promise immediate or worldwide delivery for every piece.",
    ],
  },
  {
    id: "returns",
    title: "Returns & refunds",
    final: false,
    body: [
      "Our returns and refunds policy is being finalised and will be published here before online purchases open.",
      "For any piece you are considering, please ask us about return eligibility before purchase — the terms that apply will be confirmed to you in writing.",
    ],
  },
  {
    id: "privacy",
    title: "Privacy",
    final: false,
    body: [
      "This notice describes how this website currently works. A full privacy policy will replace it.",
      "Enquiry forms on this site do not send or store your details on our servers. When you continue, your prepared message opens in WhatsApp or your email app, and you decide whether to send it. Messages you send are received by SEVN HEVN and used only to respond to your enquiry.",
      "Your bag is saved only in your own browser (local storage) so it is still there when you return. It contains item references, not personal details.",
      "This website does not currently use advertising or analytics cookies. If that changes, we will ask for your consent first.",
      "Like most websites, our hosting provider may keep standard technical logs (such as IP address and browser type) for security and reliability.",
      "WhatsApp, email providers and Instagram are operated by third parties under their own privacy policies.",
      "To ask about your information, contact us using the details on this page.",
    ],
  },
  {
    id: "terms",
    title: "Terms",
    final: false,
    body: [
      "Full terms of sale will be published before online purchases open.",
      "Images marked “Editorial preview” are AI-generated mood imagery. They are not items for sale and do not represent a specific piece, its condition or its availability.",
      "Listings, prices and availability are subject to confirmation. Adding a piece to your bag does not reserve it. A private viewing request is not a confirmed appointment until our team confirms it with you.",
      "SEVN HEVN is an independent business and is not affiliated with, authorised by or endorsed by any brand mentioned on this website.",
    ],
  },
];

export const policyById = Object.fromEntries(policies.map((p) => [p.id, p])) as Record<PolicyId, Policy>;
