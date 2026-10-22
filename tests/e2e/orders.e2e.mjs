// End-to-end checks of the order lifecycle: online checkout with the local test payment provider,
// the verified webhook, the customer's private order page, the team's work in the panel (check,
// packing, handover, delivery) and a return request. Local test stack and a production build only
// (tests/e2e/run.sh); test data only. Phone numbers are in the Ofcom drama range.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.E2E_BASE ?? "http://localhost:3300";
const GW = process.env.E2E_GW ?? "http://127.0.0.1:54320";
const SECRET = "local-payments-test-secret-0123456789abcdef";
const sql = async (q, params = []) => (await fetch(`${GW}/__test/sql`, { method: "POST", body: JSON.stringify({ sql: q, params }) })).json();
const refresh = () => fetch(`${BASE}/api/revalidate`, { method: "POST", headers: { "x-revalidate-secret": "local-revalidate-secret" } });
const mail = async () => (await fetch(`${GW}/__test/mail`)).json();
/** A subject as written: MIME encoded-words (used when it has characters like "·") decoded. */
const subject = (m) =>
  m.subject.replace(/\?=\s+=\?/g, "?==?").replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, enc, text) =>
    enc.toUpperCase() === "B"
      ? Buffer.from(text, "base64").toString("utf8")
      : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"));
/** The raw message with quoted-printable soft breaks and escapes undone (enough to read links and words). */
const plain = (m) => m.raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** What the payment provider would send, signed like the test provider expects. */
async function webhook(events, { sign = true } = {}) {
  const body = JSON.stringify({ events });
  const signature = createHmac("sha256", sign ? SECRET : "wrong-secret-wrong-secret-wrong-secret").update(body).digest("hex");
  const res = await fetch(`${BASE}/api/payments/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-test-signature": signature }, body });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let browser;
const consoleErrors = [];
const dir = mkdtempSync(join(tmpdir(), "sh-orders-"));
const photo = join(dir, "piece.jpg");
const state = {};

before(async () => {
  browser = await chromium.launch();
  await sharp({ create: { width: 1200, height: 1500, channels: 3, background: "#d9cfc1" } }).jpeg().toFile(photo);
  const [owner] = await sql("select id from public.staff_members where role = 'owner' limit 1");
  for (const statement of [
    "insert into public.products (ref, published, status, name, category, brand, price_aed, stock, delivery, listed_at) values ('SH-9001', true, 'available', 'Picotin Lock 18', 'bags', 'Hermès', 42000, 1, 'Dispatched within 2 working days', '2026-10-20')",
    "update public.shop_settings set vat_rate_percent = 5, prices_include_vat = true, change_of_mind_days = 7, customer_emails_enabled = true",
    "insert into public.shipping_zones (name, fee_aed, transit_days_min, transit_days_max, vat_treatment, duties_treatment) values ('E2E UAE', 50, 1, 2, 'standard', 'not_applicable')",
    "insert into public.shipping_zone_countries (country, zone_id) select 'AE', id from public.shipping_zones where name = 'E2E UAE'",
  ]) await sql(statement);
  for (const kind of ["terms_of_sale", "returns"]) {
    await sql("insert into public.policy_versions (kind, version, title, body, status, approved_by, approved_at) values ($1, 'e2e-1', $2, 'Test text only.', 'approved', $3, now())", [kind, kind === "returns" ? "Returns policy" : "Terms of sale", owner.id]);
  }
  assert.equal((await refresh()).status, 200);
});

after(async () => {
  // Leave the stack as the other suites expect it: no online payment.
  for (const statement of [
    "update public.policy_versions set status = 'retired' where version = 'e2e-1'",
    "delete from public.shipping_zones where name = 'E2E UAE'",
    "update public.shop_settings set vat_rate_percent = null, prices_include_vat = null, customer_emails_enabled = false",
    "update public.products set published = false where ref = 'SH-9001'",
  ]) await sql(statement);
  await refresh();
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

async function signIn(page, who) {
  const users = JSON.parse(readFileSync(join(process.env.STACK_DIR, "users.json"), "utf8"));
  await page.goto(`${BASE}/admin/login`);
  await page.locator("input[name=email]").first().fill(users[who].email);
  await page.locator("input[name=password]").fill(users[who].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/admin`);
}

describe("orders", () => {
  it("phone checkout: real totals, the customer accepts the terms and pays on the provider's page", async () => {
    const { page, context } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/product/SH-9001`);
    await page.getByRole("button", { name: "Add to bag" }).click();
    await page.locator("dialog[open]").getByRole("link", { name: "Checkout" }).click();
    await page.waitForURL(`${BASE}/checkout`);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/Full name/).fill("E2E Payer");
    await page.locator("input[type=tel]").fill("+44 7700 900777");
    await page.locator(".checkout input[type=email]").fill("payer@example.test");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/City or emirate/).fill("Dubai");
    await page.getByLabel(/^Address/).fill("Test villa, Test street");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /Pay AED\s42,050 securely/ }).waitFor();
    const summary = await page.locator(".checkout__summary").innerText();
    assert.match(summary, /AED\s42,000/);
    assert.match(summary, /AED\s50/);
    assert.match(summary, /Includes 5%: AED\s2,002\.38/);
    assert.match(summary, /AED\s42,050/);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, "no sideways scroll on a phone");
    await page.getByRole("button", { name: /Pay AED/ }).click();
    await page.getByText(/Please confirm we may contact you/).waitFor();
    await page.getByLabel(/accept the/).check();
    await page.getByRole("button", { name: /Pay AED/ }).click();
    // The test provider "pays" by sending the browser straight back to the order page.
    await page.waitForURL(`${BASE}/order`);
    await page.getByText(/confirming your payment/).waitFor();
    const text = await page.locator(".order-page").innerText();
    assert.match(text, /Order\s+ORD-[A-Z0-9]{6}/);
    assert.doesNotMatch(text, /Payment\s*Paid/, "a redirect is not proof of payment");
    state.reference = text.match(/ORD-[A-Z0-9]{6}/)[0];
    state.token = await page.evaluate(() => sessionStorage.getItem("sevn-hevn-order-token"));
    assert.match(state.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(new URL(page.url()).hash, "", "the token is taken out of the address bar");
    const [o] = await sql("select id, status, payment_status, total_amount::text as total from public.orders where reference = $1", [state.reference]);
    assert.deepEqual([o.status, o.payment_status, o.total], ["awaiting_confirmation", "pending", "42050.00"]);
    const [hold] = await sql("select count(*)::int n from public.stock_reservations where order_id = $1 and status = 'active'", [o.id]);
    assert.equal(hold.n, 1, "the piece is held while the customer pays");
    state.orderId = o.id;
    state.page = page;
    state.context = context;
  });

  it("only a signed provider event marks it paid; retries change nothing; the page updates by itself", async () => {
    const [pay] = await sql("select id, provider_session_id from public.payments where order_id = $1", [state.orderId]);
    const event = { id: `evt_${randomUUID()}`, type: "payment_succeeded", sessionId: pay.provider_session_id, amount: 42050, currency: "AED", paymentRef: "pi_e2e_1" };
    assert.equal((await webhook([event], { sign: false })).status, 400, "a bad signature is refused");
    assert.equal((await sql("select payment_status from public.orders where id = $1", [state.orderId]))[0].payment_status, "pending");
    const first = await webhook([event]);
    assert.deepEqual([first.status, first.body.outcomes], [200, ["applied"]]);
    const again = await webhook([event]);
    assert.deepEqual(again.body.outcomes, ["duplicate"]);
    const [o] = await sql("select status, payment_status, amount_paid::text as paid from public.orders where id = $1", [state.orderId]);
    assert.deepEqual([o.status, o.payment_status, o.paid], ["confirmed", "paid", "42050.00"]);
    assert.equal((await sql("select stock, status from public.products where ref = 'SH-9001'"))[0].status, "sold");
    await state.page.locator(".order-page__status").getByText("Paid").waitFor({ timeout: 15000 });
    await state.page.locator(".order-page__status").getByText("Confirmed").waitFor();
    // Team alert and customer e-mail, each once; the customer's carries a fresh private link.
    let inbox = [];
    for (let i = 0; i < 20 && !inbox.some((m) => /Your order .* is confirmed/.test(subject(m))); i++) {
      await new Promise((r) => setTimeout(r, 500));
      inbox = await mail();
    }
    const customer = inbox.filter((m) => subject(m).includes(`Your order ${state.reference} is confirmed`));
    assert.equal(customer.length, 1);
    assert.match(plain(customer[0]), /\/order#t=[A-Za-z0-9_-]{43}/);
    assert.doesNotMatch(plain(customer[0]), /42,050|Picotin/, "details stay on the private page");
    const team = inbox.filter((m) => subject(m).includes(`Order ${state.reference} · Order confirmed`));
    assert.equal(team.length, 1);
    assert.doesNotMatch(plain(team[0]).split(/\r?\n\r?\n/).slice(1).join("\n"), /payer@example\.test|7700 ?900777/, "no customer details in team alerts");
    await state.context.close();
  });

  it("someone with only the order number sees nothing", async () => {
    const { page, context } = await newPage();
    await page.goto(`${BASE}/order#t=${"A".repeat(43)}`);
    await page.getByText(/This link doesn’t open an order/).waitFor();
    const res = await page.evaluate(async (ref) => (await fetch("/api/order", { method: "POST", body: JSON.stringify({ token: ref, action: "view" }) })).status, state.reference);
    assert.equal(res, 404);
    await context.close();
  });

  it("the team checks, packs and hands over with evidence; delivered needs the carrier's proof", async () => {
    const { page, context } = await newPage();
    await signIn(page, "staff");
    await page.goto(`${BASE}/admin/orders?test=1`);
    await page.getByText("Pieces to check").waitFor();
    await page.getByRole("link", { name: state.reference }).first().click();
    await page.waitForURL(new RegExp(`/admin/orders/${state.orderId}`));
    assert.equal(await page.getByText("Approve a refund").count(), 0, "refunds are for the owner");
    assert.equal(await page.getByRole("button", { name: "Cancel the order" }).count(), 0, "cancelling is for the owner");

    // A check can't pass without a photo of the piece.
    await page.getByText("Record a check").click();
    await page.getByLabel(/Condition is as described/).check();
    await page.getByRole("button", { name: "Passed" }).click();
    await page.waitForURL(/error=photo_required/);
    await page.locator("#checks .adm-upload input[type=file]").first().setInputFiles(photo);
    await page.locator("#checks").getByText("Photo of the piece").waitFor({ timeout: 15000 });
    await page.getByText("Record a check").click();
    await page.getByLabel(/Condition is as described/).check();
    await page.getByRole("button", { name: "Passed" }).click();
    await page.waitForURL(/ok=check_recorded/);

    await page.getByText("New shipment").click();
    await page.locator("#shipments input[name=item]").first().check();
    await page.locator("#shipments input[name=carrier]").last().fill("Aramex");
    await page.locator("#shipments input[name=tracking_number]").last().fill("AX-E2E-1");
    await page.locator("#shipments select[name=insurance]").last().selectOption("carrier");
    await page.locator("#shipments input[name=coverage_confirmed]").last().check();
    await page.locator("#shipments textarea[name=packed_contents]").last().fill("Picotin Lock 18, dust bag, box");
    await page.locator("#shipments input[name=label_created]").last().check();
    await page.getByRole("button", { name: "Create the shipment" }).click();
    await page.waitForURL(/ok=saved/);
    assert.equal((await sql("select fulfilment_status from public.orders where id = $1", [state.orderId]))[0].fulfilment_status, "quality_check", "a label is not shipped");
    await page.getByRole("button", { name: "Handed to the carrier" }).click();
    await page.waitForURL(/error=photo_required/);
    await page.locator("#shipments .adm-upload input[type=file]").first().setInputFiles(photo);
    await page.locator("#shipments").getByText("Packing").first().waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Handed to the carrier" }).click();
    await page.waitForURL(/ok=handed_over/);
    assert.equal((await sql("select fulfilment_status from public.orders where id = $1", [state.orderId]))[0].fulfilment_status, "shipped");

    await page.getByText("Carrier update").click();
    await page.locator("#shipments select[name=status]").selectOption("delivered");
    await page.locator("#shipments").getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/error=evidence_required/);
    await page.getByText("Carrier update").click();
    await page.locator("#shipments select[name=status]").selectOption("delivered");
    await page.locator("#shipments input[name=note]").fill("POD AX-E2E-1, signed by the recipient");
    await page.locator("#shipments").getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/ok=saved/);
    const [o] = await sql("select status, fulfilment_status from public.orders where id = $1", [state.orderId]);
    assert.deepEqual([o.status, o.fulfilment_status], ["completed", "delivered"]);
    await context.close();
  });

  it("the customer sees the delivery and requests a return; the owner reviews it", async () => {
    const { page, context } = await newPage();
    await page.goto(`${BASE}/order#t=${state.token}`);
    await page.locator(".order-page__status").getByText("Delivered").waitFor();
    assert.match(await page.locator(".order-page").innerText(), /AX-E2E-1/);
    await page.getByRole("button", { name: "Request a return" }).click();
    await page.getByLabel("Picotin Lock 18").check();
    await page.getByLabel("Why?").selectOption("change_of_mind");
    await page.getByLabel("Tell us more").fill("Not the size I hoped");
    assert.match(await page.locator(".order-page").innerText(), /within 7 days of delivery/);
    await page.getByRole("button", { name: "Send the return request" }).click();
    await page.getByText(/Your return request has been sent/).waitFor();
    await page.getByText(/Received, waiting for review/).waitFor();
    const [r] = await sql("select reference, status, reason, eligibility from public.returns where order_id = $1", [state.orderId]);
    assert.deepEqual([r.status, r.reason, r.eligibility.change_of_mind_in_window], ["requested", "change_of_mind", true]);
    await context.close();

    const owner = await newPage();
    await signIn(owner.page, "owner");
    await owner.page.goto(`${BASE}/admin/orders?test=1`);
    await owner.page.getByText("Returns to review").waitFor();
    assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
    await owner.context.close();
  });
});
