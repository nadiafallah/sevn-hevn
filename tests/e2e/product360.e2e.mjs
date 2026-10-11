// End-to-end checks for 360° views: panel → database → Storage → website, against the local test
// stack and a production build (run with tests/e2e/run.sh). Test data only.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright";
import sharp from "sharp";

const BASE = process.env.E2E_BASE ?? "http://localhost:3300";
const GW = process.env.E2E_GW ?? "http://127.0.0.1:54320";
const sql = async (q, params = []) => (await fetch(`${GW}/__test/sql`, { method: "POST", body: JSON.stringify({ sql: q, params }) })).json();

let browser;
const dir = mkdtempSync(join(tmpdir(), "sh-360-"));
const frames = [];
const consoleErrors = [];
const state = {};

before(async () => {
  // WebGL for the 3D model (software rendering in headless Chromium).
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  // 12 frames whose brightness rises with the number, named as a camera would (frame-1 … frame-12).
  for (let i = 1; i <= 12; i++) {
    const f = join(dir, `frame-${i}.jpg`);
    const g = 20 + i * 15;
    await sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: g, g, b: g } } }).jpeg({ quality: 95 }).toFile(f);
    frames.push(f);
  }
  await sharp({ create: { width: 1500, height: 1200, channels: 3, background: "#777" } }).jpeg().toFile(join(dir, "landscape.jpg"));
  await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#a33" } }).jpeg().toFile(join(dir, "inside.jpg"));
  await sharp({ create: { width: 1600, height: 2000, channels: 3, background: "#2a2a2a" } }).jpeg().toFile(join(dir, "product.jpg"));
  writeFileSync(join(dir, "notes.jpg"), "A text file pretending to be a photo.");
  writeFileSync(join(dir, "broken.glb"), "Not a model, just text.");
});
after(async () => {
  await browser?.close();
});

async function newPage(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|404/.test(m.text())) consoleErrors.push(`${page.url()}: ${m.text()}`);
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

const viewSection = (page) => page.locator("#view");
const uploadInput = (page, n) => page.locator(".adm-view-upload input[type=file]").nth(n);
async function waitIdle(page) {
  await page.waitForFunction(() => !/Uploading|Preparing|Checking/.test(document.querySelector(".adm-view-upload [role=status]")?.textContent ?? ""), null, { timeout: 60000 });
  // router.refresh() re-renders the server part (checklist, frames) right after.
  await page.waitForTimeout(1500);
}

describe("360° views", () => {
  it("owner builds a photo spin in the panel: sorted frames, refused files, inside photo, preview, switched on", async () => {
    const { page, context } = await newPage();
    await signIn(page, "owner");
    await page.goto(`${BASE}/admin/products/new`);
    await page.locator("input[name=name]").fill("Spin test piece");
    await page.locator("select[name=category]").selectOption("bags");
    await page.getByRole("button", { name: "Save draft and add photos" }).click();
    await page.waitForURL(/\/admin\/products\/SH-\d{4}\?ok=product_created/);
    const ref = page.url().match(/SH-\d{4}/)[0];
    state.ref = ref;
    await page.locator(".adm-upload input[type=file]").setInputFiles(join(dir, "product.jpg"));
    await page.locator(".adm-photos--product img").first().waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Publish on the website" }).click();
    await page.waitForURL(/ok=product_published/);

    // Shuffled on purpose: the panel sorts by file name as a camera numbers them (2 before 10).
    const shuffled = [frames[9], frames[1], frames[11], frames[0], frames[4], frames[7], frames[2], frames[10], frames[5], frames[3], frames[8], frames[6]];
    await uploadInput(page, 0).setInputFiles(shuffled);
    await waitIdle(page);
    await viewSection(page).getByText("Photo spin: 12 of 12–72 frames").waitFor();
    const rows = await sql("select storage_path, zoom_path, width, height from public.product_view_media where product_ref = $1 and kind = 'frame' order by position", [ref]);
    assert.equal(rows.length, 12);
    assert.match(rows[0].storage_path, new RegExp(`^${ref}/360/[0-9a-f-]{36}\\.webp$`));
    const brightness = [];
    for (const r of rows) {
      const file = Buffer.from(await (await fetch(`${GW}/__test/file?key=${encodeURIComponent(`product-media/${r.storage_path}`)}`)).arrayBuffer());
      const { dominant } = await sharp(file).stats();
      brightness.push(dominant.r);
      const meta = await sharp(file).metadata();
      assert.equal(meta.format, "webp");
      assert.equal(meta.exif, undefined, "no camera or location data");
    }
    assert.deepEqual([...brightness].sort((a, b) => a - b), brightness, "frames kept in camera order");

    // Refused: a frame of another shape, and a file that isn't a photo.
    await uploadInput(page, 0).setInputFiles(join(dir, "landscape.jpg"));
    await waitIdle(page);
    assert.match(await page.locator(".adm-view-upload ul").innerText(), /different shape from the first frame/);
    await uploadInput(page, 0).setInputFiles(join(dir, "notes.jpg"));
    await waitIdle(page);
    assert.match(await page.locator(".adm-view-upload ul").innerText(), /isn’t a photo/);
    assert.equal((await sql("select count(*)::int as n from public.product_view_media where product_ref = $1", [ref]))[0].n, 12);

    await uploadInput(page, 1).setInputFiles(join(dir, "inside.jpg"));
    await waitIdle(page);
    await viewSection(page).getByText("Inside photos: 1").waitFor();

    // The preview shows the customer's viewer before anything is switched on.
    await page.locator(".adm-view-preview .pv-spin__img").waitFor({ timeout: 15000 });
    await page.locator("input[name=enabled]").check();
    await page.getByRole("button", { name: "Save 360° settings" }).click();
    await page.waitForURL(/ok=view_saved/);
    await viewSection(page).getByText("On: shown on the website").waitFor();
    await context.close();
  });

  it("customer: the card offers 360° View; drag, keys, zoom and the inside photo work", async () => {
    const { page, context } = await newPage();
    await page.goto(`${BASE}/collection`);
    const button = page.getByRole("button", { name: "Open the 360° view of Spin test piece" });
    await button.waitFor();
    assert.equal(await page.locator(".card__360").count(), 1, "only the piece with a view has the button");
    await button.click();
    const stage = page.locator(".pv__stage");
    await page.locator(".pv-spin__img").waitFor();
    await page.waitForFunction(() => !document.querySelector(".pv__loading"), null, { timeout: 20000 });
    const angle = () => page.locator(".pv__angle input").inputValue();
    const angleBecomes = (v) => page.waitForFunction((want) => document.querySelector(".pv__angle input")?.value === want, v, { timeout: 3000 });
    assert.equal(await angle(), "0");
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60 + box.width / 2, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    assert.notEqual(await angle(), "0", "dragging turns the piece");
    await stage.focus();
    await page.keyboard.press("0");
    await angleBecomes("0"); // 0 returns to the first view
    await page.keyboard.press("ArrowRight");
    await angleBecomes("1");
    await page.getByRole("button", { name: "Zoom in" }).click();
    assert.match(await page.locator(".pv-spin__img").getAttribute("src"), /-zoom\.webp$/, "zooming loads the larger photo");
    await page.getByRole("button", { name: "View inside" }).click();
    await page.locator(".pv-inside__img").waitFor();
    await page.getByRole("button", { name: "View outside" }).click();
    await page.locator(".pv-spin__img").waitFor();
    await context.close();
  });

  it("a missing frame file: the viewer says so and goes back to the photos", async () => {
    const { page, context } = await newPage();
    await page.route("**/product-media/**", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto(`${BASE}/collection?item=${state.ref}`);
    await page.locator(".pd__thumb--360").click();
    await page.getByRole("alert").filter({ hasText: "couldn’t be loaded" }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Back to photos" }).first().click();
    await page.locator(".pd__main img.pd__img").waitFor();
    await context.close();
  });

  it("phone: a vertical swipe on the viewer scrolls; a sideways swipe turns", async () => {
    const { page, context } = await newPage({ ...devices["iPhone 13"] });
    await page.goto(`${BASE}/collection?item=${state.ref}`);
    await page.locator(".pd__thumb--360").click();
    await page.waitForFunction(() => !document.querySelector(".pv__loading"), null, { timeout: 20000 });
    const stage = await page.locator(".pv__stage").boundingBox();
    const cdp = await context.newCDPSession(page);
    const swipe = async (dx, dy) => {
      const x = stage.x + stage.width / 2, y = stage.y + stage.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(400);
    };
    const scrolled = () => page.evaluate(() => document.querySelector("dialog[open] .dlg__body")?.scrollTop ?? window.scrollY);
    const before = await scrolled();
    const angle0 = await page.locator(".pv__angle input").inputValue();
    await swipe(0, -220);
    assert.ok((await scrolled()) > before, "the panel scrolled");
    assert.equal(await page.locator(".pv__angle input").inputValue(), angle0, "the piece did not turn");
    await page.locator(".pv__stage").scrollIntoViewIfNeeded();
    await swipe(160, 0);
    assert.notEqual(await page.locator(".pv__angle input").inputValue(), angle0, "a sideways swipe turns it");
    await context.close();
  });

  it("Arabic: translated, right-to-left", async () => {
    const { page, context } = await newPage();
    await page.goto(`${BASE}/ar/collection`);
    await page.getByRole("button", { name: /افتح عرض 360°/ }).click();
    await page.locator(".pv").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
    assert.match(await page.locator(".pv__hint").innerText(), /اسحب أفقياً للتدوير/);
    await page.getByRole("button", { name: "تكبير" }).waitFor();
    await context.close();
  });

  it("3D model: a broken file is refused; a real .glb is checked, switched on and shown", async () => {
    const { page, context } = await newPage();
    await signIn(page, "owner");
    await page.goto(`${BASE}/admin/products/${state.ref}#view`);
    await uploadInput(page, 2).setInputFiles(join(dir, "broken.glb"));
    await waitIdle(page);
    assert.match(await page.locator(".adm-view-upload ul").innerText(), /isn’t a \.glb file/);
    assert.equal((await sql("select model_path from public.product_views where product_ref = $1", [state.ref]))[0].model_path, null);

    await uploadInput(page, 2).setInputFiles("public/showcase/SunglassesKhronos/model.glb");
    await waitIdle(page);
    await viewSection(page).getByText(/3D model: checked \.glb/).waitFor({ timeout: 20000 });
    await page.locator("input[name=kind][value=model]").check();
    await page.getByRole("button", { name: "Save 360° settings" }).click();
    await page.waitForURL(/ok=view_saved/);

    await page.goto(`${BASE}/collection?item=${state.ref}`);
    await page.locator(".pd__thumb--360").click();
    await page.waitForFunction(() => document.querySelector(".pv model-viewer")?.loaded === true, null, { timeout: 30000 });
    assert.match(await page.locator(".pv__kind").innerText(), /3D model/i);
    await context.close();
    assert.deepEqual(consoleErrors, []);
  });
});
