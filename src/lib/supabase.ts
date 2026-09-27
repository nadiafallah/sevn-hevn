import "server-only";

/**
 * Minimal server-side access to Supabase's REST API (PostgREST) — no client SDK, nothing sent to
 * the browser. Keys (Supabase dashboard → Project Settings → API Keys):
 *
 * - SUPABASE_PUBLISHABLE_KEY — public, read-only by RLS: published products and their images.
 * - SUPABASE_SECRET_KEY      — bypasses RLS. Server-only, Production environment only. Used solely
 *                              to insert website enquiries. Never prefix with NEXT_PUBLIC_.
 */

export const PRODUCT_IMAGES_BUCKET = "product-images";

function baseUrl() {
  const raw = process.env.SUPABASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** Catalogue reads are possible (URL + publishable key present). */
export function supabaseReadConfig() {
  const url = baseUrl();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

/**
 * Enquiry writes are possible only on the production deployment with the secret key present,
 * so previews and local development can never write into live customer data.
 */
export function supabaseWriteConfig() {
  const url = baseUrl();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key || process.env.VERCEL_ENV !== "production") return null;
  return { url, key };
}

export function publicImageUrl(url: string, storagePath: string) {
  const path = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${url}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${path}`;
}
