import { isLocale } from "@/lib/concierge/i18n";
import type { Input } from "@/lib/concierge/engine";
import { conciergeAvailable, loadConversation, respond, startConversation } from "@/lib/concierge/service";
import { MSG_ID, TOKEN, UUID, failure, json, sameOrigin } from "@/lib/concierge/http";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_000;

function parseInput(raw: unknown): Input | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case "text":
    case "choice":
      return typeof r.value === "string" && r.value.length <= 2000 ? { type: r.type, value: r.value } : null;
    case "submit":
      return typeof r.consent === "boolean" ? { type: "submit", consent: r.consent } : null;
    case "locale":
      return isLocale(r.value) ? { type: "locale", value: r.value } : null;
    case "restart":
    case "human":
      return { type: r.type };
    default:
      return null;
  }
}

/** Lets the chat know whether it can take requests here (it says so honestly when it can't). */
export function GET() {
  return json({ available: conciergeAvailable() });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "invalid_request" }, 403);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "invalid_request" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "invalid_request" }, 400);

  const conv = body.conversation as { id?: unknown; token?: unknown } | undefined;
  const id = typeof conv?.id === "string" && UUID.test(conv.id) ? conv.id : null;
  const token = typeof conv?.token === "string" && TOKEN.test(conv.token) ? conv.token : null;
  const clientMsgId = typeof body.clientMsgId === "string" && MSG_ID.test(body.clientMsgId) ? body.clientMsgId : null;

  try {
    switch (body.action) {
      case "start": {
        const locale = isLocale(body.locale) ? body.locale : "en";
        const source = body.source === "page" ? "page" : "widget";
        const input = body.input === undefined ? undefined : parseInput(body.input);
        if (input === null) return json({ error: "invalid_request" }, 400);
        return json(await startConversation(request, locale, source, input, clientMsgId ?? undefined), 201);
      }
      case "load":
        if (!id || !token) return json({ error: "invalid_request" }, 400);
        return json(await loadConversation(id, token));
      case "reply": {
        const input = parseInput(body.input);
        if (!id || !token || !clientMsgId || !input) return json({ error: "invalid_request" }, 400);
        return json(await respond(id, token, clientMsgId, input));
      }
      default:
        return json({ error: "invalid_request" }, 400);
    }
  } catch (e) {
    return failure(e);
  }
}
