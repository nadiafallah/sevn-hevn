import "server-only";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { after } from "next/server";
import { site } from "@/config/site";
import { findItem, getCatalog } from "@/lib/catalog";
import { aiConfig, clientHash, conciergeServer, emailConfig, supabaseApi } from "./config";
import { DbError, rpc, select, storageUpload } from "./db";
import { begin, currentPrompt, handle, initialState, type Deps, type Input, type ItemInfo, type KnowledgeAnswer, type State, type VerifiedOrder } from "./engine";
import { t, type Locale } from "./i18n";
import type { ClientMessage, ClientReply } from "./types";
import { aiDescribePhoto, aiExtract } from "./ai";
import { processNotifications, sendOrderCode } from "./notify";
import { processPhoto } from "./photos";

export class ConciergeError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}


interface Loaded {
  id: string;
  locale: Locale;
  state: State | Record<string, never>;
  version: number;
  last_client_msg_id: string | null;
  last_reply: ClientReply | null;
  last_activity_at: string;
  messages: { role: "customer" | "assistant"; body: string; at: string }[];
}

type Server = NonNullable<ReturnType<typeof conciergeServer>>;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const IDLE_LIMIT_MS = 24 * 60 * 60 * 1000;
const PRICE_MAX_AGE_DAYS = 30;
const TOPICS = new Set(["shipping", "returns", "authenticity", "warranty", "payment", "viewing", "general"]);

function server(): Server {
  const db = conciergeServer();
  if (!db) throw new ConciergeError("unavailable", 503);
  return db;
}

function parseState(raw: Loaded["state"], locale: Locale): State {
  const s = raw as State;
  return s && s.v === 1 && typeof s.step === "string" && s.draft ? s : initialState(locale);
}

// ── Approved data the assistant may use ──────────────────────────────────────────────

async function lookupItem(ref: string): Promise<ItemInfo | null> {
  if (!/^[A-Za-z0-9-]{2,40}$/.test(ref)) return null;
  const item = findItem(await getCatalog(), ref);
  if (!item || item.demo) return null;
  if (item.status === "editorial_preview") return { ref: item.ref, name: item.name, status: "editorial_preview" };
  const api = supabaseApi();
  if (!api) return { ref: item.ref, name: item.name, brand: item.brand, category: item.category, status: item.status };
  // Fresh read (never the cache) so a price is only quoted with its real last-update time.
  const rows = await select<{ ref: string; name: string; brand: string | null; category: string; status: ItemInfo["status"]; price_aed: number | null; stock: number | null; delivery: string | null; updated_at: string }[]>(
    api,
    "products",
    { select: "ref,name,brand,category,status,price_aed,stock,delivery,updated_at", published: "is.true", ref: `ilike.${item.ref}`, limit: "1" },
  );
  const r = rows[0];
  if (!r) return null;
  let status = r.status;
  if (status === "available" && r.stock !== null && r.stock <= 0) status = "sold";
  else if (status === "available" && (!r.price_aed || !r.stock || !r.delivery)) status = "enquiry_only";
  return { ref: r.ref, name: r.name, brand: r.brand ?? undefined, category: r.category, status, priceAED: r.price_aed ?? undefined, updatedAt: r.updated_at };
}

async function findKnowledge(topic: string, country: string | undefined, locale: Locale): Promise<KnowledgeAnswer | null> {
  const api = supabaseApi();
  if (!api || !TOPICS.has(topic)) return null;
  const rows = await select<{ title: string; body: string; locale: Locale; country_code: string | null; review_by: string | null }[]>(api, "knowledge_entries", {
    select: "title,body,locale,country_code,review_by",
    status: "eq.approved",
    topic: `eq.${topic}`,
  });
  const today = new Date().toISOString().slice(0, 10);
  const valid = rows.filter((r) => !r.review_by || r.review_by >= today);
  const pick = (l: Locale, cc: string | null) => valid.find((r) => r.locale === l && r.country_code === cc);
  const hit =
    (country ? pick(locale, country) : undefined) ??
    pick(locale, null) ??
    (locale === "ar" ? ((country ? pick("en", country) : undefined) ?? pick("en", null)) : undefined);
  return hit ? { title: hit.title, body: hit.body, english: locale === "ar" && hit.locale === "en" } : null;
}

function codeHash(db: Server, conversationId: string, code: string) {
  return createHmac("sha256", db.serverKey).update(`order-code:${conversationId}:${code}`).digest("hex");
}

function deps(db: Server, id: string, tokenHash: string): Deps {
  const ai = aiConfig();
  const base = { p_key: db.serverKey, p_conversation: id, p_token_hash: tokenHash };
  const aiAllowed = () =>
    ai ? rpc<boolean>(db, "concierge_ai_allow", { ...base, p_per_conversation: ai.perConversation, p_per_day: ai.perDay }).catch(() => false) : Promise.resolve(false);
  return {
    conversationId: id,
    phoneDisplay: site.contact.phoneDisplay,
    priceMaxAgeDays: PRICE_MAX_AGE_DAYS,
    now: () => new Date(),
    lookupItem,
    knowledge: findKnowledge,
    submit: (payload) => rpc<{ id: string; reference: string }>(db, "concierge_submit", { ...base, p_request: payload }),
    orderVerification: emailConfig() !== null,
    async startOrderCheck(ref) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const email = await rpc<string | null>(db, "concierge_order_challenge", { ...base, p_order_ref: ref, p_code_hash: codeHash(db, id, code) });
      if (email) {
        // The customer is told the same thing whether or not the order exists.
        await sendOrderCode(email, code, ref).catch(() => console.error("[concierge] order code e-mail failed"));
      }
    },
    async verifyOrderCode(ref, code) {
      const r = await rpc<{ ok: boolean; reason?: "invalid" | "locked" | "expired"; attempts_left?: number; order?: VerifiedOrder }>(db, "concierge_order_verify", {
        ...base,
        p_order_ref: ref,
        p_code_hash: codeHash(db, id, code),
      });
      return r.ok && r.order ? { ok: true, order: r.order } : { ok: false, reason: r.reason ?? "expired", attemptsLeft: r.attempts_left };
    },
    ai: ai ? async (text, locale) => ((await aiAllowed()) ? aiExtract(ai, text, locale) : null) : undefined,
  };
}

// ── Conversation operations ──────────────────────────────────────────────────────────

async function load(db: Server, id: string, token: string) {
  const tokenHash = sha(token);
  const conv = await rpc<Loaded>(db, "concierge_load", { p_key: db.serverKey, p_conversation: id, p_token_hash: tokenHash });
  return { conv, tokenHash };
}

function toClient(messages: { role: "customer" | "assistant"; body: string }[]): ClientMessage[] {
  return messages.map((m) => ({ role: m.role, body: m.body }));
}

/** Starts a conversation. With a first input, the greeting and the answer are stored together. */
export async function startConversation(request: Request, locale: Locale, source: "widget" | "page", input?: Input, clientMsgId?: string): Promise<ClientReply> {
  const db = server();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha(token);
  const id = await rpc<string>(db, "concierge_start", {
    p_key: db.serverKey,
    p_token_hash: tokenHash,
    p_locale: locale,
    p_source: source,
    p_client_hash: clientHash(request, db.serverKey),
  });
  const greeting = begin(locale);
  let state = greeting.state;
  const messages: ClientMessage[] = greeting.assistant.map((body) => ({ role: "assistant", body }));
  let prompt = greeting.prompt;
  let submitted: ClientReply["submitted"];
  if (input) {
    const turn = await handle(state, input, deps(db, id, tokenHash));
    state = turn.state;
    if (turn.customer) messages.push({ role: "customer", body: turn.customer });
    messages.push(...turn.assistant.map((body) => ({ role: "assistant" as const, body })));
    prompt = turn.prompt;
    if (turn.submitted) submitted = { reference: turn.submitted.reference };
  }
  const reply: ClientReply = { conversation: { id }, locale: state.locale, messages, prompt, submitted };
  await rpc(db, "concierge_save", {
    p_key: db.serverKey,
    p_conversation: id,
    p_token_hash: tokenHash,
    p_expected_version: 0,
    p_state: state,
    p_locale: state.locale,
    p_messages: messages.map((m) => ({ ...m, locale: state.locale })),
    p_client_msg_id: clientMsgId ?? null,
    p_reply: reply,
  });
  return { ...reply, conversation: { id, token } };
}

export async function loadConversation(id: string, token: string): Promise<ClientReply> {
  const db = server();
  const { conv } = await load(db, id, token);
  if (Date.now() - new Date(conv.last_activity_at).getTime() > IDLE_LIMIT_MS) throw new ConciergeError("expired", 410);
  const state = parseState(conv.state, conv.locale);
  return {
    conversation: { id },
    locale: state.locale,
    messages: toClient(conv.messages),
    prompt: currentPrompt(state),
    submitted: state.step === "done" && state.submitted ? { reference: state.submitted.reference } : undefined,
  };
}

/**
 * Applies one customer action. Retried sends with the same clientMsgId return the stored reply,
 * so a double click or a reconnect never records the action (or a request) twice.
 */
export async function respond(id: string, token: string, clientMsgId: string, input: Input, customerNote?: string): Promise<ClientReply> {
  const db = server();
  for (let attempt = 0; ; attempt++) {
    const { conv, tokenHash } = await load(db, id, token);
    if (conv.last_client_msg_id === clientMsgId && conv.last_reply) return conv.last_reply;
    if (Date.now() - new Date(conv.last_activity_at).getTime() > IDLE_LIMIT_MS) throw new ConciergeError("expired", 410);
    const state = parseState(conv.state, conv.locale);
    const turn = await handle(state, input, deps(db, id, tokenHash));
    const customer = customerNote ?? turn.customer;
    const messages: ClientMessage[] = [
      ...(customer ? [{ role: "customer" as const, body: customer }] : []),
      ...turn.assistant.map((body) => ({ role: "assistant" as const, body })),
    ];
    const reply: ClientReply = {
      conversation: { id },
      locale: turn.state.locale,
      messages,
      prompt: turn.prompt,
      submitted: turn.submitted ? { reference: turn.submitted.reference } : undefined,
    };
    try {
      await rpc(db, "concierge_save", {
        p_key: db.serverKey,
        p_conversation: id,
        p_token_hash: tokenHash,
        p_expected_version: conv.version,
        p_state: turn.state,
        p_locale: turn.state.locale,
        p_messages: messages.map((m) => ({ ...m, locale: turn.state.locale })),
        p_client_msg_id: clientMsgId,
        p_reply: reply,
      });
    } catch (e) {
      // Another tab or a parallel photo upload saved first: redo this action on the new state.
      // A request submitted in the first pass is found again by its idempotency key.
      if (e instanceof DbError && e.code === "conflict" && attempt === 0) continue;
      throw e;
    }
    if (turn.submitted) {
      after(() => processNotifications().catch(() => console.error("[concierge] notification run failed")));
    }
    return reply;
  }
}

export async function attachPhoto(id: string, token: string, clientMsgId: string, file: Uint8Array): Promise<ClientReply> {
  const db = server();
  const { conv, tokenHash } = await load(db, id, token);
  if (conv.last_client_msg_id === clientMsgId && conv.last_reply) return conv.last_reply;
  const photo = await processPhoto(file);
  const base = { p_key: db.serverKey, p_conversation: id, p_token_hash: tokenHash };
  const path = await rpc<string>(db, "concierge_photo_slot", base);
  await storageUpload(db, "request-photos", path, photo.bytes, "image/jpeg");
  await rpc(db, "concierge_photo_stored", { ...base, p_path: path, p_bytes: photo.bytes.byteLength, p_width: photo.width, p_height: photo.height, p_sha256: photo.sha256 });

  let hint: string | undefined;
  const ai = aiConfig();
  const locale = parseState(conv.state, conv.locale).locale;
  if (ai) {
    const allowed = await rpc<boolean>(db, "concierge_ai_allow", { ...base, p_per_conversation: ai.perConversation, p_per_day: ai.perDay }).catch(() => false);
    if (allowed) hint = (await aiDescribePhoto(ai, photo.bytes, locale)) ?? undefined;
  }
  return respond(id, token, clientMsgId, { type: "photo", hint }, t(locale).ui.photoAttached);
}
