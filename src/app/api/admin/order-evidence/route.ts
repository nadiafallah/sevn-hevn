import { randomUUID } from "node:crypto";
import { currentStaff } from "@/lib/admin/session";
import { DbError, rpc, storageRemove, storageUpload } from "@/lib/concierge/db";
import { json, sameOrigin } from "@/lib/concierge/http";
import { MAX_UPLOAD_BYTES, PhotoError, processPhoto } from "@/lib/concierge/photos";
import { ORDER_EVIDENCE_BUCKET } from "@/lib/orders/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INT = /^[0-9]{1,18}$/;
const KINDS = ["product", "serial", "document", "condition", "packing", "handover", "delivery", "return", "inspection", "payment"];
const MAX_PDF_BYTES = 8 * 1024 * 1024;

/**
 * Adds a photo or PDF to an order's evidence (team members). Photos are re-encoded as JPEG without
 * metadata (GPS, camera details); PDFs are checked to be PDFs. Files go to the private
 * order-evidence bucket with the person's own token, so Storage policies apply, and are registered
 * through admin_add_evidence, which checks the item, shipment or return belongs to the order.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "invalid_request" }, 403);
  const ctx = await currentStaff();
  if (!ctx) return json({ error: "unauthenticated" }, 401);
  if (Number(request.headers.get("content-length") ?? "0") > MAX_PDF_BYTES + 64_000) return json({ error: "photo_too_large" }, 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const orderId = String(form.get("order_id") ?? "");
  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");
  if (!UUID.test(orderId) || !KINDS.includes(kind) || !(file instanceof File) || file.size === 0) return json({ error: "invalid_request" }, 400);
  const link = (k: string, re: RegExp) => {
    const v = String(form.get(k) ?? "");
    return re.test(v) ? v : null;
  };

  const raw = new Uint8Array(await file.arrayBuffer());
  let bytes: Uint8Array;
  let ext: "jpg" | "pdf";
  if (raw.length >= 5 && Buffer.from(raw.subarray(0, 5)).toString("latin1") === "%PDF-") {
    if (raw.length > MAX_PDF_BYTES) return json({ error: "photo_too_large" }, 413);
    bytes = raw;
    ext = "pdf";
  } else {
    if (raw.length > MAX_UPLOAD_BYTES) return json({ error: "photo_too_large" }, 413);
    try {
      bytes = (await processPhoto(raw, { maxSide: 2400, quality: 85 })).bytes;
    } catch (e) {
      const code = e instanceof PhotoError ? e.code : "photo_unreadable";
      return json({ error: code }, code === "photo_too_large" ? 413 : 415);
    }
    ext = "jpg";
  }

  const path = `${orderId}/${randomUUID()}.${ext}`;
  try {
    await storageUpload(ctx.api, ORDER_EVIDENCE_BUCKET, path, bytes, ext === "pdf" ? "application/pdf" : "image/jpeg", ctx.token);
  } catch {
    return json({ error: "storage_error" }, 502);
  }
  try {
    const id = await rpc<number>(ctx.api, "admin_add_evidence", {
      p_order: orderId,
      p_fields: {
        path, kind, note: String(form.get("note") ?? "").slice(0, 300),
        order_item_id: link("order_item_id", INT), shipment_id: link("shipment_id", UUID), return_id: link("return_id", UUID),
      },
    }, ctx.token);
    return json({ id });
  } catch (e) {
    // Don't leave an orphaned file behind (only the owner may delete evidence files).
    if (ctx.isOwner) await storageRemove(ctx.api, ORDER_EVIDENCE_BUCKET, [path], ctx.token).catch(() => {});
    return json({ error: e instanceof DbError ? e.code : "db_error" }, 400);
  }
}
