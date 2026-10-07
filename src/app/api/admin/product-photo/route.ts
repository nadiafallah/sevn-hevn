import { randomUUID } from "node:crypto";
import { revalidateTag } from "next/cache";
import { currentStaff } from "@/lib/admin/session";
import { PRODUCT_PHOTO_LIMIT } from "@/lib/admin/products";
import { CATALOG_TAG } from "@/lib/catalog";
import { DbError, rpc, storageRemove, storageUpload } from "@/lib/concierge/db";
import { json, sameOrigin } from "@/lib/concierge/http";
import { MAX_UPLOAD_BYTES, PhotoError, processPhoto } from "@/lib/concierge/photos";
import { PRODUCT_IMAGES_BUCKET } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const REF = /^[A-Za-z0-9-]{2,40}$/;

/**
 * Adds one photo to a piece (owner only). The browser has already scaled it down; the server checks
 * the real file type, re-encodes it as a JPEG without metadata (GPS, camera details) and stores it
 * in the public product-images bucket with the owner's own token, so Storage policies apply.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "invalid_request" }, 403);
  const ctx = await currentStaff();
  if (!ctx) return json({ error: "unauthenticated" }, 401);
  if (!ctx.isOwner) return json({ error: "owner_only" }, 403);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES + 64_000) return json({ error: "photo_too_large" }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const ref = form.get("ref");
  const alt = form.get("alt");
  const file = form.get("file");
  if (typeof ref !== "string" || !REF.test(ref)) return json({ error: "invalid_request" }, 400);
  if (!(file instanceof File) || file.size === 0) return json({ error: "photo_type" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "photo_too_large" }, 413);

  let photo: Awaited<ReturnType<typeof processPhoto>>;
  try {
    photo = await processPhoto(new Uint8Array(await file.arrayBuffer()), { maxSide: 2000, quality: 85 });
  } catch (e) {
    const code = e instanceof PhotoError ? e.code : "photo_unreadable";
    return json({ error: code }, code === "photo_too_large" ? 413 : 415);
  }

  const path = `${ref}/${randomUUID()}.jpg`;
  try {
    await storageUpload(ctx.api, PRODUCT_IMAGES_BUCKET, path, photo.bytes, "image/jpeg", ctx.token);
  } catch {
    return json({ error: "storage_error" }, 502);
  }
  try {
    const id = await rpc<number>(
      ctx.api,
      "admin_add_product_image",
      { p_ref: ref, p_path: path, p_width: photo.width, p_height: photo.height, p_alt: typeof alt === "string" ? alt.slice(0, 300) : "" },
      ctx.token,
    );
    revalidateTag(CATALOG_TAG, { expire: 0 });
    return json({ id, limit: PRODUCT_PHOTO_LIMIT });
  } catch (e) {
    // Don't leave an orphaned file behind.
    await storageRemove(ctx.api, PRODUCT_IMAGES_BUCKET, [path], ctx.token).catch(() => {});
    return json({ error: e instanceof DbError ? e.code : "db_error" }, 400);
  }
}
