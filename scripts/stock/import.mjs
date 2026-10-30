// Puts a batch of pieces on the website in one go: uploads their photos to the "product-images"
// Storage bucket and writes the products, photos and versions — the same rows the panel would write.
// Running it again replaces those pieces' photos and versions, so a corrected batch can be re-run.
//
//   node --env-file=.env.local scripts/stock/import.mjs scripts/stock/2026-10-28.json <photos folder>
//
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY (Supabase → Project Settings → API Keys). Keep the key
// in .env.local only; never in a commit or a chat. Changes made this way are not in the panel's
// activity log. For one piece at a time, use the panel (/admin/products) instead.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const [dataFile, photoDir] = process.argv.slice(2);
if (!dataFile || !photoDir) {
  console.error("usage: node --env-file=.env.local scripts/stock/import.mjs <data.json> <photos folder>");
  process.exit(1);
}
const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const key = process.env.SUPABASE_SECRET_KEY?.trim();
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are needed.");
  process.exit(1);
}
// The local test stack (scripts/local-stack.mjs) takes its public key plus a service-role token instead.
const headers = { apikey: process.env.STOCK_APIKEY || key, authorization: `Bearer ${process.env.STOCK_BEARER || key}` };
const BUCKET = "product-images";

async function call(path, init = {}) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const rest = (path, method, body, prefer = "return=representation") =>
  call(`/rest/v1/${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", prefer } });

const { products } = JSON.parse(readFileSync(dataFile, "utf8"));
const PRODUCT_FIELDS = [
  "ref", "published", "status", "name", "category", "subcategory", "brand", "model_reference", "description", "price_aed", "stock",
  "condition", "condition_notes", "year", "material", "colour", "size", "size_system", "dimensions", "hardware", "purity", "stones",
  "audience", "included", "authentication", "delivery", "returns", "featured", "listed_at",
];

for (const p of products) {
  // Unpublished while its photos change, so visitors never see a half-written piece.
  const row = Object.fromEntries(PRODUCT_FIELDS.map((f) => [f, p[f] ?? (f === "included" ? [] : f === "featured" ? false : null)]));
  await rest("products?on_conflict=ref", "POST", { ...row, published: false }, "resolution=merge-duplicates,return=minimal");
  await rest(`product_variants?product_ref=eq.${encodeURIComponent(p.ref)}`, "DELETE", undefined, "return=minimal");
  await rest(`product_images?product_ref=eq.${encodeURIComponent(p.ref)}`, "DELETE", undefined, "return=minimal");

  const images = [];
  for (const [i, photo] of p.photos.entries()) {
    const bytes = readFileSync(join(photoDir, photo.file));
    const { width, height } = await sharp(bytes).metadata();
    const path = `${p.ref}/${String(i + 1).padStart(2, "0")}.jpg`;
    await call(`/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      body: bytes,
      headers: { "content-type": "image/jpeg", "x-upsert": "true", "cache-control": "max-age=3600" },
    });
    const [img] = await rest("product_images", "POST", { product_ref: p.ref, storage_path: path, width, height, alt: photo.alt, position: i });
    images.push(img);
  }
  for (const [i, v] of (p.variants ?? []).entries()) {
    await rest("product_variants", "POST", {
      product_ref: p.ref, sku: v.sku, colour: v.colour ?? null, size: v.size ?? null, hardware: v.hardware ?? null, material: v.material ?? null,
      price_aed: v.price_aed ?? null, stock: v.stock ?? null, image_id: v.photo === undefined ? null : images[v.photo].id, position: i,
    }, "return=minimal");
  }
  if (p.published) await rest(`products?ref=eq.${encodeURIComponent(p.ref)}`, "PATCH", { published: true }, "return=minimal");
  console.log(`${p.ref}: ${images.length} photo(s), ${(p.variants ?? []).length} version(s)${p.published ? ", published" : ""}`);
}
console.log(`${products.length} piece(s) done. The website shows them within a minute.`);
