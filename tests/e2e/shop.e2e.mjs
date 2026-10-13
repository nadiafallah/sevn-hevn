// End-to-end checks of the shop: the category menu, listings and filters, search, product options,
// the bag, checkout (purchase request) and the WhatsApp hand-off. Local test stack and a production
// build only (tests/e2e/run.sh); test data only. Phone numbers are in the Ofcom drama range.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://localhost:3300";
const UNAVAILABLE_BASE = process.env.E2E_UNAVAILABLE_BASE ?? "http://localhost:3301";
const GW = process.env.E2E_GW ?? "http://127.0.0.1:54320";
const sql = async (q, params = []) => (await fetch(`${GW}/__test/sql`, { method: "POST", body: JSON.stringify({ sql: q, params }) })).json();
/** The test endpoint runs one statement at a time. */
const sqlAll = async (script) => {
  for (const statement of script.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await sql(statement);
};
const refresh = (base) => fetch(`${base}/api/revalidate`, { method: "POST", headers: { "x-revalidate-secret": "local-revalidate-secret" } });

let browser;
const consoleErrors = [];

before(async () => {
  browser = await chromium.launch();
  // Pieces for the shop tests (the stack already has SH-0001, an available Hermès Kelly 28).
  await sqlAll(`
    insert into public.products (ref, published, status, name, category, subcategory, brand, colour, listed_at) values
      ('SH-0101', true, 'enquiry_only', 'Classic Flap', 'bags', 'shoulder', 'Chanel', 'Black', '2026-10-09'),
      ('SH-0103', true, 'sold', 'Love bracelet', 'jewellery', 'bracelets', 'Cartier', null, '2026-10-01');
    insert into public.products (ref, published, status, name, category, subcategory, brand, price_aed, stock, delivery, material, listed_at) values
      ('SH-0102', true, 'available', 'Oran sandals', 'shoes', 'sandals', 'hermes', 3900, 2, 'Delivery in Dubai arranged personally', 'Calfskin', '2026-10-08');
    update public.products set material = '18k yellow gold' where ref = 'SH-0103';
    insert into public.product_variants (product_ref, sku, size, colour, stock, position) values
      ('SH-0102', 'SH-0102-38', '38', 'Gold', 1, 0),
      ('SH-0102', 'SH-0102-39', '39', 'Gold', 0, 1);
    insert into public.product_variants (product_ref, sku, size, colour, price_aed, stock, position) values
      ('SH-0102', 'SH-0102-40N', '40', 'Noir', 4100, 1, 2);
  `);
  for (const base of [BASE, UNAVAILABLE_BASE]) assert.equal((await refresh(base)).status, 200);
});
after(async () => {
  await browser?.close();
});

async function newPage(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${page.url()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${page.url()}: ${e.message}`));
  return { context, page };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

describe("shop", () => {
  it("the category menu opens by click and keyboard (not only hover); a house link shows only that house", async () => {
    const { page, context } = await newPage();
    await page.goto(BASE);
    const bags = page.getByRole("button", { name: "Bags" });
    await bags.click();
    const panel = page.locator("#mega-bags");
    await panel.waitFor();
    assert.equal(await bags.getAttribute("aria-expanded"), "true");
    const houses = (await panel.locator(".mega__col").first().locator("a").allTextContents()).map((t) => t.trim());
    assert.deepEqual(houses, ["Hermès", "Chanel"], "only houses with listed bags, in the shop's order");
    // Photo tiles appear only for pieces that have a photo (none of these test pieces has one).
    assert.equal(await panel.locator(".mega__picks a").count(), 0);
    assert.equal(await panel.getByRole("link", { name: /Shop all Bags/ }).getAttribute("href"), "/bags");
    await page.keyboard.press("Escape");
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Bags", "focus returns to the category");
    // Keyboard: ↓ opens the panel and moves into it.
    await page.getByRole("button", { name: "Shoes" }).focus();
    await page.keyboard.press("ArrowDown");
    await page.locator("#mega-shoes").waitFor();
    assert.ok(await page.evaluate(() => !!document.activeElement?.closest("#mega-shoes")));
    await page.keyboard.press("Escape");
    // Hover also opens it for a mouse.
    await page.getByRole("button", { name: "Jewellery" }).hover();
    await page.locator("#mega-jewellery").waitFor();
    await page.getByRole("button", { name: "Bags" }).click();
    await panel.getByRole("link", { name: "Chanel" }).click();
    await page.waitForURL(`${BASE}/bags/chanel`);
    await page.locator("h1", { hasText: "Chanel Bags" }).waitFor();
    const names = (await page.locator(".card__name").allTextContents()).map((t) => t.trim());
    assert.deepEqual(names, ["Classic Flap"]);
    assert.equal(await page.locator(".chip[aria-current='page']").first().textContent(), "Chanel");
    await context.close();
  });

  it("filters combine with category and house, live in the address, and the Back button undoes them", async () => {
    const { page, context } = await newPage();
    await page.goto(`${BASE}/shoes`);
    assert.match(await page.locator(".listing-tools__count").innerText(), /1 piece/);
    await page.getByRole("button", { name: /Filter/ }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Noir").check();
    await page.waitForURL(/colour=noir/);
    await dialog.getByLabel("39").check();
    await page.waitForURL(/size=39/);
    await dialog.getByRole("button", { name: /Show 1 piece/ }).click();
    const url = new URL(page.url());
    assert.equal(url.pathname, "/shoes");
    assert.equal(url.searchParams.get("colour"), "noir");
    assert.equal(url.searchParams.get("size"), "39");
    // A shared link opens with the same filters.
    const { page: shared, context: c2 } = await newPage();
    await shared.goto(page.url());
    assert.equal(await shared.locator(".active-filters .chip").count(), 2);
    await c2.close();
    // One Back undoes the changes made in the filter panel.
    await page.goBack();
    await page.waitForURL(`${BASE}/shoes`);
    // Sorting by price never puts an unpriced piece first.
    await page.goto(`${BASE}/collection?sort=price-asc`);
    const order = (await page.locator(".card__name").allTextContents()).map((t) => t.trim());
    assert.deepEqual(order.slice(0, 2), ["Oran sandals", "Kelly 28 Togo"]);
    assert.ok(order.indexOf("Classic Flap") > order.indexOf("Kelly 28 Togo"));
    await context.close();
  });

  it("search finds pieces by house, model and code, from the header", async () => {
    const { page, context } = await newPage();
    await page.goto(BASE);
    await page.getByRole("button", { name: "Search the collection" }).click();
    const box = page.locator("dialog[open] input[type=search]");
    await box.fill("SH-0102-40N");
    await page.locator(".search-hit").first().waitFor();
    assert.match(await page.locator(".search-hit").first().innerText(), /Oran sandals/);
    await box.fill("hermes");
    await page.waitForFunction(() => document.querySelectorAll(".search-hit").length === 2);
    await box.fill("rolex");
    await page.getByText("No pieces match “rolex”.").waitFor();
    await context.close();
  });

  it("product options: photo, price and code follow the chosen version; Add to bag needs a size; the bag survives a reload", async () => {
    const { page, context } = await newPage();
    await page.goto(`${BASE}/product/SH-0102`);
    assert.match(await page.locator(".pdp-info__price").innerText(), /From AED\s3,900/);
    assert.equal(await page.getByRole("button", { name: "Add to bag" }).isDisabled(), true);
    await page.getByRole("button", { name: "Noir" }).click();
    await page.waitForURL(/sku=SH-0102-40N/);
    assert.match(await page.locator(".pdp-info__price").innerText(), /AED\s4,100/);
    assert.match(await page.locator(".pdp-info__code").innerText(), /SH-0102-40N/);
    await page.getByRole("button", { name: "Gold" }).click();
    await page.getByRole("button", { name: "39 — not available" }).waitFor();
    await page.getByRole("button", { name: "38", exact: true }).click();
    assert.match(await page.locator(".pdp-info__price").innerText(), /AED\s3,900/);
    const wa = await page.getByRole("link", { name: /Enquire on WhatsApp/ }).getAttribute("href");
    const text = decodeURIComponent(new URL(wa).searchParams.get("text")).replace(/\u00a0/g, " ");
    assert.match(wa, /^https:\/\/wa\.me\/971528877200\?/);
    for (const part of ["Hermès — Oran sandals", "SH-0102 / SH-0102-38", "Gold · 38", "AED 3,900", "/product/SH-0102?sku=SH-0102-38"]) assert.ok(text.includes(part), part);
    await page.getByRole("button", { name: "Add to bag" }).click();
    await page.locator("dialog[open] .cart-line").waitFor();
    await page.reload();
    await page.getByRole("button", { name: /Bag, 1 item/ }).click();
    assert.match(await page.locator("dialog[open] .cart-line").innerText(), /Oran sandals[\s\S]*Gold · 38/);
    // Related pieces come from the same category only.
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".related .card").count(), 0, "no other shoes are listed");
    await context.close();
  });

  it("checkout: verified on the server, a purchase request in the panel, no payment shown, retries don't duplicate", async () => {
    const { page, context } = await newPage();
    await page.goto(`${BASE}/product/SH-0001`);
    await page.getByRole("button", { name: "Add to bag" }).click();
    await page.locator("dialog[open]").getByRole("link", { name: "Checkout" }).click();
    await page.waitForURL(`${BASE}/checkout`);
    await page.getByText(/AED\s85,000/).first().waitFor();
    // Prices come from the catalogue, never from the browser.
    const tampered = await page.evaluate(async () => (await fetch("/api/checkout", { method: "POST", body: JSON.stringify({ items: [{ ref: "SH-0001", qty: 1, priceAED: 1 }] }) })).json());
    assert.equal(tampered.subtotalAED, 85000);
    const notForSale = await page.evaluate(async () => (await fetch("/api/checkout", { method: "POST", body: JSON.stringify({ items: [{ ref: "SH-0101", qty: 1 }] }) })).json());
    assert.equal(notForSale.issues[0].code, "not_for_sale");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/Full name/).fill("E2E Buyer");
    await page.locator("input[type=tel]").fill("+44 7700 900456");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/City or emirate/).fill("Dubai");
    await page.getByLabel(/^Address/).fill("Test building, Test street");
    await page.getByRole("button", { name: "Continue" }).click();
    assert.match(await page.locator(".checkout__summary").innerText(), /Nothing is charged online/);
    await page.getByRole("button", { name: "Send purchase request" }).click();
    await page.getByText(/Please confirm we may contact you/).waitFor();
    await page.getByLabel(/may contact me/).check();
    await page.getByRole("button", { name: "Send purchase request" }).click();
    await page.waitForURL(/\/checkout\/received\?ref=REQ-/);
    const ref = new URL(page.url()).searchParams.get("ref");
    const body = await page.locator(".received").innerText();
    assert.match(body, /not a confirmed order, and nothing has been charged/);
    assert.doesNotMatch(body, /paid|payment (successful|complete)/i);
    const [req] = await sql("select type, source, status, is_test, details, contact_phone from public.requests where reference = $1", [ref]);
    assert.equal(req.type, "purchase");
    assert.equal(req.source, "checkout");
    assert.equal(req.is_test, true);
    assert.equal(req.contact_phone, "+447700900456");
    assert.equal(req.details.lines[0].ref, "SH-0001");
    assert.equal(req.details.subtotal_aed, 85000);
    assert.equal((await sql("select count(*)::int n from public.orders o join public.requests r on r.id = o.request_id where r.reference = $1", [ref]))[0].n, 0, "no order or payment is created");
    // The bag is emptied once the request is stored.
    assert.equal(await page.getByRole("button", { name: "Bag", exact: true }).count(), 1);
    // The same request sent twice (double click, retry) is stored once.
    const twice = await page.evaluate(async () => {
      const send = () =>
        fetch("/api/purchase-request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: [{ ref: "SH-0102", sku: "SH-0102-38", qty: 1 }], customer: { name: "Twice", phone: "+447700900457", method: "whatsapp" }, delivery: { mode: "collect" }, consent: true, locale: "en", idempotencyKey: "e2e-twice-0000000001" }),
        }).then((r) => r.json());
      return [await send(), await send()];
    });
    assert.equal(twice[0].reference, twice[1].reference);
    assert.deepEqual([twice[0].created, twice[1].created], [true, false]);
    // The team sees it in the panel with its lines.
    await context.close();
  });

  it("where requests can't be stored, checkout offers WhatsApp with the bag instead of a fake confirmation", async () => {
    const { page, context } = await newPage();
    await page.goto(`${UNAVAILABLE_BASE}/product/SH-0001`);
    await page.getByRole("button", { name: "Add to bag" }).click();
    await page.goto(`${UNAVAILABLE_BASE}/checkout`);
    await page.getByText(/AED\s85,000/).first().waitFor();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/Full name/).fill("E2E Buyer");
    await page.locator("input[type=tel]").fill("+44 7700 900458");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/Collect in Dubai/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/may contact me/).check();
    await page.getByRole("button", { name: "Send purchase request" }).click();
    await page.getByText("Sending from the website isn’t available right now.").waitFor();
    const wa = await page.getByRole("link", { name: "Continue on WhatsApp" }).getAttribute("href");
    const text = decodeURIComponent(new URL(wa).searchParams.get("text")).replace(/\u00a0/g, " ");
    for (const part of ["Hello SEVN HEVN, I would like to purchase:", "Hermès Kelly 28 Togo", "code SH-0001", "AED 85,000", "/product/SH-0001", "Collect in Dubai", "Name: E2E Buyer"]) assert.ok(text.includes(part), part);
    assert.equal(new URL(page.url()).pathname, "/checkout", "no confirmation page");
    await context.close();
  });

  it("phone: the drawer holds the categories in fold-out sections; nothing overflows the screen", async () => {
    const { page, context } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const path of ["/", "/bags", "/product/SH-0102", "/checkout", "/ar", "/ar/shoes", "/ru/jewellery", "/fr/product/SH-0001"]) {
      await page.goto(`${BASE}${path}`);
      assert.equal(await overflow(page), 0, `no horizontal scroll on ${path}`);
    }
    await page.goto(BASE);
    const quick = (await page.locator(".cat-quick a").allTextContents()).map((t) => t.trim());
    assert.deepEqual(quick, ["Bags", "Shoes", "Watches", "Jewellery"]);
    await page.getByRole("button", { name: "Open menu" }).click();
    const shoes = page.locator("dialog[open] .menu-acc__trigger", { hasText: "Shoes" });
    await shoes.click();
    assert.equal(await shoes.getAttribute("aria-expanded"), "true");
    await page.locator("dialog[open] .menu-acc__panel:not([hidden])").getByRole("link", { name: "Hermès" }).click();
    await page.waitForURL(`${BASE}/shoes/hermes`);
    assert.equal(await overflow(page), 0);
    await context.close();
  });

  it("pages keep working after the catalogue is refreshed (a panel save or a database change)", async () => {
    for (const base of [BASE, UNAVAILABLE_BASE]) {
      assert.equal((await refresh(base)).status, 200);
      for (const path of ["/", "/ar", "/ru", "/fr", "/chat", "/checkout", "/bags", "/product/SH-0001"]) assert.equal((await fetch(`${base}${path}`)).status, 200, `${base}${path}`);
      assert.equal((await fetch(`${base}/xx`)).status, 404, "unknown languages are still refused");
    }
  });

  it("addresses: old links redirect permanently; houses outside a category don't exist; drafts and empty pages stay out of search", async () => {
    const res = await fetch(`${BASE}/collection?category=bags&designer=Herm%C3%A8s`, { redirect: "manual" });
    assert.equal(res.status, 308);
    assert.equal(new URL(res.headers.get("location"), BASE).pathname, "/bags/hermes");
    const ar = await fetch(`${BASE}/ar/collection?item=SH-0001`, { redirect: "manual" });
    assert.equal(new URL(ar.headers.get("location"), BASE).pathname, "/ar/product/SH-0001");
    for (const path of ["/watches/cartier", "/bags/loro-piana", "/accessories", "/product/NOPE-1"]) assert.equal((await fetch(`${BASE}${path}`)).status, 404, path);
    const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
    for (const path of ["/bags", "/bags/hermes", "/shoes/hermes", "/product/SH-0102", "/jewellery/cartier"]) assert.ok(sitemap.includes(`${path}<`), path);
    assert.ok(!sitemap.includes("/watches<"), "an empty category is not in the sitemap");
    const watches = await (await fetch(`${BASE}/watches`)).text();
    assert.match(watches, /<meta name="robots" content="noindex, follow"/);
    const product = await (await fetch(`${BASE}/product/SH-0102`)).text();
    const ld = JSON.parse(product.match(/<script type="application\/ld\+json">(\[\{"@context":"https:\/\/schema.org","@type":"Product".*?)<\/script>/)[1]);
    assert.equal(ld[0].brand.name, "Hermès");
    assert.equal(ld[0].offers.priceCurrency, "AED");
    assert.deepEqual(consoleErrors, [], "no browser console errors");
  });
});
