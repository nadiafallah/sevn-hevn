// The shop's rules and listing logic (no database, no network): run with `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { brandAllowedIn, brandsFor, findBrand } from "../src/data/brands";
import { subcategoryId } from "../src/data/taxonomy";
import type { Item } from "../src/data/types";
import { isPurchasable, maxQuantity, priceLabel, priceRange } from "../src/lib/format";
import { availabilityOf, facets, listing, matchesQuery, offers, readListing, related, sortItems } from "../src/lib/shop";
import { itemMessage, itemUrl, purchaseMessage } from "../src/lib/whatsapp";
import { en } from "../src/i18n/dictionaries/en";

const piece = (over: Partial<Item>): Item => ({ ref: "SH-0001", status: "enquiry_only", name: "Piece", category: "bags", brand: "Hermès", brandId: "hermes", images: [], ...over });

test("houses: one spelling per house, and the permitted list per category", () => {
  assert.equal(findBrand("HERMES")?.name, "Hermès");
  assert.equal(findBrand("hermès paris")?.name, "Hermès");
  assert.equal(findBrand("Bulgari")?.name, "Bvlgari");
  assert.equal(findBrand("Van Cleef and Arpels")?.name, "Van Cleef & Arpels");
  assert.equal(findBrand("LV")?.name, "Louis Vuitton");
  assert.equal(findBrand("Loro Piana"), undefined);
  assert.equal(findBrand("Rolex"), undefined);
  for (const c of ["bags", "shoes", "watches"] as const) {
    assert.deepEqual(brandsFor(c).map((b) => b.name), ["Hermès", "Louis Vuitton", "Gucci", "Chanel"]);
    assert.equal(brandAllowedIn(c, "Cartier"), false, `Cartier is jewellery only, not ${c}`);
  }
  assert.deepEqual(brandsFor("jewellery").map((b) => b.name), ["Hermès", "Louis Vuitton", "Gucci", "Chanel", "Cartier", "Van Cleef & Arpels", "Bvlgari"]);
  assert.equal(brandAllowedIn("jewellery", "cartier"), true);
  assert.equal(brandAllowedIn("bags", "Loro Piana"), false);
});

test("types resolve from familiar names and stay within their category", () => {
  assert.equal(subcategoryId("shoes", "Mules"), "loafers");
  assert.equal(subcategoryId("bags", "Clutch"), "clutches");
  assert.equal(subcategoryId("bags", "Crossbody bags"), "shoulder");
  assert.equal(subcategoryId("jewellery", "Necklace"), "necklaces");
  assert.equal(subcategoryId("bags", "Rings"), undefined);
});

test("prices: never AED 0, a range shows “From”, sold pieces say so", () => {
  assert.equal(priceLabel(piece({ priceAED: 0 })), "Price on request");
  assert.equal(priceLabel(piece({})), "Price on request");
  assert.equal(priceLabel(piece({ priceAED: 52000 })), formatted(52000));
  const twoPrices = piece({ variants: [{ sku: "A", size: "38", priceAED: 3900 }, { sku: "B", size: "39", priceAED: 4100 }] });
  assert.equal(priceLabel(twoPrices), `From ${formatted(3900)}`);
  assert.equal(priceLabel(twoPrices, undefined, twoPrices.variants![1]), formatted(4100));
  assert.equal(priceLabel(piece({ status: "sold", priceAED: 1 })), "Sold");
  assert.deepEqual(priceRange(piece({ priceAED: 5000, variants: [{ sku: "A", colour: "Noir" }, { sku: "B", colour: "Gold", priceAED: 6000 }] })), { min: 5000, max: 6000 });
});

const formatted = (n: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(n);

test("buying: only available pieces with a price and stock; a piece with versions needs one chosen; drafts never", () => {
  const ok = piece({ status: "available", priceAED: 1000, stock: 1 });
  assert.equal(isPurchasable(ok), true);
  assert.equal(isPurchasable({ ...ok, draft: true }), false);
  assert.equal(isPurchasable({ ...ok, stock: 0 }), false);
  assert.equal(isPurchasable(piece({ priceAED: 1000, stock: 1 })), false, "enquiry only");
  const withVersions = piece({ status: "available", priceAED: 1000, variants: [{ sku: "A", size: "38", stock: 1 }, { sku: "B", size: "39", stock: 0 }] });
  assert.equal(isPurchasable(withVersions), true, "at least one version can be bought");
  assert.equal(isPurchasable(withVersions, withVersions.variants![0]), true);
  assert.equal(isPurchasable(withVersions, withVersions.variants![1]), false);
  assert.equal(maxQuantity(piece({ stock: 5 })), 1, "one-off pieces: quantity 1 unless the owner allows more");
  assert.equal(maxQuantity(piece({ stock: 5, maxPerOrder: 3 })), 3);
  assert.equal(availabilityOf(ok), "available");
  assert.equal(availabilityOf(piece({})), "enquiry");
});

const shop: Item[] = [
  piece({ ref: "SH-0001", name: "Kelly Dépêches 25", subcategory: "clutches", colour: "Noir", priceAED: 52000, listedAt: "2026-10-05", status: "available", stock: 1 }),
  piece({ ref: "SH-0002", name: "Classic Flap", brand: "Chanel", brandId: "chanel", subcategory: "shoulder", colour: "Beige", listedAt: "2026-10-09" }),
  piece({ ref: "SH-0003", name: "Oz mules", category: "shoes", subcategory: "loafers", colour: "Pink", size: "40.5", priceAED: 6200, listedAt: "2026-10-07" }),
  piece({ ref: "SH-0004", name: "Chypre sandals", category: "shoes", subcategory: "sandals", variants: [{ sku: "SH-0004-41", size: "41", colour: "Étoupe" }, { sku: "SH-0004-42", size: "42", colour: "Noir" }], priceAED: 4800, listedAt: "2026-10-02" }),
  piece({ ref: "SH-0005", name: "Farandole necklace", category: "jewellery", subcategory: "necklaces", material: "Silver", listedAt: "2026-10-06" }),
  piece({ ref: "SH-0006", name: "Love bracelet", category: "jewellery", brand: "Cartier", brandId: "cartier", subcategory: "bracelets", material: "18k yellow gold", priceAED: 30000, status: "sold" }),
];
const state = (q: string, fixed = {}) => readListing(new URLSearchParams(q), fixed);

test("sorting: newest first by default; by price with unpriced pieces always last", () => {
  assert.deepEqual(sortItems(shop, "newest").map((i) => i.ref), ["SH-0002", "SH-0003", "SH-0005", "SH-0001", "SH-0004", "SH-0006"]);
  const asc = sortItems(shop, "price-asc").map((i) => i.ref);
  const desc = sortItems(shop, "price-desc").map((i) => i.ref);
  assert.deepEqual(asc.slice(0, 4), ["SH-0004", "SH-0003", "SH-0006", "SH-0001"]);
  assert.deepEqual(desc.slice(0, 4), ["SH-0001", "SH-0006", "SH-0003", "SH-0004"]);
  for (const order of [asc, desc]) assert.deepEqual(order.slice(4).sort(), ["SH-0002", "SH-0005"], "unpriced pieces last in both directions");
});

test("filters combine: category, house, type, colour (versions included), size, availability and price", () => {
  assert.deepEqual(listing(shop, state("", { category: "bags", brand: "hermes" })).results.map((i) => i.ref), ["SH-0001"]);
  assert.deepEqual(listing(shop, state("type=sandals", { category: "shoes" })).results.map((i) => i.ref), ["SH-0004"]);
  assert.deepEqual(listing(shop, state("colour=noir", { category: "shoes" })).results.map((i) => i.ref), ["SH-0004"], "a version's colour counts");
  assert.deepEqual(listing(shop, state("size=40.5,42", { category: "shoes" })).results.map((i) => i.ref).sort(), ["SH-0003", "SH-0004"]);
  assert.deepEqual(listing(shop, state("availability=available")).results.map((i) => i.ref), ["SH-0001"]);
  // A price filter leaves out pieces without a price instead of treating them as AED 0.
  assert.deepEqual(listing(shop, state("price_max=10000")).results.map((i) => i.ref).sort(), ["SH-0003", "SH-0004"]);
  assert.deepEqual(listing(shop, state("price_min=20000&sort=price-asc")).results.map((i) => i.ref), ["SH-0006", "SH-0001"]);
  // Invalid values in the address are ignored.
  const bad = state("type=rings&availability=free&sort=cheap&price_min=-5", { category: "bags" });
  assert.equal(bad.type, undefined);
  assert.deepEqual(bad.availability, []);
  assert.equal(bad.sort, "newest");
  assert.equal(bad.priceMin, undefined);
  assert.equal(state("brand=Hermes").brand, "hermes", "a house name in the address is understood");
});

test("filter options come from real data only, and a group shows only when it can narrow the list", () => {
  const bags = facets(shop.filter((i) => i.category === "bags"), "bags");
  assert.deepEqual(bags.brands.map((b) => b.label), ["Hermès", "Chanel"]);
  assert.deepEqual(bags.types.map((t) => t.id), ["shoulder", "clutches"]);
  assert.equal(offers(bags.size), false, "no bag sizes listed: no size filter");
  assert.equal(offers(bags.colour), true);
  const watches = facets(shop.filter((i) => i.category === "watches"), "watches");
  assert.deepEqual([watches.brands.length, watches.types.length, watches.priced], [0, 0, 0], "an empty category offers nothing");
  const jewellery = facets(shop.filter((i) => i.category === "jewellery"), "jewellery");
  assert.deepEqual(jewellery.metal.map((m) => m.label).sort(), ["18k yellow gold", "Silver"]);
});

test("search: house (with or without accents), model, product code and version code", () => {
  const find = (q: string) => shop.filter((i) => matchesQuery(i, q)).map((i) => i.ref);
  assert.deepEqual(find("hermes kelly"), ["SH-0001"]);
  assert.deepEqual(find("Hermès kelly"), ["SH-0001"]);
  assert.deepEqual(find("sh-0003"), ["SH-0003"]);
  assert.deepEqual(find("SH-0004-42"), ["SH-0004"]);
  assert.deepEqual(find("chanel"), ["SH-0002"]);
  assert.deepEqual(find("rolex"), []);
});

test("related pieces: same category, same house first, never sold or the piece itself", () => {
  const r = related(shop, shop[2]).map((i) => i.ref);
  assert.deepEqual(r, ["SH-0004"]);
  assert.deepEqual(related(shop, shop[4]).map((i) => i.ref), [], "the only other jewellery piece is sold");
});

test("WhatsApp messages carry the name, code, chosen options, price and link", () => {
  const m = en.ui.messages;
  const msg = itemMessage({ ref: "SH-0004", name: "Chypre sandals", brand: "Hermès", status: "enquiry_only" }, m, "ar", { variant: { sku: "SH-0004-42", size: "42", colour: "Noir" }, price: "AED 4,800" });
  assert.match(msg, /Hermès — Chypre sandals/);
  assert.match(msg, /Reference: SH-0004 \/ SH-0004-42/);
  assert.match(msg, /Noir · 42/);
  assert.match(msg, /AED 4,800/);
  assert.ok(msg.includes(itemUrl("SH-0004", "ar", "SH-0004-42")));
  assert.match(itemUrl("SH-0004", "ar", "SH-0004-42"), /\/ar\/product\/SH-0004\?sku=SH-0004-42$/);
  const bag = purchaseMessage([{ ref: "SH-0001", name: "Hermès Kelly Dépêches 25", qty: 1, price: "AED 52,000" }], { intro: "Hello", code: "code", reference: "Website request: REQ-ABC123", confirm: "Please confirm." }, "en");
  assert.match(bag, /code SH-0001 · AED 52,000/);
  assert.match(bag, /REQ-ABC123/);
  assert.match(bag, /\/product\/SH-0001/);
});

test("the chat recognises a pasted piece link, new or old", async () => {
  const { findItemRef } = await import("../src/lib/concierge/detect");
  assert.equal(findItemRef("is this available? https://www.sevnhevn.ae/ar/product/SH-0012?sku=SH-0012-38"), "SH-0012");
  assert.equal(findItemRef("https://www.sevnhevn.ae/collection?item=SH-0007"), "SH-0007");
});
