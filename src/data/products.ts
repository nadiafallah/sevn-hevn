import type { Item } from "./types";

/**
 * GENUINE INVENTORY — the single source of truth for real pieces.
 *
 * How to add a piece (see README → "Adding products"):
 *  1. Put real photos in /public/images/items/ (e.g. SH-0001-1.jpg). Note their pixel sizes.
 *  2. Copy the template below into the array and fill only the fields you know.
 *  3. Choose a status:
 *       "enquiry_only" — shown with "Enquire for details"; no online checkout.
 *       "available"    — needs priceAED, stock (1 for one-off pieces) and delivery. If any is
 *                         missing the site automatically treats it as "enquiry_only".
 *       "reserved" / "sold" — keeps the listing visible but disables purchase.
 *  4. Never put supplier names, owner details or private notes here — this file is public.
 *
 * Template:
 * {
 *   ref: "SH-0001",                      // unique, letters/numbers/dashes only
 *   status: "enquiry_only",
 *   name: "Birkin 30",
 *   brand: "Hermès",
 *   category: "bags",                    // bags | watches | shoes | accessories
 *   subcategory: "Handbags",
 *   modelReference: "",                  // e.g. watch reference "15202ST"
 *   description: "",
 *   images: [{ src: "/images/items/SH-0001-1.jpg", width: 1600, height: 2000, alt: "Front view of …" }],
 *   priceAED: 45000,                     // whole AED; omit the line if the price is not confirmed
 *   stock: 1,
 *   condition: "excellent",              // new | unworn | excellent | very_good | good | fair
 *   conditionNotes: "",
 *   year: "2021",
 *   material: "Togo leather",
 *   colour: "Gold",
 *   size: "30 cm",
 *   dimensions: "30 × 22 × 16 cm",
 *   included: ["Dust bag", "Box"],
 *   authentication: "",                  // only documented facts, e.g. "Original receipt available to view"
 *   delivery: "",                        // e.g. "Complimentary delivery within Dubai in 1–2 working days"
 *   returns: "",
 *   featured: false,
 *   listedAt: "2026-10-01",
 * },
 */
export const products: Item[] = [];
