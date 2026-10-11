import { randomUUID } from "node:crypto";
import { revalidateTag } from "next/cache";
import sharp from "sharp";
import { currentStaff } from "@/lib/admin/session";
import { CATALOG_TAG } from "@/lib/catalog";
import { DbError, rpc, storageRemove, storageUpload } from "@/lib/concierge/db";
import { json, sameOrigin } from "@/lib/concierge/http";
import { MAX_UPLOAD_BYTES, PhotoError, processPhoto } from "@/lib/concierge/photos";
import { GlbError, MAX_MODEL_BYTES, inspectGlb } from "@/lib/media/glb";
import { PRODUCT_MEDIA_BUCKET, mediaUrl } from "@/lib/views";

export const dynamic = "force-dynamic";

const REF = /^[A-Za-z0-9-]{2,40}$/;
const MODEL_PATH = (ref: string) => new RegExp(`^${ref}/360/[0-9a-f-]{36}\\.glb$`);

/**
 * 360° media for a piece (owner only).
 *
 * - multipart, kind=frame|interior: one photograph, already scaled down in the browser. The server
 *   checks the real file type, redraws it without metadata (GPS, camera details) and stores two
 *   WebP sizes in the public product-media bucket: 800 px to turn, 1600 px to zoom.
 * - JSON {action:"sign-model"}: a one-time link to upload a .glb straight to Storage (models can be
 *   larger than a website request may carry). JSON {action:"finish-model"}: the server reads the
 *   uploaded file, checks it (lib/media/glb) and records it; a file that fails is deleted.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "invalid_request" }, 403);
  const ctx = await currentStaff();
  if (!ctx) return json({ error: "unauthenticated" }, 401);
  if (!ctx.isOwner) return json({ error: "owner_only" }, 403);

  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    let body: { action?: string; ref?: string; path?: string };
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    const ref = body.ref;
    if (typeof ref !== "string" || !REF.test(ref)) return json({ error: "invalid_request" }, 400);

    if (body.action === "sign-model") {
      const path = `${ref}/360/${randomUUID()}.glb`;
      const res = await fetch(`${ctx.api.url}/storage/v1/object/upload/sign/${PRODUCT_MEDIA_BUCKET}/${path}`, {
        method: "POST",
        headers: { apikey: ctx.api.key, authorization: `Bearer ${ctx.token}`, "content-type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
      const data = res?.ok ? ((await res.json()) as { url?: string }) : null;
      if (!data?.url) return json({ error: "storage_error" }, 502);
      // The publishable key is public by design; the one-time token in the URL authorises the upload.
      return json({ path, uploadUrl: `${ctx.api.url}/storage/v1${data.url}`, apikey: ctx.api.key, maxBytes: MAX_MODEL_BYTES });
    }

    if (body.action === "finish-model") {
      const path = body.path;
      if (typeof path !== "string" || !MODEL_PATH(ref).test(path)) return json({ error: "invalid_request" }, 400);
      const discard = () => storageRemove(ctx.api, PRODUCT_MEDIA_BUCKET, [path], ctx.token).catch(() => {});
      let bytes: Uint8Array;
      try {
        const res = await fetch(mediaUrl(ctx.api.url, path), { cache: "no-store", signal: AbortSignal.timeout(20000) });
        if (!res.ok) return json({ error: "model_missing" }, 400);
        bytes = new Uint8Array(await res.arrayBuffer());
      } catch {
        return json({ error: "storage_error" }, 502);
      }
      let info: ReturnType<typeof inspectGlb>;
      try {
        info = inspectGlb(bytes);
      } catch (e) {
        await discard();
        return json({ error: e instanceof GlbError ? e.code : "model_corrupt" }, 415);
      }
      try {
        const old = await rpc<string | null>(ctx.api, "admin_set_view_model", { p_ref: ref, p_path: path, p_bytes: info.bytes, p_animations: info.animations }, ctx.token);
        if (old && old !== path) await storageRemove(ctx.api, PRODUCT_MEDIA_BUCKET, [old], ctx.token).catch(() => {});
        revalidateTag(CATALOG_TAG, { expire: 0 });
        return json({ ok: true, bytes: info.bytes, meshes: info.meshes, animations: info.animations, variants: info.variants });
      } catch (e) {
        await discard();
        return json({ error: e instanceof DbError ? e.code : "db_error" }, 400);
      }
    }
    return json({ error: "invalid_request" }, 400);
  }

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES + 64_000) return json({ error: "photo_too_large" }, 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const ref = form.get("ref");
  const kind = form.get("kind");
  const alt = form.get("alt");
  const file = form.get("file");
  if (typeof ref !== "string" || !REF.test(ref) || (kind !== "frame" && kind !== "interior")) return json({ error: "invalid_request" }, 400);
  if (!(file instanceof File) || file.size === 0) return json({ error: "photo_type" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "photo_too_large" }, 413);

  let zoom: { data: Buffer; info: { width: number; height: number } };
  let view: Buffer;
  try {
    const clean = await processPhoto(new Uint8Array(await file.arrayBuffer()), { maxSide: 1600, quality: 92 });
    zoom = await sharp(clean.bytes).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
    view = await sharp(clean.bytes).resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch (e) {
    const code = e instanceof PhotoError ? e.code : "photo_unreadable";
    return json({ error: code }, code === "photo_too_large" ? 413 : 415);
  }

  const id = randomUUID();
  const path = `${ref}/360/${id}.webp`;
  const zoomPath = `${ref}/360/${id}-zoom.webp`;
  try {
    await storageUpload(ctx.api, PRODUCT_MEDIA_BUCKET, path, new Uint8Array(view), "image/webp", ctx.token);
    await storageUpload(ctx.api, PRODUCT_MEDIA_BUCKET, zoomPath, new Uint8Array(zoom.data), "image/webp", ctx.token);
  } catch {
    await storageRemove(ctx.api, PRODUCT_MEDIA_BUCKET, [path, zoomPath], ctx.token).catch(() => {});
    return json({ error: "storage_error" }, 502);
  }
  try {
    const rowId = await rpc<number>(
      ctx.api,
      "admin_add_view_media",
      {
        p_ref: ref,
        p_kind: kind,
        p_path: path,
        p_zoom_path: zoomPath,
        p_width: zoom.info.width,
        p_height: zoom.info.height,
        p_alt: typeof alt === "string" ? alt.slice(0, 300) : "",
      },
      ctx.token,
    );
    revalidateTag(CATALOG_TAG, { expire: 0 });
    return json({ id: rowId });
  } catch (e) {
    // Don't leave orphaned files behind.
    await storageRemove(ctx.api, PRODUCT_MEDIA_BUCKET, [path, zoomPath], ctx.token).catch(() => {});
    return json({ error: e instanceof DbError ? e.code : "db_error" }, 400);
  }
}
