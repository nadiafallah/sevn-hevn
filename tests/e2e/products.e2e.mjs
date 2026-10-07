// End-to-end checks for products in the private panel, against the local test stack and a
// production build (run with tests/e2e/run.sh). Test data only.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.E2E_BASE ?? "http://localhost:3300";
const GW = process.env.E2E_GW ?? "http://127.0.0.1:54320";
const sql = async (q, params = []) => (await fetch(`${GW}/__test/sql`, { method: "POST", body: JSON.stringify({ sql: q, params }) })).json();

let browser;
const dir = mkdtempSync(join(tmpdir(), "sh-products-"));
const photo = join(dir, "kelly-with-gps.jpg");
const consoleErrors = [];

before(async () => {
  browser = await chromium.launch();
  await sharp({ create: { width: 3000, height: 3750, channels: 3, background: "#14110f" } })
    .jpeg()
    .withExif({ IFD0: { Artist: "Owner's phone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "25/1 12/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "55/1 16/1 0/1" } })
    .toFile(photo);
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
  return { context, page };
}

async function signIn(page, who) {
  const users = JSON.parse(readFileSync(join(process.env.STACK_DIR, "users.json"), "utf8"));
  await page.goto(`${BASE}/admin/login`);
  await page.locator("input[name=email]").first().fill(users[who].email);
  await page.locator("input[name=password]").fill(users[who].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/admin`);
}

const flash = (page) => page.locator(".adm-flash").first().innerText();
const state = {};

describe("products in the panel", () => {
  it("owner adds a piece, uploads a photo (cleaned), publishes it, and it appears on the website", async () => {
    const { page, context } = await newPage();
    await signIn(page, "owner");
    await page.getByRole("navigation", { name: "Panel" }).getByRole("link", { name: "Products" }).click();
    await page.waitForURL(`${BASE}/admin/products`);
    await page.getByRole("link", { name: "Add a piece" }).click();
    await page.waitForURL(`${BASE}/admin/products/new`);
    // Only the four active categories can be chosen.
    const cats = (await page.locator("select[name=category] option").allTextContents()).map((t) => t.trim());
    assert.deepEqual(cats, ["Choose…", "Bags", "Watches", "Shoes", "Accessories"]);
    await page.locator("input[name=name]").fill("Constance 24");
    await page.locator("input[name=brand]").fill("Hermès");
    await page.locator("select[name=category]").selectOption("bags");
    await page.locator("input[name=price_aed]").fill("AED 62,000");
    await page.locator("input[name=included]").fill("Box, Dust bag");
    await page.getByRole("button", { name: "Save draft and add photos" }).click();
    await page.waitForURL(/\/admin\/products\/SH-\d{4}\?ok=product_created/);
    const ref = page.url().match(/SH-\d{4}/)[0];
    state.ref = ref;
    assert.match(await flash(page), /created as a draft/);
    assert.equal(await page.getByRole("button", { name: "Publish on the website" }).isDisabled(), true, "no publishing without a photo");

    await page.locator(".adm-upload input[type=file]").setInputFiles(photo);
    await page.locator(".adm-photos--product img").first().waitFor({ timeout: 15000 });
    const [img] = await sql("select storage_path, width, height, alt from public.product_images where product_ref = $1", [ref]);
    assert.match(img.storage_path, new RegExp(`^${ref}/[0-9a-f-]{36}\\.jpg$`));
    assert.ok(Math.max(img.width, img.height) <= 2000, "scaled down");
    assert.match(img.alt, /Hermès Constance 24, photo 1/);
    const file = Buffer.from(await (await fetch(`${GW}/__test/file?key=${encodeURIComponent(`product-images/${img.storage_path}`)}`)).arrayBuffer());
    const meta = await sharp(file).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.exif, undefined, "camera and location data removed");

    await page.getByRole("button", { name: "Publish on the website" }).click();
    await page.waitForURL(/ok=product_published/);
    const [row] = await sql("select published, price_aed, included from public.products where ref = $1", [ref]);
    assert.deepEqual(row, { published: true, price_aed: 62000, included: ["Box", "Dust bag"] });

    // The website shows it straight away (the action refreshes the cached catalogue).
    await page.goto(`${BASE}/collection?item=${ref}`);
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Constance 24/);
    assert.match(await dialog.innerText(), /62,000/);
    await context.close();
  });

  it("clear messages: 'available' needs price, stock and delivery; a live piece keeps its last photo", async () => {
    const { page, context } = await newPage();
    await signIn(page, "owner");
    await page.goto(`${BASE}/admin/products/${state.ref}`);
    await page.locator("select[name=status]").selectOption("available");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/error=available_incomplete/);
    assert.match(await flash(page), /needs a price, stock \(at least 1\) and delivery details/);
    await page.locator(".adm-photo-actions").getByRole("button", { name: "Remove" }).click();
    await page.waitForURL(/error=needs_photo/);
    assert.match(await flash(page), /at least one photo/);
    await context.close();
  });

  it("staff see every piece but cannot change anything; signed-out visitors get nothing", async () => {
    const { page, context } = await newPage();
    await signIn(page, "staff");
    await page.goto(`${BASE}/admin/products`);
    assert.match(await page.locator(".adm-table").innerText(), /Constance 24/);
    assert.equal(await page.getByRole("link", { name: "Add a piece" }).count(), 0);
    await page.goto(`${BASE}/admin/products/${state.ref}`);
    assert.equal(await page.getByRole("button", { name: "Save changes" }).count(), 0);
    assert.equal(await page.locator(".adm-upload").count(), 0);
    assert.match(await page.locator(".adm-dl").innerText(), /Box, Dust bag/);
    await page.goto(`${BASE}/admin/products/new`);
    await page.waitForURL(/error=owner_only/);
    // The upload endpoint refuses staff even when called directly.
    const res = await page.evaluate(async (ref) => {
      const f = new FormData();
      f.set("ref", ref);
      f.set("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), "x.jpg");
      const r = await fetch("/api/admin/product-photo", { method: "POST", body: f });
      return { status: r.status, body: await r.json() };
    }, state.ref);
    assert.deepEqual(res, { status: 403, body: { error: "owner_only" } });
    await context.close();

    const anon = await fetch(`${BASE}/admin/products`, { redirect: "manual" });
    assert.equal(anon.status, 307);
    assert.match(anon.headers.get("location"), /\/admin\/login/);
    const up = await fetch(`${BASE}/api/admin/product-photo`, { method: "POST", headers: { origin: BASE }, body: new FormData() });
    assert.equal(up.status, 401);
  });

  it("owner hides and then deletes the piece; it leaves the website and its photo file is removed", async () => {
    const { page, context } = await newPage();
    await signIn(page, "owner");
    await page.goto(`${BASE}/admin/products/${state.ref}`);
    await page.getByRole("button", { name: "Hide from the website" }).click();
    await page.waitForURL(/ok=product_unpublished/);
    const [{ storage_path: path }] = await sql("select storage_path from public.product_images where product_ref = $1", [state.ref]);
    await page.getByText("Delete this piece permanently").click();
    await page.locator("input[name=confirm]").fill("DELETE");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.waitForURL(/\/admin\/products\?ok=product_deleted/);
    assert.equal((await sql("select count(*)::int as n from public.products where ref = $1", [state.ref]))[0].n, 0);
    const gone = await fetch(`${GW}/__test/file?key=${encodeURIComponent(`product-images/${path}`)}`);
    assert.equal(gone.status, 404, "photo file deleted from storage");
    await page.goto(`${BASE}/collection?item=${state.ref}`);
    await page.getByText(/We couldn’t find the piece/).waitFor();
    await context.close();
    assert.deepEqual(consoleErrors, [], "no browser console errors");
  });
});
