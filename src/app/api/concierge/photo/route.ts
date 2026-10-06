import { attachPhoto } from "@/lib/concierge/service";
import { MAX_UPLOAD_BYTES, PhotoError } from "@/lib/concierge/photos";
import { MSG_ID, TOKEN, UUID, failure, json, sameOrigin } from "@/lib/concierge/http";

export const dynamic = "force-dynamic";

/**
 * Receives one photo for a conversation (the browser has already scaled it down). The server
 * checks the real file type, re-encodes it without metadata and stores it in a private bucket.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "invalid_request" }, 403);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES + 64_000) return json({ error: "photo_too_large" }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const id = form.get("id");
  const token = form.get("token");
  const clientMsgId = form.get("clientMsgId");
  const file = form.get("file");
  if (typeof id !== "string" || !UUID.test(id) || typeof token !== "string" || !TOKEN.test(token) || typeof clientMsgId !== "string" || !MSG_ID.test(clientMsgId)) {
    return json({ error: "invalid_request" }, 400);
  }
  if (!(file instanceof File) || file.size === 0) return json({ error: "photo_type" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "photo_too_large" }, 413);

  try {
    return json(await attachPhoto(id, token, clientMsgId, new Uint8Array(await file.arrayBuffer())));
  } catch (e) {
    if (e instanceof PhotoError) return json({ error: e.code }, e.code === "photo_too_large" ? 413 : 415);
    return failure(e);
  }
}
