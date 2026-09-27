import type { Item } from "./types";

/**
 * Editorial previews: AI-generated mood imagery supplied in the brand PDFs.
 * They are NOT inventory. They carry no brand, price, condition or availability,
 * cannot be added to the bag and are excluded from Product structured data.
 */
const note = "AI-generated editorial image. Not a listed item — ask us to source something similar.";

export const editorialPreviews: Item[] = [
  {
    ref: "ED-EMERALD",
    status: "editorial_preview",
    name: "Emerald",
    tagline: "A bold point of view.",
    category: "bags",
    subcategory: "Handbags",
    description: "A structured top-handle bag in deep emerald grained leather with gold-tone hardware.",
    images: [{ src: "/images/editorial/bag-emerald.jpg", width: 1122, height: 1402, alt: "Emerald green grained-leather top-handle bag with gold-tone hardware on a travertine plinth" }],
    featured: true,
    editorialNote: note,
  },
  {
    ref: "ED-COBALT",
    status: "editorial_preview",
    name: "Cobalt",
    tagline: "A little more colour.",
    category: "bags",
    subcategory: "Crossbody bags",
    description: "A compact shoulder bag in saturated cobalt leather with a sculpted gold-tone clasp.",
    images: [{ src: "/images/editorial/bag-cobalt.jpg", width: 1122, height: 1402, alt: "Cobalt blue leather shoulder bag with a gold-tone clasp on a travertine plinth" }],
    featured: true,
    editorialNote: note,
  },
  {
    ref: "ED-ROSE",
    status: "editorial_preview",
    name: "Rose",
    tagline: "A softer statement.",
    category: "bags",
    subcategory: "Handbags",
    description: "A softer statement: a rose-pink top-handle bag with gold-tone hardware.",
    images: [{ src: "/images/editorial/bag-rose.jpg", width: 1122, height: 1402, alt: "Rose pink grained-leather top-handle bag with gold-tone padlock on a travertine plinth" }],
    featured: true,
    editorialNote: note,
  },
  {
    ref: "ED-COGNAC",
    status: "editorial_preview",
    name: "Cognac",
    tagline: "Warm, quiet, timeless.",
    category: "bags",
    subcategory: "Handbags",
    description: "Warm cognac leather, contrast stitching and a quiet gold-tone turn-lock.",
    images: [{ src: "/images/editorial/bag-cognac.jpg", width: 1122, height: 1028, alt: "Cognac brown leather top-handle bag with contrast stitching on a travertine plinth" }],
    editorialNote: note,
  },
  {
    ref: "ED-GOLD-WATCH",
    status: "editorial_preview",
    name: "Gold rectangular watch",
    tagline: "A classic, slim and exact.",
    category: "watches",
    subcategory: "Vintage watches",
    description: "A slim rectangular gold-tone case with Roman numerals on a dark brown leather strap.",
    images: [{ src: "/images/editorial/watch-gold-rectangular.jpg", width: 1122, height: 1402, alt: "Rectangular gold-tone wristwatch with Roman numeral dial on a dark brown leather strap" }],
    featured: true,
    editorialNote: note,
  },
  {
    ref: "ED-LOAFER",
    status: "editorial_preview",
    name: "Cobalt suede loafer",
    tagline: "Colour, from the ground up.",
    category: "shoes",
    subcategory: "Loafers",
    description: "Cobalt suede loafers with a gold-tone horsebit detail.",
    images: [{ src: "/images/editorial/loafer-cobalt-suede.jpg", width: 1122, height: 1402, alt: "Pair of cobalt blue suede loafers with gold-tone bit detail on a travertine plinth" }],
    editorialNote: note,
  },
];
