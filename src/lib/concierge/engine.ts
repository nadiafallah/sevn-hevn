/**
 * The concierge conversation: a small, deterministic state machine that asks one question at a
 * time, skips anything the customer has already said, and never states a price, stock level,
 * delivery promise or policy that does not come from approved data (Deps).
 *
 * It is pure apart from the injected Deps, so the same logic serves the floating widget and the
 * /chat page, and it can be tested without a database or network.
 */
import { extract, hasEnoughDetail, detectIntent, findItemRef, normaliseOrderRef, matchChoice, YES, NO, type CategoryKey, type Extracted, type Intent, type Topic } from "./detect";
import { countryName, matchCountry } from "./countries";
import { isEmail, parsePhone, type Phone } from "./phone";
import { ltr, t, type ContactMethod, type Locale, type RequestType } from "./i18n";
import { menuPrompt } from "./intro";
import type { Choice, Prompt } from "./types";

export type { Choice, Prompt };

export type Step =
  | "menu"
  | "src_describe" | "src_photo_confirm" | "src_category" | "src_brand" | "src_details" | "src_budget"
  | "src_destination" | "src_destination_other" | "src_timing"
  | "q_topic" | "q_item" | "q_after_item" | "q_destination" | "q_destination_other" | "q_text" | "q_followup"
  | "ord_ref" | "ord_code"
  | "cb_topic"
  | "c_name" | "c_phone" | "c_method" | "c_email" | "c_review" | "c_edit"
  | "done";

export interface Draft extends Extracted {
  intent?: Intent;
  description?: string;
  details?: string;
  budget?: string;
  timing?: string;
  destination?: { code?: string; label: string };
  topic?: Topic;
  question?: string;
  itemRef?: string;
  itemName?: string;
  orderRef?: string;
  needsReview?: "price" | "availability" | "shipping" | "authenticity" | "returns" | "order" | "other";
  name?: string;
  phone?: Phone;
  method?: ContactMethod;
  email?: string;
  photos: number;
  photoHint?: string;
  aiUsed?: boolean;
}

export interface State {
  v: 1;
  locale: Locale;
  step: Step;
  /** Increases with every new request in the same conversation (part of the idempotency key). */
  flow: number;
  asked: Step[];
  draft: Draft;
  returnTo?: "c_review";
  afterHint?: Step;
  countryTries?: number;
  contactIntro?: boolean;
  submitted?: { reference: string; id: string };
}

export type Input =
  | { type: "text"; value: string }
  | { type: "choice"; value: string }
  | { type: "submit"; consent: boolean }
  | { type: "locale"; value: Locale }
  | { type: "restart" }
  | { type: "human" }
  | { type: "photo"; hint?: string };

export interface ItemInfo {
  ref: string;
  name: string;
  brand?: string;
  category?: string;
  status: "editorial_preview" | "enquiry_only" | "available" | "reserved" | "sold";
  priceAED?: number;
  /** When the listing (and so its price) was last changed. */
  updatedAt?: string;
}

export interface KnowledgeAnswer {
  title: string;
  body: string;
  /** The entry is in English although the conversation is in Arabic. */
  english: boolean;
}

export type VerifyResult =
  | { ok: true; order: VerifiedOrder }
  | { ok: false; reason: "invalid" | "locked" | "expired"; attemptsLeft?: number };

export interface VerifiedOrder {
  reference: string;
  status: string;
  currency: string;
  total_amount: number | string;
  payment_status: string;
  fulfilment_status: string;
  carrier?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  customer_note?: string | null;
  updated_at: string;
  items: { description: string; brand?: string | null; quantity: number }[];
}

export interface SubmitPayload {
  idempotency_key: string;
  type: RequestType;
  summary: string;
  details: Record<string, string | number | boolean>;
  needs_review: string | null;
  locale: Locale;
  destination_country: string | null;
  destination_label: string | null;
  contact_name: string | null;
  contact_phone: string;
  contact_email: string | null;
  contact_method: ContactMethod;
  contact_consent: true;
  consent_text: string;
}

export interface AiExtraction extends Extracted {
  budget?: string;
  destinationCountry?: string;
  timing?: string;
}

export interface Deps {
  conversationId: string;
  phoneDisplay: string;
  /** Listings older than this are not quoted (price may be stale). */
  priceMaxAgeDays: number;
  now(): Date;
  lookupItem(ref: string): Promise<ItemInfo | null>;
  knowledge(topic: string, country: string | undefined, locale: Locale): Promise<KnowledgeAnswer | null>;
  submit(payload: SubmitPayload): Promise<{ reference: string; id: string }>;
  /** True only when a verification code can actually be delivered (e-mail configured). */
  orderVerification: boolean;
  startOrderCheck(ref: string): Promise<void>;
  verifyOrderCode(ref: string, code: string): Promise<VerifyResult>;
  ai?: (text: string, locale: Locale) => Promise<AiExtraction | null>;
}

export interface Turn {
  state: State;
  /** What the customer said, as shown in the transcript (undefined for silent actions). */
  customer?: string;
  assistant: string[];
  prompt: Prompt;
  submitted?: { reference: string; id: string };
}

const CATEGORIES: CategoryKey[] = ["bags", "watches", "shoes", "accessories", "other"];
const TOPICS: Topic[] = ["price", "authenticity", "shipping", "returns", "other"];
const METHODS: ContactMethod[] = ["whatsapp", "call", "email"];
const TIMINGS = ["asap", "month", "flexible"];
const LIMIT = { long: 1000, short: 200, name: 80, phone: 40, email: 254 };

// ── Prompts ──────────────────────────────────────────────────────────────────────────

const choice = (id: string, label: string, href?: string): Choice => ({ id, label, ...(href ? { href } : {}) });

function prompt(kind: Prompt["kind"], opts: Partial<Prompt> = {}): Prompt {
  return { kind, choices: [], allowPhoto: false, multiline: false, maxLength: LIMIT.short, ...opts };
}

function reviewRows(s: State) {
  const L = t(s.locale);
  const d = s.draft;
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value?: string) => {
    if (value && value.trim()) rows.push({ label, value: value.trim() });
  };
  add(L.labels.type, L.types[requestType(d)]);
  if (d.intent === "sourcing") add(L.labels.description, d.description);
  else add(L.labels.question, d.question || (d.topic ? L.topics[d.topic] : undefined));
  if (d.category && d.intent === "sourcing") add(L.labels.category, L.categories[d.category]);
  add(L.labels.brand, d.brand);
  add(L.labels.details, [d.model, d.colour, d.size, d.year, d.details].filter(Boolean).join(" · "));
  add(L.labels.piece, d.itemRef ? [d.itemName, d.itemRef].filter(Boolean).join(" · ") : undefined);
  add(L.labels.order, d.orderRef);
  add(L.labels.budget, d.budget);
  add(L.labels.destination, d.destination?.label);
  add(L.labels.timing, d.timing ? (L.timing[d.timing] ?? d.timing) : undefined);
  add(L.labels.photos, d.photos ? String(d.photos) : undefined);
  add(L.labels.name, d.name);
  add(L.labels.phone, d.phone?.display);
  add(L.labels.method, d.method ? L.methods[d.method] : undefined);
  add(L.labels.email, d.email);
  return rows;
}

/** The question for a step and the input it expects. */
function ask(s: State): { text?: string; prompt: Prompt } {
  const L = t(s.locale);
  const d = s.draft;
  const skip = choice("skip", L.ui.skip);
  switch (s.step) {
    case "menu":
      return { text: L.a.menu, prompt: menuPrompt(s.locale) };
    case "src_describe":
      return { text: L.a.describe, prompt: prompt("text", { allowPhoto: true, multiline: true, maxLength: LIMIT.long }) };
    case "src_photo_confirm":
      return { text: L.a.photoHint(d.photoHint ?? ""), prompt: prompt("choices", { choices: [choice("yes", L.a.photoHintYes), choice("no", L.a.photoHintNo)] }) };
    case "src_category":
      return { text: L.a.category, prompt: prompt("choices", { choices: CATEGORIES.map((c) => choice(c, L.categories[c])) }) };
    case "src_brand":
      return { text: L.a.brand, prompt: prompt("text", { choices: [choice("skip", L.a.notSure)], maxLength: LIMIT.name }) };
    case "src_details":
      return { text: L.a.details[d.category ?? "other"] ?? L.a.details.other, prompt: prompt("text", { choices: [skip], allowPhoto: true, maxLength: LIMIT.short }) };
    case "src_budget":
      return { text: L.a.budget, prompt: prompt("text", { choices: [choice("skip", L.a.budgetSkip)], maxLength: 80 }) };
    case "src_destination":
    case "q_destination":
      return { text: L.a.destination, prompt: prompt("choices", { choices: [choice("AE", L.a.uae), choice("other", L.a.otherCountry)], maxLength: 60 }) };
    case "src_destination_other":
    case "q_destination_other":
      return { text: L.a.whichCountry, prompt: prompt("text", { maxLength: 60 }) };
    case "src_timing":
      return { text: L.a.timing, prompt: prompt("choices", { choices: [...TIMINGS.map((x) => choice(x, L.timing[x])), skip], maxLength: 80 }) };
    case "q_topic":
      return { text: L.a.topic, prompt: prompt("choices", { choices: TOPICS.map((x) => choice(x, L.topics[x])), maxLength: LIMIT.long }) };
    case "q_item":
      return { text: L.a.item, prompt: prompt("text", { allowPhoto: true, multiline: true, maxLength: LIMIT.long }) };
    case "q_after_item":
      return { prompt: prompt("choices", { choices: [choice("similar", L.a.findSimilar), choice("team", L.a.askTeam)] }) };
    case "q_text":
      return { text: L.a.questionText, prompt: prompt("text", { allowPhoto: true, multiline: true, maxLength: LIMIT.long }) };
    case "q_followup":
      return { text: L.a.followup, prompt: prompt("choices", { choices: [choice("yes", L.a.followupYes), choice("no", L.a.followupNo)] }) };
    case "ord_ref":
      return { text: L.a.orderRef, prompt: prompt("text", { choices: [choice("team", L.a.orderAskTeam)], maxLength: 20 }) };
    case "ord_code":
      return { prompt: prompt("code", { choices: [choice("team", L.a.orderNoCode)], maxLength: 12 }) };
    case "cb_topic":
      return { text: L.a.callbackTopic, prompt: prompt("text", { choices: [skip], allowPhoto: true, multiline: true, maxLength: LIMIT.long }) };
    case "c_name":
      return { text: L.a.name, prompt: prompt("text", { choices: [skip], maxLength: LIMIT.name }) };
    case "c_phone":
      return { text: L.a.phone, prompt: prompt("phone", { maxLength: LIMIT.phone }) };
    case "c_method":
      return { text: L.a.method, prompt: prompt("choices", { choices: METHODS.map((m) => choice(m, L.methods[m])) }) };
    case "c_email":
      return { text: L.a.email, prompt: prompt("email", { maxLength: LIMIT.email }) };
    case "c_review":
      return {
        text: L.a.review,
        prompt: prompt("review", {
          review: { title: L.ui.reviewTitle, rows: reviewRows(s), consent: L.ui.consent, submit: L.ui.submit, edit: L.ui.edit },
        }),
      };
    case "c_edit": {
      const fields = editableFields(s).map(([id, label]) => choice(id, label));
      return { text: L.a.editWhich, prompt: prompt("choices", { choices: [...fields, choice("back", L.a.backToSummary)] }) };
    }
    case "done":
      return {
        prompt: prompt("choices", {
          // "#whatsapp" is resolved by the browser to the site's WhatsApp link.
          choices: [choice("new", L.a.newRequest), choice("whatsapp", L.ui.whatsapp, "#whatsapp")],
        }),
      };
  }
}

function editableFields(s: State): [string, string][] {
  const L = t(s.locale);
  const d = s.draft;
  const f: [string, string][] = [];
  if (d.intent === "sourcing") {
    f.push(["src_describe", L.labels.description]);
    f.push(["src_budget", L.labels.budget]);
    f.push(["src_destination", L.labels.destination]);
    f.push(["src_timing", L.labels.timing]);
  } else if (d.intent === "callback") f.push(["cb_topic", L.labels.question]);
  else if (d.intent === "question" && d.topic === "other") f.push(["q_text", L.labels.question]);
  f.push(["c_name", L.labels.name], ["c_phone", L.labels.phone], ["c_method", L.labels.method]);
  return f;
}

// ── Flow ─────────────────────────────────────────────────────────────────────────────

export function initialState(locale: Locale): State {
  return { v: 1, locale, step: "menu", flow: 1, asked: [], draft: { photos: 0 } };
}

export function begin(locale: Locale): Turn {
  const state = initialState(locale);
  const q = ask(state);
  return { state, assistant: [t(locale).a.greeting, q.text!], prompt: q.prompt };
}

/** The prompt for the current step (used when a conversation is reloaded). */
export function currentPrompt(state: State): Prompt {
  return ask(state).prompt;
}

const asked = (s: State, step: Step) => s.asked.includes(step);

function requestType(d: Draft): RequestType {
  return d.intent === "question" ? "question" : d.intent === "order" ? "order_followup" : d.intent === "callback" ? "callback" : "sourcing";
}

function contactStep(s: State): Step {
  const d = s.draft;
  if (d.name === undefined && !asked(s, "c_name")) return "c_name";
  if (!d.phone) return "c_phone";
  if (!d.method) return "c_method";
  if (d.method === "email" && !d.email) return "c_email";
  return "c_review";
}

function nextStep(s: State): Step {
  const d = s.draft;
  if (s.returnTo) {
    const c = contactStep(s);
    return c === "c_email" || c === "c_phone" || c === "c_method" ? c : "c_review";
  }
  if (d.intent === "sourcing") {
    if (!d.description) return "src_describe";
    if (!d.category && !asked(s, "src_category")) return "src_category";
    if (!d.brand && !asked(s, "src_brand")) return "src_brand";
    if (!hasEnoughDetail(d) && !d.details && !asked(s, "src_details")) return "src_details";
    if (d.budget === undefined && !asked(s, "src_budget")) return "src_budget";
    if (!d.destination && !asked(s, "src_destination")) return "src_destination";
    if (d.timing === undefined && !asked(s, "src_timing")) return "src_timing";
  }
  if (d.intent === "callback" && d.question === undefined && !asked(s, "cb_topic")) return "cb_topic";
  return contactStep(s);
}

function resetFlow(s: State) {
  const keep = s.draft;
  s.flow += 1;
  s.asked = [];
  s.returnTo = undefined;
  s.afterHint = undefined;
  s.countryTries = undefined;
  s.submitted = undefined;
  // Contact details and destination stay known within the conversation; nothing is asked twice.
  s.draft = { photos: 0, name: keep.name, phone: keep.phone, method: keep.method, email: keep.email, destination: keep.destination };
  s.contactIntro = !!keep.phone;
}

function fill(d: Draft, ex: Partial<AiExtraction>) {
  if (ex.category && !d.category) d.category = ex.category;
  if (ex.brand && !d.brand) d.brand = ex.brand.slice(0, 60);
  if (ex.model && !d.model) d.model = ex.model.slice(0, 80);
  if (ex.colour && !d.colour) d.colour = ex.colour.slice(0, 40);
  if (ex.size && !d.size) d.size = ex.size.slice(0, 40);
  if (ex.year && !d.year) d.year = ex.year.slice(0, 10);
}

function notedList(s: State, before: Draft) {
  const d = s.draft;
  const L = t(s.locale);
  const parts = [
    d.brand !== before.brand ? d.brand : undefined,
    d.model !== before.model ? d.model : undefined,
    d.colour !== before.colour ? d.colour : undefined,
    d.size !== before.size ? d.size : undefined,
    d.year !== before.year ? d.year : undefined,
    d.category !== before.category && d.category ? L.categories[d.category] : undefined,
  ].filter(Boolean) as string[];
  return parts.length ? L.a.noted(parts.join(" · ")) : undefined;
}

function money(amount: number | string, currency: string) {
  const n = typeof amount === "string" ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat("en-AE", { style: "currency", currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

function dateLabel(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso));
}

function formatOrder(o: VerifiedOrder, locale: Locale) {
  const L = t(locale).order;
  const w = (s: string) => (locale === "ar" ? ltr(s) : s);
  const lines = [
    L.title(o.reference),
    `${L.statusLabel}: ${L.status[o.status] ?? o.status} · ${L.paymentLabel}: ${L.payment[o.payment_status] ?? o.payment_status} · ${L.deliveryLabel}: ${L.fulfilment[o.fulfilment_status] ?? o.fulfilment_status}`,
  ];
  if (o.carrier || o.tracking_number) lines.push(`${L.trackingLabel}: ${[o.carrier, o.tracking_number && w(o.tracking_number)].filter(Boolean).join(" ")}${o.tracking_url ? ` (${o.tracking_url})` : ""}`);
  if (o.items.length) lines.push(`${L.itemsLabel}: ${o.items.map((i) => `${i.description}${i.brand ? ` (${i.brand})` : ""}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join("; ")}`);
  lines.push(`${L.totalLabel}: ${w(money(o.total_amount, o.currency))}`);
  if (o.customer_note) lines.push(`${L.noteLabel}: ${o.customer_note}`);
  lines.push(`${L.updatedLabel}: ${dateLabel(o.updated_at, locale)}`);
  return lines.join("\n");
}

export function buildSubmission(s: State, conversationId: string): SubmitPayload {
  const d = s.draft;
  const L = t(s.locale);
  const type = requestType(d);
  const summary =
    type === "sourcing"
      ? d.description || [d.brand, d.model].filter(Boolean).join(" ") || L.types.sourcing
      : type === "order_followup"
        ? [d.orderRef, d.question].filter(Boolean).join(" — ") || L.types.order_followup
        : d.question || (d.topic ? L.topics[d.topic] : L.types[type]);
  const details: Record<string, string | number | boolean> = {};
  const put = (k: string, v: string | number | boolean | undefined) => {
    if (v !== undefined && v !== "" && v !== 0) details[k] = v;
  };
  put("category", d.category);
  put("brand", d.brand);
  put("model", d.model);
  put("colour", d.colour);
  put("size", d.size);
  put("year", d.year);
  put("extra_details", d.details);
  put("budget", d.budget);
  put("timing", d.timing);
  put("topic", d.topic);
  put("question", type === "sourcing" ? undefined : d.question);
  put("item_ref", d.itemRef);
  put("item_name", d.itemName);
  put("order_ref", d.orderRef);
  put("photos", d.photos);
  put("ai_assisted", d.aiUsed ? true : undefined);
  return {
    idempotency_key: `${conversationId}:${s.flow}`,
    type,
    summary: summary.slice(0, 2000),
    details,
    needs_review: d.needsReview ?? null,
    locale: s.locale,
    destination_country: d.destination?.code ?? null,
    destination_label: d.destination?.label ?? null,
    contact_name: d.name || null,
    contact_phone: d.phone!.e164,
    contact_email: d.email ?? null,
    contact_method: d.method!,
    contact_consent: true,
    consent_text: L.ui.consent,
  };
}

/** Moves to `step`, adding its question (and the one-time contact introduction). */
function go(s: State, step: Step, out: string[]) {
  const L = t(s.locale);
  if (step.startsWith("c_") && step !== "c_review" && step !== "c_edit" && !s.contactIntro) {
    out.push(L.a.contactIntro);
    s.contactIntro = true;
  }
  s.step = step;
  if (step === "c_review") s.returnTo = undefined;
  if (!s.asked.includes(step)) s.asked.push(step);
  const q = ask(s);
  if (q.text) out.push(q.text);
}

async function answerKnowledge(s: State, topic: Topic, deps: Deps, out: string[]) {
  const L = t(s.locale);
  const d = s.draft;
  const k = await deps.knowledge(topic, d.destination?.code, s.locale).catch(() => null);
  // English text quoted in an Arabic conversation goes in its own message, so it keeps its own direction.
  if (k?.english) out.push(L.a.knowledgeEnglish, `${k.title}:\n${k.body}`);
  else if (k) out.push(L.a.knowledge(k.title, k.body));
  else out.push(L.a.knowledgeMissing);
  if (topic === "shipping" && d.destination) out.push(L.a.shippingCountry(d.destination.label));
  d.needsReview = topic === "price" ? "price" : topic === "other" ? "other" : topic;
  go(s, "q_followup", out);
}

async function answerItem(s: State, text: string, deps: Deps, out: string[]) {
  const L = t(s.locale);
  const d = s.draft;
  d.question = text;
  fill(d, extract(text));
  const ref = findItemRef(text);
  const item = ref ? await deps.lookupItem(ref).catch(() => null) : null;
  if (!item) {
    d.needsReview = "price";
    out.push(L.a.itemUnknown);
    return go(s, nextStep(s), out);
  }
  d.itemRef = item.ref;
  d.itemName = item.name;
  if (item.brand && !d.brand) d.brand = item.brand;
  if (item.category && !d.category && (CATEGORIES as string[]).includes(item.category)) d.category = item.category as CategoryKey;
  const label = item.brand ? `${item.brand} ${item.name}` : item.name;
  if (item.status === "editorial_preview") {
    out.push(L.a.itemEditorial(item.name));
    s.step = "q_after_item";
    return;
  }
  if (item.status === "sold" || item.status === "reserved") {
    out.push(item.status === "sold" ? L.a.itemSold(label) : L.a.itemReserved(label));
    s.step = "q_after_item";
    return;
  }
  const ageDays = item.updatedAt ? (deps.now().getTime() - new Date(item.updatedAt).getTime()) / 86_400_000 : Infinity;
  if (item.priceAED && item.priceAED > 0 && ageDays <= deps.priceMaxAgeDays) {
    out.push(L.a.itemListed(label, money(item.priceAED, "AED"), dateLabel(item.updatedAt!, s.locale)));
    d.needsReview = "availability";
    return go(s, "q_followup", out);
  }
  d.needsReview = "price";
  out.push(item.priceAED ? L.a.itemPriceStale(label) : L.a.itemOnRequest(label));
  return go(s, nextStep(s), out);
}

async function startOrder(s: State, ref: string, deps: Deps, out: string[]) {
  const L = t(s.locale);
  const d = s.draft;
  d.intent = "order";
  d.orderRef = ref;
  if (deps.orderVerification) {
    await deps.startOrderCheck(ref);
    out.push(L.a.orderCodeSent(ref));
    s.step = "ord_code";
    if (!s.asked.includes("ord_code")) s.asked.push("ord_code");
    return;
  }
  d.needsReview = "order";
  out.push(L.a.orderNoVerify(ref));
  go(s, nextStep(s), out);
}

async function describe(s: State, text: string, deps: Deps, out: string[]) {
  const d = s.draft;
  const before = { ...d };
  d.intent = "sourcing";
  d.description = text;
  fill(d, extract(text));
  if (deps.ai) {
    const ai = await deps.ai(text, s.locale).catch(() => null);
    if (ai) {
      const had = JSON.stringify(d);
      fill(d, ai);
      if (ai.budget && d.budget === undefined) d.budget = ai.budget.slice(0, 80);
      if (ai.timing && d.timing === undefined) d.timing = ai.timing.slice(0, 80);
      if (ai.destinationCountry && !d.destination && /^[A-Z]{2}$/.test(ai.destinationCountry)) {
        d.destination = { code: ai.destinationCountry, label: countryName(ai.destinationCountry, s.locale) };
      }
      if (JSON.stringify(d) !== had) d.aiUsed = true;
    }
  }
  const noted = notedList(s, before);
  if (noted) out.push(noted);
  go(s, nextStep(s), out);
}

function setCountry(s: State, code: string | undefined, raw: string) {
  s.draft.destination = code ? { code, label: countryName(code, s.locale) } : { label: raw.slice(0, 120) };
}

/**
 * Applies one customer action. Throws only for unexpected failures; expected problems
 * (invalid phone, unknown country, failed submission, …) are answered in the conversation.
 */
export async function handle(prev: State, input: Input, deps: Deps): Promise<Turn> {
  const s: State = structuredClone(prev);
  const d = s.draft;
  const out: string[] = [];
  let customer: string | undefined;
  let submitted: Turn["submitted"];
  const L = () => t(s.locale);
  const current = ask(s).prompt;
  const reask = () => {
    const q = ask(s);
    if (q.text) out.push(q.text);
  };
  const finish = (): Turn => ({ state: s, customer, assistant: out, prompt: ask(s).prompt, submitted });

  // ── Actions available at any step ──
  if (input.type === "locale") {
    s.locale = input.value;
    reask();
    return finish();
  }
  if (input.type === "restart") {
    customer = L().ui.startOver;
    resetFlow(s);
    s.step = "menu";
    out.push(L().a.restart);
    reask();
    return finish();
  }
  if (input.type === "human") {
    customer = L().ui.human;
    if (s.step === "done") resetFlow(s);
    out.push(L().a.human, L().a.humanDirect(deps.phoneDisplay));
    if (!s.draft.intent || !(s.draft.description || s.draft.question || s.draft.orderRef)) {
      s.draft.intent = "callback";
      if (s.draft.question === undefined) s.draft.question = "";
    }
    s.contactIntro = true;
    go(s, contactStep(s), out);
    return finish();
  }
  if (input.type === "photo") {
    d.photos += 1;
    customer = undefined;
    if (s.step === "menu" || s.step === "done") {
      if (s.step === "done") resetFlow(s);
      s.draft.intent = "sourcing";
      s.step = "src_describe";
      if (!s.asked.includes("src_describe")) s.asked.push("src_describe");
    }
    out.push(L().a.photoReceived);
    if (input.hint && s.draft.intent === "sourcing") {
      s.draft.photoHint = input.hint.slice(0, 200);
      s.draft.aiUsed = true;
      s.afterHint = s.step;
      go(s, "src_photo_confirm", out);
    } else if (s.step === "src_describe" && !s.draft.description) {
      out.push(L().a.photoDescribe);
    }
    return finish();
  }

  // ── Submission ──
  if (input.type === "submit") {
    customer = L().ui.submit;
    if (s.step !== "c_review") {
      out.push(L().a.notUnderstood);
      reask();
      return finish();
    }
    if (!input.consent) {
      out.push(L().a.consentRequired);
      return finish();
    }
    try {
      const res = await deps.submit(buildSubmission(s, deps.conversationId));
      s.submitted = res;
      submitted = res;
      s.step = "done";
      const contact = d.method === "email" && d.email ? d.email : d.phone!.display;
      out.push(L().a.submitted(res.reference, d.method!, contact, d.name || undefined));
    } catch {
      out.push(L().a.submitFailed);
    }
    return finish();
  }

  // ── Answers ──
  const raw = input.value.trim();
  const picked = input.type === "choice" ? current.choices.find((c) => c.id === input.value) : matchChoice(raw, current.choices);
  customer = input.type === "choice" ? (picked?.label ?? raw) : raw;
  if (input.type === "text" && raw.length > current.maxLength) {
    out.push(L().a.tooLong(current.maxLength));
    return finish();
  }
  if (!raw || (input.type === "choice" && !picked)) {
    // Empty input, or a button from an outdated screen: explain and show the current options.
    out.push(L().a.notUnderstood);
    return finish();
  }
  const id = picked?.id;

  switch (s.step) {
    case "menu": {
      if (id === "sourcing") { d.intent = "sourcing"; go(s, "src_describe", out); break; }
      if (id === "question") { d.intent = "question"; go(s, "q_topic", out); break; }
      if (id === "order") { d.intent = "order"; go(s, "ord_ref", out); break; }
      if (id === "callback") { d.intent = "callback"; go(s, "cb_topic", out); break; }
      const { intent, topic } = detectIntent(raw);
      if (intent === "order") {
        const ref = normaliseOrderRef(raw);
        if (ref) await startOrder(s, ref, deps, out);
        else { d.intent = "order"; go(s, "ord_ref", out); }
      } else if (intent === "callback") {
        d.intent = "callback";
        go(s, "cb_topic", out);
      } else if (intent === "question" && topic) {
        d.intent = "question";
        d.topic = topic;
        if (topic === "price") await answerItem(s, raw, deps, out);
        else if (topic === "shipping" && !d.destination) go(s, "q_destination", out);
        else await answerKnowledge(s, topic, deps, out);
      } else {
        await describe(s, raw, deps, out);
      }
      break;
    }

    case "src_describe":
      if (raw.length < 2) { out.push(L().a.notUnderstood); break; }
      if (s.returnTo) {
        // Editing the description: details are re-read from the new wording.
        d.brand = d.model = d.colour = d.size = d.year = undefined;
        d.category = undefined;
      }
      await describe(s, raw, deps, out);
      break;

    case "src_details": {
      if (id === "skip") { go(s, nextStep(s), out); break; }
      d.details = raw.slice(0, LIMIT.short);
      const before = { ...d };
      fill(d, extract(raw));
      const noted = notedList(s, before);
      if (noted) out.push(noted);
      go(s, nextStep(s), out);
      break;
    }

    case "src_photo_confirm": {
      const yes = id === "yes" || (!id && YES.test(raw));
      const no = id === "no" || (!id && NO.test(raw));
      if (!yes && !no) { out.push(L().a.notUnderstood); break; }
      if (yes && d.photoHint) {
        d.description = d.description ? `${d.description} — ${d.photoHint}` : d.photoHint;
        fill(d, extract(d.photoHint));
      }
      d.photoHint = undefined;
      const back = s.afterHint;
      s.afterHint = undefined;
      go(s, back && back !== "src_describe" ? back : nextStep(s), out);
      break;
    }

    case "src_category": {
      const cat = (id as CategoryKey | undefined) ?? extract(raw).category;
      if (!cat || !CATEGORIES.includes(cat)) { out.push(L().a.notUnderstood); reask(); break; }
      d.category = cat;
      go(s, nextStep(s), out);
      break;
    }

    case "src_brand":
      if (id !== "skip") d.brand = extract(raw).brand ?? raw.slice(0, 60);
      go(s, nextStep(s), out);
      break;

    case "src_budget":
      d.budget = id === "skip" ? "" : raw.slice(0, 80);
      go(s, nextStep(s), out);
      break;

    case "src_destination":
    case "q_destination": {
      const other = s.step === "src_destination" ? "src_destination_other" : "q_destination_other";
      if (id === "AE") setCountry(s, "AE", raw);
      else if (id === "other") { go(s, other, out); break; }
      else {
        const code = matchCountry(raw);
        if (!code) {
          out.push(L().a.countryUnknown);
          s.countryTries = 1;
          s.step = other;
          if (!s.asked.includes(other)) s.asked.push(other);
          break;
        }
        setCountry(s, code, raw);
      }
      if (s.step === "q_destination") await answerKnowledge(s, "shipping", deps, out);
      else go(s, nextStep(s), out);
      break;
    }

    case "src_destination_other":
    case "q_destination_other": {
      const code = matchCountry(raw);
      if (!code && (s.countryTries ?? 0) < 1) {
        s.countryTries = (s.countryTries ?? 0) + 1;
        out.push(L().a.countryUnknown);
        break;
      }
      // After a second unmatched answer the customer's own wording is kept for the team.
      setCountry(s, code, raw);
      s.countryTries = undefined;
      if (s.step === "q_destination_other") await answerKnowledge(s, "shipping", deps, out);
      else go(s, nextStep(s), out);
      break;
    }

    case "src_timing":
      d.timing = id === "skip" ? "" : id && TIMINGS.includes(id) ? id : raw.slice(0, 80);
      go(s, nextStep(s), out);
      break;

    case "q_topic": {
      const topic = (id as Topic | undefined) ?? detectIntent(raw).topic;
      d.intent = "question";
      if (!topic) {
        d.topic = "other";
        d.question = raw;
        d.needsReview = "other";
        go(s, nextStep(s), out);
        break;
      }
      d.topic = topic;
      if (topic === "price") go(s, "q_item", out);
      else if (topic === "other") go(s, "q_text", out);
      else if (topic === "shipping" && !d.destination) go(s, "q_destination", out);
      else await answerKnowledge(s, topic, deps, out);
      break;
    }

    case "q_item":
      await answerItem(s, raw, deps, out);
      break;

    case "q_after_item":
      if (id === "similar") {
        d.intent = "sourcing";
        d.description = `${t(s.locale).a.findSimilar}: ${[d.brand, d.itemName].filter(Boolean).join(" ")} (${d.itemRef})`;
        d.needsReview = undefined;
        go(s, nextStep(s), out);
      } else if (id === "team") {
        d.needsReview = "availability";
        go(s, nextStep(s), out);
      } else {
        out.push(L().a.notUnderstood);
      }
      break;

    case "q_text":
      d.question = raw;
      d.needsReview = "other";
      fill(d, extract(raw));
      go(s, nextStep(s), out);
      break;

    case "q_followup": {
      const yes = id === "yes" || (!id && YES.test(raw));
      const no = id === "no" || (!id && NO.test(raw));
      if (yes) go(s, nextStep(s), out);
      else if (no) {
        resetFlow(s);
        out.push(L().a.anythingElse);
        s.step = "menu";
        s.asked.push("menu");
        // The menu question is implied by "anything else?"; only the choices are shown.
      } else {
        // A free-text follow-up is treated as the question for the team.
        d.question = [d.question, raw].filter(Boolean).join(" — ").slice(0, 2000);
        go(s, nextStep(s), out);
      }
      break;
    }

    case "ord_ref": {
      if (id === "team") {
        d.intent = "order";
        d.needsReview = "order";
        go(s, nextStep(s), out);
        break;
      }
      const ref = normaliseOrderRef(raw);
      if (!ref) { out.push(L().a.orderRefInvalid); break; }
      await startOrder(s, ref, deps, out);
      break;
    }

    case "ord_code": {
      if (id === "team") {
        d.needsReview = "order";
        go(s, nextStep(s), out);
        break;
      }
      const code = raw.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\D/g, "");
      if (code.length !== 6) { out.push(L().a.orderCodeFormat); break; }
      customer = "••••••";
      const r = await deps.verifyOrderCode(d.orderRef!, code);
      if (r.ok) {
        out.push(L().a.orderVerified, formatOrder(r.order, s.locale), L().a.anythingElse);
        resetFlow(s);
        s.step = "menu";
      } else if (r.reason === "invalid") {
        out.push(L().a.orderCodeInvalid(r.attemptsLeft ?? 0));
      } else {
        out.push(L().a.orderCodeLocked);
      }
      break;
    }

    case "cb_topic":
      d.question = id === "skip" ? "" : raw;
      if (id !== "skip") fill(d, extract(raw));
      go(s, nextStep(s), out);
      break;

    case "c_name": {
      if (id === "skip") d.name = "";
      else if (/^[+\d\s().-]{6,}$/.test(raw) || /^[+٠-٩\s]{6,}$/.test(raw)) {
        // A number typed instead of a name: treat it as the phone number.
        const asPhone = parsePhone(raw);
        if (!asPhone.ok) {
          out.push(asPhone.reason === "needs_country" ? L().a.phoneNeedsCountry : L().a.phoneInvalid);
          s.step = "c_phone";
          if (!s.asked.includes("c_phone")) s.asked.push("c_phone");
          break;
        }
        d.phone = asPhone.phone;
        customer = asPhone.phone.display;
      } else d.name = raw.replace(/[<>]/g, "").slice(0, LIMIT.name);
      go(s, nextStep(s), out);
      break;
    }

    case "c_phone": {
      const p = parsePhone(raw);
      if (!p.ok) { out.push(p.reason === "needs_country" ? L().a.phoneNeedsCountry : L().a.phoneInvalid); break; }
      d.phone = p.phone;
      customer = p.phone.display;
      go(s, nextStep(s), out);
      break;
    }

    case "c_method": {
      const m = (id as ContactMethod | undefined) ?? (/mail|بريد/i.test(raw) ? "email" : /call|phone|اتصال|هاتف|مكالمة/i.test(raw) ? "call" : /whats|واتس/i.test(raw) ? "whatsapp" : undefined);
      if (!m || !METHODS.includes(m)) { out.push(L().a.notUnderstood); reask(); break; }
      d.method = m;
      if (m !== "email") d.email = d.email ?? undefined;
      go(s, nextStep(s), out);
      break;
    }

    case "c_email":
      if (!isEmail(raw)) { out.push(L().a.emailInvalid); break; }
      d.email = raw.toLowerCase();
      go(s, nextStep(s), out);
      break;

    case "c_review":
      if (id === "edit") go(s, "c_edit", out);
      else { out.push(L().a.consentRequired); }
      break;

    case "c_edit": {
      if (id === "back" || !id) { go(s, "c_review", out); break; }
      const target = id as Step;
      if (!editableFields(s).some(([f]) => f === target)) { out.push(L().a.notUnderstood); break; }
      s.returnTo = "c_review";
      if (target === "c_phone") d.phone = undefined;
      if (target === "c_method") { d.method = undefined; d.email = undefined; }
      if (target === "src_destination") { d.destination = undefined; }
      s.step = target;
      const q = ask(s);
      if (q.text) out.push(q.text);
      break;
    }

    case "done":
      if (id === "new") {
        resetFlow(s);
        s.step = "menu";
        reask();
      } else {
        out.push(L().a.afterSubmit(s.submitted?.reference ?? ""));
      }
      break;
  }

  return finish();
}
