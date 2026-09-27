import type { Item } from "./types";

/**
 * DEMO RECORDS — for local testing of the bag and checkout states only.
 * Loaded only when DEMO_INVENTORY=true and never on a production deployment.
 * The checkout API rejects them and they never appear in structured data.
 */
export const demoItems: Item[] = [
  {
    ref: "DEMO-001",
    status: "available",
    name: "Demo item — available",
    category: "bags",
    description: "Test record used to check the bag. Not a real item.",
    images: [{ src: "/images/editorial/bag-cognac.jpg", width: 1122, height: 1028, alt: "Demo image" }],
    priceAED: 1000,
    stock: 1,
    delivery: "Demo delivery text.",
  },
  {
    ref: "DEMO-002",
    status: "sold",
    name: "Demo item — sold",
    category: "watches",
    description: "Test record used to check sold states. Not a real item.",
    images: [{ src: "/images/editorial/watch-gold-rectangular.jpg", width: 1122, height: 1402, alt: "Demo image" }],
    priceAED: 2000,
    stock: 0,
  },
  {
    ref: "DEMO-003",
    status: "enquiry_only",
    name: "Demo item — enquiry only",
    category: "shoes",
    description: "Test record used to check enquiry-only states. Not a real item.",
    images: [{ src: "/images/editorial/loafer-cobalt-suede.jpg", width: 1122, height: 1402, alt: "Demo image" }],
  },
];
