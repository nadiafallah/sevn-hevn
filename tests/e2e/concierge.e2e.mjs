// End-to-end checks against the local test stack (scripts/local-stack.mjs) and a production build
// of the site. Run with tests/e2e/run.sh. Uses only test data (Ofcom fiction numbers, *.test.local).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.E2E_BASE ?? "http://localhost:3300";
const UNAVAILABLE_BASE = process.env.E2E_UNAVAILABLE_BASE ?? "http://localhost:3301";
const GW = process.env.E2E_GW ?? "http://127.0.0.1:54320";
const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");

const sql = async (q, params = []) => (await fetch(`${GW}/__test/sql`, { method: "POST", body: JSON.stringify({ sql: q, params }) })).json();
const mail = async () => (await fetch(`${GW}/__test/mail`)).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      if (Date.now() > end) throw e;
    }
    if (Date.now() > end) throw new Error("timed out");
    await wait(200);
  }
}

let browser;
const dir = mkdtempSync(join(tmpdir(), "sh-e2e-"));
const photoWithGps = join(dir, "bag-with-gps.jpg");
const notAnImage = join(dir, "notes.jpg");
const consoleErrors = [];

before(async () => {
  browser = await chromium.launch();
  // A real JPEG carrying camera/location metadata, to prove the server strips it.
  await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#2a6b4f" } })
    .jpeg()
    .withExif({ IFD0: { Artist: "Test Camera Owner", Copyright: "secret" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "25/1 12/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "55/1 16/1 0/1" } })
    .toFile(photoWithGps);
  writeFileSync(notAnImage, "This is a text file pretending to be a photo.");
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

async function lastAssistant(page) {
  return page.locator(".cc__msg--assistant p").last().innerText();
}

async function answer(page, text) {
  const input = page.locator(".cc__composer .cc__input");
  await input.fill(text);
  await input.press("Enter");
  await page.waitForFunction(() => !document.querySelector(".cc__status[role=status]"));
}

async function pick(page, label) {
  await page.locator(".cc__choices").getByRole("button", { name: label, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".cc__status[role=status]"));
}

async function api(body) {
  const res = await fetch(`${BASE}/api/concierge`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}

async function signIn(page, who) {
  const users = JSON.parse((await import("node:fs")).readFileSync(join(process.env.STACK_DIR, "users.json"), "utf8"));
  await page.goto(`${BASE}/admin/login`);
  await page.locator("input[name=email]").first().fill(users[who].email);
  await page.locator("input[name=password]").fill(users[who].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/admin`);
}

async function axeViolations(page, selector) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (sel) => {
    const r = await window.axe.run(sel ? document.querySelector(sel) : document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`);
  }, selector);
}

const state = {};

describe("customer chat", () => {
  it("desktop, English, widget: request with a photo is saved, photo is cleaned, team is notified", async () => {
    const { page, context } = await newPage();
    await page.goto(BASE);
    const wa = await page.locator(".wa-float").boundingBox();
    const launcher = await page.locator(".cc-launcher").boundingBox();
    assert.ok(wa && launcher, "WhatsApp and concierge buttons are both visible");
    assert.ok(launcher.y + launcher.height <= wa.y, "the concierge button sits above WhatsApp without overlapping");

    // Keyboard: focus the launcher and open with Enter.
    await page.locator(".cc-launcher").focus();
    await page.keyboard.press("Enter");
    await page.locator(".cc-panel .cc__msg--assistant").first().waitFor();
    assert.match(await page.locator(".cc-panel").innerText(), /virtual assistant/);
    assert.deepEqual(await axeViolations(page, ".cc-panel"), [], "no serious accessibility problems in the chat");

    await pick(page, "Find a specific piece");
    await page.locator(".cc__composer input[type=file]").setInputFiles(photoWithGps);
    await page.getByText("Photo attached").waitFor();
    await page.waitForFunction(() => !document.querySelector(".cc__status[role=status]"));
    assert.match(await page.locator(".cc__log").innerText(), /can’t confirm authenticity/);
    assert.match(await lastAssistant(page), /tell me a little about the piece/);
    await answer(page, "Hermès Birkin 25 in gold togo leather");
    assert.match(await page.locator(".cc__log").innerText(), /Noted: Hermès · Birkin · gold · 25 · Bags/);
    await answer(page, "Around AED 60,000");
    await pick(page, "United Arab Emirates");
    await pick(page, "As soon as possible");
    await answer(page, "Layla Test");
    await answer(page, "+44 7700 900101");
    await pick(page, "WhatsApp");
    await page.locator(".cc__review").waitFor();
    assert.match(await page.locator(".cc__review").innerText(), /\+44 7700 900101/);
    // Submitting without consent is refused.
    await page.getByRole("button", { name: "Send request" }).click();
    await page.waitForFunction(() => !document.querySelector(".cc__status[role=status]"));
    assert.match(await lastAssistant(page), /tick the box/);
    await page.getByLabel("I agree that SEVN HEVN may contact me about this request.").check();
    await page.getByRole("button", { name: "Send request" }).click();
    await page.getByText(/Your reference is REQ-/).waitFor();
    const ref = (await lastAssistant(page)).match(/REQ-[A-Z0-9]{6}/)[0];
    state.desktopRef = ref;

    // Escape closes the panel and returns focus to the launcher.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.classList.contains("cc-launcher"));

    const [req] = await sql("select id, type, is_test, contact_phone, details, locale from public.requests where reference = $1", [ref]);
    assert.equal(req.type, "sourcing");
    assert.equal(req.is_test, true, "Ofcom fiction number marks the request as test data");
    assert.equal(req.details.photos, 1);
    state.desktopRequestId = req.id;
    const [photo] = await sql("select object_path, width, height, bytes from public.request_photos where request_id = $1 and status = 'stored'", [req.id]);
    assert.ok(photo.width <= 1600 && photo.height <= 1600, "resized");
    const stored = Buffer.from(await (await fetch(`${GW}/__test/file?key=${encodeURIComponent(`request-photos/${photo.object_path}`)}`)).arrayBuffer());
    const meta = await sharp(stored).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.exif, undefined, "camera and GPS metadata removed");
    assert.ok(!stored.includes(Buffer.from("Test Camera Owner")));

    const n = await eventually(async () => {
      const rows = await sql("select channel, status from public.notifications where request_id = $1 order by channel", [req.id]);
      return rows.find((r) => r.channel === "email")?.status === "sent" ? rows : null;
    });
    assert.deepEqual(n, [{ channel: "email", status: "sent" }, { channel: "whatsapp", status: "not_configured" }]);
    const note = (await mail()).find((m) => m.subject.includes(ref));
    assert.ok(note, "team e-mail sent");
    assert.deepEqual(note.to, ["team@test.local"]);
    assert.ok(!note.raw.includes("7700") && !note.raw.includes("Layla"), "no customer phone or name in the e-mail");
    assert.ok(note.raw.includes(`/admin/requests/${req.id}`));
    const [ai] = await sql("select coalesce(sum(calls), 0)::int as calls from private.ai_usage");
    assert.ok(ai.calls >= 1, "the (failing) AI provider was tried and the chat carried on without it");
    await context.close();
  });

  it("mobile, Arabic, /chat page: right-to-left, international number, saved and restored after reload", async () => {
    const { page, context } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/chat`);
    await page.locator(".cc__msg--assistant").first().waitFor();
    await page.getByRole("button", { name: "العربية" }).click();
    await page.waitForFunction(() => document.querySelector(".cc")?.getAttribute("dir") === "rtl");
    assert.equal(await page.locator(".cc").getAttribute("lang"), "ar");
    assert.match(await page.locator(".cc__log").innerText(), /المساعد الافتراضي/);
    await pick(page, "البحث عن قطعة معيّنة");
    await answer(page, "أبحث عن ساعة رولكس دايتونا");
    await pick(page, "تخطي");
    await pick(page, "أفضّل عدم التحديد");
    await pick(page, "دولة أخرى");
    await answer(page, "السعودية");
    await pick(page, "تخطي");
    await pick(page, "تخطي");
    await answer(page, "+44 7700 900102");
    await pick(page, "مكالمة هاتفية");
    await page.getByLabel("أوافق على أن تتواصل معي SEVN HEVN بخصوص هذا الطلب.").check();
    await page.getByRole("button", { name: "إرسال الطلب" }).click();
    await page.getByText(/ورقمه المرجعي/).waitFor();
    const text = await lastAssistant(page);
    const ref = text.match(/REQ-[A-Z0-9]{6}/)[0];
    assert.ok(text.includes(`⁦${ref}⁩`), "reference shown left-to-right inside Arabic text");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `no horizontal scrolling (${overflow}px)`);
    assert.deepEqual(await axeViolations(page, ".cc"), []);

    await page.reload();
    await page.getByText(/ورقمه المرجعي/).waitFor();
    assert.equal(await page.locator(".cc").getAttribute("dir"), "rtl", "language kept after reload");
    // The widget on any page continues the same conversation.
    await page.goto(BASE);
    await page.locator(".cc-launcher").click();
    await page.getByText(/ورقمه المرجعي/).waitFor();
    // The full-screen widget on a phone must receive taps (nothing from the page on top of it).
    await page.locator(".cc-panel").getByRole("button", { name: "English" }).click({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelector(".cc-panel .cc")?.getAttribute("dir") === "ltr");

    const [req] = await sql("select locale, destination_country, contact_method, contact_phone from public.requests where reference = $1", [ref]);
    assert.deepEqual(req, { locale: "ar", destination_country: "SA", contact_method: "call", contact_phone: "+447700900102" });
    await context.close();
  });

  it("a repeated submit (double click, retry after a dropped connection) records one request", async () => {
    const start = await api({ action: "start", locale: "en", source: "widget", clientMsgId: "dup-000001", input: { type: "choice", value: "callback" } });
    const conv = start.data.conversation;
    let n = 2;
    for (const input of [{ type: "text", value: "Private viewing next week" }, { type: "choice", value: "skip" }, { type: "text", value: "+44 7700 900103" }, { type: "choice", value: "call" }]) {
      const r = await api({ action: "reply", conversation: conv, clientMsgId: `dup-00000${n++}`, input });
      assert.equal(r.status, 200);
    }
    const submit = { action: "reply", conversation: conv, clientMsgId: "dup-submit-1", input: { type: "submit", consent: true } };
    const [a, b] = await Promise.all([api(submit), api(submit)]);
    const refs = [a, b].map((r) => r.data.submitted?.reference).filter(Boolean);
    assert.ok(refs.length >= 1);
    assert.equal(new Set(refs).size, 1, "both answers carry the same reference");
    const again = await api(submit);
    assert.equal(again.data.submitted.reference, refs[0], "a retry returns the stored answer");
    const [count] = await sql("select count(*)::int as n from public.requests where contact_phone = '+447700900103'");
    assert.equal(count.n, 1);
    // A stolen id without the token, or a guessed token, is refused.
    assert.equal((await api({ action: "load", conversation: { id: conv.id, token: "x".repeat(43) } })).status, 404);
    state.callbackConversation = conv;
  });

  it("uploads are limited to real images, 4 MB and three photos per conversation", async () => {
    const start = await api({ action: "start", locale: "en", source: "widget", clientMsgId: "up-000001", input: { type: "choice", value: "sourcing" } });
    const conv = start.data.conversation;
    const upload = async (bytes, id) => {
      const form = new FormData();
      form.set("id", conv.id);
      form.set("token", conv.token);
      form.set("clientMsgId", id);
      form.set("file", new Blob([bytes], { type: "image/jpeg" }), "x.jpg");
      const res = await fetch(`${BASE}/api/concierge/photo`, { method: "POST", body: form, headers: { origin: BASE } });
      return { status: res.status, data: await res.json() };
    };
    const fake = await upload(Buffer.from("<html><script>alert(1)</script></html>"), "up-000002");
    assert.deepEqual([fake.status, fake.data.error], [415, "photo_type"]);
    const big = await upload(Buffer.alloc(4 * 1024 * 1024 + 10, 0xff), "up-000003");
    assert.equal(big.status, 413);
    const jpg = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#000" } }).jpeg().toBuffer();
    for (let i = 0; i < 3; i++) assert.equal((await upload(jpg, `up-ok-00${i}`)).status, 200);
    const fourth = await upload(jpg, "up-ok-004");
    assert.deepEqual([fourth.status, fourth.data.error], [409, "photo_limit"]);
    assert.equal((await fetch(`${BASE}/api/concierge`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" })).status, 403);
  });

  it("a website price is quoted with its date; an unknown price goes to the team", async () => {
    const start = await api({ action: "start", locale: "en", source: "widget", clientMsgId: "price-0001", input: { type: "choice", value: "question" } });
    const conv = start.data.conversation;
    await api({ action: "reply", conversation: conv, clientMsgId: "price-0002", input: { type: "choice", value: "price" } });
    const listed = await api({ action: "reply", conversation: conv, clientMsgId: "price-0003", input: { type: "text", value: "SH-0001" } });
    const text = listed.data.messages.map((m) => m.body).join("\n");
    assert.match(text, /Hermès Kelly 28 Togo is listed on our website at AED\s85,000 \(listing last updated/);
    const start2 = await api({ action: "start", locale: "en", source: "widget", clientMsgId: "price-0101", input: { type: "text", value: "how much is a Rolex Daytona?" } });
    const t2 = start2.data.messages.map((m) => m.body).join("\n");
    assert.match(t2, /won’t guess/);
    assert.doesNotMatch(t2, /AED\s?\d/);
  });
});

describe("private panel", () => {
  it("owner: sees requests (test data only when asked), photo, transcript; records price, assigns, creates an order", async () => {
    const { page, context } = await newPage();
    await page.goto(`${BASE}/admin`);
    await page.waitForURL(/\/admin\/login/);
    assert.deepEqual(await axeViolations(page), []);
    await signIn(page, "owner");
    assert.doesNotMatch(await page.locator(".adm-table-wrap, .adm-empty").innerText(), new RegExp(state.desktopRef), "test data hidden by default");
    await page.goto(`${BASE}/admin?test=1&q=${state.desktopRef}`);
    await page.getByRole("link", { name: state.desktopRef }).click();
    await page.waitForURL(/\/admin\/requests\//);
    const img = page.locator(".adm-photos img").first();
    await img.waitFor();
    assert.ok(await img.evaluate((el) => el.complete && el.naturalWidth > 0), "photo loads through the signed link");
    assert.match(await page.locator("body").innerText(), /Hermès/);
    await page.getByText(/Show the chat/).click();
    assert.match(await page.locator(".adm-transcript").innerText(), /Birkin 25/);
    assert.match(await page.locator("body").innerText(), /Email:\s*Sent/);
    assert.match(await page.locator("body").innerText(), /WhatsApp:\s*Needs connection/);

    await page.locator("select[name=status]").selectOption("awaiting_approval");
    await page.locator("select[name=assigned_to]").selectOption({ label: "Test Staff" });
    await page.locator("input[name=next_action]").fill("Confirm price with supplier");
    await page.locator("input[name=follow_up_at]").fill("2026-10-08T11:00");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await page.getByText("Saved.").waitFor();
    await page.getByText("Record a confirmed price / availability").click();
    await page.locator("input[name=amount]").fill("82,500");
    await page.getByRole("button", { name: "Record as approved" }).click();
    await page.getByText("Price / availability recorded.").waitFor();
    await page.reload();
    assert.match(await page.locator("body").innerText(), /AED\s82,500/, "kept after reload");
    assert.equal(await page.locator("input[name=next_action]").inputValue(), "Confirm price with supplier");

    await page.getByRole("link", { name: "Create an order" }).click();
    await page.locator("input[name=total]").fill("82500");
    await page.locator("input[name=contact_email]").fill("buyer@test.local");
    await page.getByRole("button", { name: "Create order" }).click();
    await page.getByText("Order created.").waitFor();
    state.orderRef = (await page.locator("h1").innerText()).match(/ORD-[A-Z0-9]{6}/)[0];
    state.orderUrl = page.url();
    const [r] = await sql("select status from public.requests where reference = $1", [state.desktopRef]);
    assert.equal(r.status, "converted");
    const audit = await sql("select action, actor_label from public.audit_log where entity_id = $1 order by id", [state.desktopRequestId]);
    assert.ok(audit.some((a) => a.action === "request.updated" && a.actor_label === "Test Owner"));
    assert.ok(audit.some((a) => a.action === "price.approved"));
    state.ownerCookies = await context.cookies();
    await context.close();
  });

  it("owner adds a team member, who sets up access by e-mail confirmation", async () => {
    const { page, context } = await newPage();
    await context.addCookies(state.ownerCookies);
    await page.goto(`${BASE}/admin/team`);
    await page.locator("form input[name=email]").first().fill("new.staff@test.local");
    await page.locator("input[name=display_name]").fill("New Staff");
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByText(/They can now set up their access/).waitFor();
    await context.clearCookies();
    await page.goto(`${BASE}/admin/setup`);
    await page.locator("input[name=email]").fill("new.staff@test.local");
    await page.locator("input[name=password]").fill("new-staff-password-123");
    await page.locator("input[name=confirm]").fill("new-staff-password-123");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText(/confirmation email is on its way/).waitFor();
    // Someone not on the team gets the same answer and no account.
    await page.locator("input[name=email]").fill("stranger@test.local");
    await page.locator("input[name=password]").fill("stranger-password-123");
    await page.locator("input[name=confirm]").fill("stranger-password-123");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText(/confirmation email is on its way/).waitFor();
    assert.equal((await sql("select count(*)::int as n from auth.users where email = 'stranger@test.local'"))[0].n, 0);
    const link = (await mail()).find((m) => m.to.includes("new.staff@test.local")).raw;
    await page.goto(link);
    await page.waitForURL(/\/admin\/login\?ok=confirmed/);
    await page.locator("input[name=email]").first().fill("new.staff@test.local");
    await page.locator("input[name=password]").fill("new-staff-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE}/admin`);
    assert.match(await page.locator(".adm-top").innerText(), /New Staff\s*Staff/);
    await context.close();
  });

  it("staff: see every customer and order, can follow up, but the server refuses owner-only actions", async () => {
    const { page, context } = await newPage();
    await signIn(page, "staff");
    const nav = await page.locator(".adm-nav").innerText();
    assert.doesNotMatch(nav, /Team|Store knowledge/);
    await page.goto(`${BASE}/admin/customers?test=1`);
    assert.match(await page.locator(".adm-table").innerText(), /Layla Test/);
    await page.goto(`${BASE}/admin/team`);
    await page.waitForURL(/\/admin\?error=owner_only/);
    await page.goto(`${BASE}/admin/knowledge`);
    await page.waitForURL(/\/admin\?error=owner_only/);

    // Export is refused even with a hand-made request.
    const exp = await page.request.post(`${BASE}/admin/export`, { form: { kind: "customers" }, headers: { origin: BASE } });
    assert.equal(exp.status(), 403);

    // The request page has no owner-only controls; forcing one through the form is refused by the server.
    await page.goto(`${BASE}/admin/requests/${state.desktopRequestId}`);
    const body = await page.locator("body").innerText();
    assert.doesNotMatch(body, /Record a confirmed price|Delete this request|Create an order/);
    await page.evaluate(() => {
      const sel = document.querySelector("select[name=status]");
      sel.add(new Option("forced", "converted"));
      sel.value = "converted";
    });
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await page.getByText("Only the owner can do that.").waitFor();

    // And directly against the database API with the staff member's own session.
    const token = (await context.cookies()).find((c) => c.name === "__Host-sh_at").value;
    const direct = await fetch(`${GW}/rest/v1/rpc/admin_record_price`, {
      method: "POST",
      headers: { apikey: "sb_publishable_local_test_key", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ p_request: state.desktopRequestId, p_item: "x", p_amount: 1, p_currency: "AED", p_availability: "available", p_valid_until: null, p_note: null }),
    });
    assert.match(JSON.stringify(await direct.json()), /owner_only/);
    const update = await fetch(`${GW}/rest/v1/requests?id=eq.${state.desktopRequestId}`, {
      method: "PATCH",
      headers: { apikey: "sb_publishable_local_test_key", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    assert.equal(update.status, 403, "no direct table writes");

    // Allowed: delivery details on the order, and a call result.
    await page.goto(state.orderUrl);
    await page.locator("select[name=fulfilment_status]").selectOption("shipped");
    await page.locator("input[name=carrier]").fill("Aramex");
    await page.locator("input[name=tracking_number]").fill("AX123456");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Saved.").waitFor();
    assert.doesNotMatch(await page.locator("body").innerText(), /Owner only/);
    await page.goto(`${BASE}/admin/requests/${state.desktopRequestId}`);
    await page.locator("select[name=outcome]").selectOption("no_answer");
    await page.getByRole("button", { name: "Log call" }).click();
    await page.getByText("Call result recorded.").waitFor();
    await context.close();
  });

  it("order status in the chat: only after a code sent to the order's e-mail; never to someone else", async () => {
    const { page, context } = await newPage();
    await page.goto(`${BASE}/chat`);
    await page.locator(".cc__msg--assistant").first().waitFor();
    await pick(page, "Follow up on an order");
    await answer(page, state.orderRef.toLowerCase());
    assert.match(await lastAssistant(page), /6-digit code/);
    const codeMail = await eventually(async () => (await mail()).find((m) => m.to.includes("buyer@test.local")));
    const code = codeMail.raw.match(/is (\d{6})\./)[1];
    await answer(page, code === "000000" ? "111111" : "000000");
    assert.match(await lastAssistant(page), /attempts? left/);
    assert.doesNotMatch(await page.locator(".cc__log").innerText(), /Aramex/);
    await answer(page, code);
    await page.getByText(/you’re verified/).waitFor();
    const log = await page.locator(".cc__log").innerText();
    assert.match(log, /Shipped/);
    assert.match(log, /Aramex AX123456/);
    assert.doesNotMatch(log, /supplier|Confirm price/i, "no internal notes");
    assert.doesNotMatch(log, new RegExp(code), "the code is not echoed in the transcript");
    await context.close();

    // A different visitor who knows the order reference sees nothing without the code.
    const other = await api({ action: "start", locale: "en", source: "widget", clientMsgId: "other-0001", input: { type: "choice", value: "order" } });
    const c = other.data.conversation;
    await api({ action: "reply", conversation: c, clientMsgId: "other-0002", input: { type: "text", value: state.orderRef } });
    const guess = await api({ action: "reply", conversation: c, clientMsgId: "other-0003", input: { type: "text", value: code } });
    const t = guess.data.messages.map((m) => m.body).join(" ");
    assert.doesNotMatch(t, /Aramex|Shipped|82,500/);
  });

  it("an e-mail failure keeps the request, shows the error in the panel, and can be retried", async () => {
    await fetch(`${GW}/__test/smtp-fail?on=1`);
    const s = await api({ action: "start", locale: "en", source: "widget", clientMsgId: "fail-0001", input: { type: "choice", value: "callback" } });
    const conv = s.data.conversation;
    let i = 2;
    let last;
    for (const input of [{ type: "choice", value: "skip" }, { type: "choice", value: "skip" }, { type: "text", value: "+44 7700 900104" }, { type: "choice", value: "whatsapp" }, { type: "submit", consent: true }]) {
      last = await api({ action: "reply", conversation: conv, clientMsgId: `fail-000${i++}`, input });
    }
    const ref = last.data.submitted.reference;
    assert.match(last.data.messages.at(-1).body, /Your request has been received/, "the customer is told the truth: the request is saved");
    const [req] = await sql("select id from public.requests where reference = $1", [ref]);
    const failed = await eventually(async () => (await sql("select status, last_error from public.notifications where request_id = $1 and channel = 'email' and status = 'failed'", [req.id]))[0]);
    assert.match(failed.last_error, /550|Mailbox unavailable/);
    await fetch(`${GW}/__test/smtp-fail?on=0`);

    const { page, context } = await newPage();
    await context.addCookies(state.ownerCookies);
    await page.goto(`${BASE}/admin/requests/${req.id}`);
    assert.match(await page.locator("body").innerText(), /Email:\s*Failed/);
    assert.equal(await page.locator("li", { hasText: "WhatsApp:" }).getByRole("button", { name: "Try again" }).count(), 0, "no retry for a channel that isn't connected");
    await page.locator("li", { hasText: "Email:" }).getByRole("button", { name: "Try again" }).click();
    await page.getByText(/Notification sent again/).waitFor();
    assert.match(await page.locator("body").innerText(), /Email:\s*Sent/);
    await context.close();
  });
});

describe("the rest of the site", () => {
  it("home, collection, item panel and sourcing still work; the chat shows when it is unavailable", async () => {
    const { page, context } = await newPage();
    for (const path of ["/", "/collection", "/collection?item=SH-0001", "/chat"]) {
      const res = await page.goto(`${BASE}${path}`);
      assert.equal(res.status(), 200, path);
    }
    await page.goto(`${BASE}/collection?item=SH-0001`);
    assert.match(await page.locator("dialog[open]").innerText(), /Kelly 28 Togo/);
    await page.goto(BASE);
    const wa = await page.locator(".wa-float").getAttribute("href");
    assert.match(wa, /^https:\/\/wa\.me\/971528877200\?text=/);
    // With a site panel open, both floating buttons step aside.
    await page.locator(".site-footer").getByRole("button", { name: "Private sourcing" }).click();
    await page.locator("dialog[open]").waitFor();
    assert.equal(await page.locator(".cc-launcher").isVisible(), false);
    await context.close();

    // Where the chat can't take requests, its button and footer link are not shown at all, and the
    // /chat page says so honestly with WhatsApp and phone instead.
    const { page: p2, context: c2 } = await newPage();
    // (/collection renders per request; the home page is pre-rendered from the shared build.)
    await p2.goto(`${UNAVAILABLE_BASE}/collection`);
    assert.equal(await p2.locator(".cc-launcher").count(), 0);
    assert.equal(await p2.locator(".site-footer a[href='/chat']").count(), 0);
    await p2.goto(`${UNAVAILABLE_BASE}/chat`);
    await p2.getByText("The online concierge isn’t available right now.").waitFor();
    assert.match(await p2.locator(".cc__unavailable a").first().getAttribute("href"), /wa\.me\/971528877200/);
    await c2.close();
    assert.deepEqual(consoleErrors, [], "no browser console errors");
  });
});
