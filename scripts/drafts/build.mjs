// PRIVATE PREVIEW ONLY. Builds draft pieces from the owner's selection of the shop's own Instagram
// posts (@sevnhevn.dubai), so the shop design can be reviewed with real photographs before anything
// is approved. The output is git-ignored and is loaded only when DRAFT_PREVIEW=true on a local or
// preview deployment — never on production, never purchasable, never indexed.
//
//   node scripts/drafts/build.mjs [path to the selection folder]
//
// Default source: ~/Desktop/SEVN-HEVN-instagram-products (products.json + originals/).
// Photos are only resized for the web (longest side 2000 px, JPEG): no retouching, cropping or
// colour changes, and nothing is removed from them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const sharp = createRequire(import.meta.url)("sharp");

const SRC = process.argv[2] ?? path.join(os.homedir(), "Desktop/SEVN-HEVN-instagram-products");
const OUT_IMG = "public/drafts";
const OUT_DATA = "src/data/drafts.generated.json";

/**
 * Which posts become drafts, and only what the posts themselves state. Pieces outside the shop
 * (another house, or not one of the four categories) are left out on purpose.
 */
const PICK = {
  "hermes-kelly-depeches-25-noir": { ref: "HER-KD25-NOIR", category: "bags", subcategory: "clutches", colour: "Noir (black)", material: "Box calf leather (Veau Box)" },
  "hermes-oz-mules-pink-suede-40-5": { ref: "HER-OZ-PINK-405", category: "shoes", subcategory: "loafers", colour: "Pink", material: "Goatskin suede", size: "40.5", hardware: "Gold-tone" },
  "hermes-chypre-sandals-etoupe": { ref: "HER-CHYPRE-ETOUPE", category: "shoes", subcategory: "sandals", colour: "Étoupe", material: "Epsom leather", audience: "men" },
  "hermes-farandole-necklace-120": { ref: "HER-FARANDOLE-120", category: "jewellery", subcategory: "necklaces", material: "Silver", size: "120 cm" },
};
const LEFT_OUT = {
  "loro-piana-extra-pocket-l19": "Loro Piana is not one of the shop's houses.",
  "hermes-bride-a-brac-case-small": "A travel case: not one of the four categories until the owner decides.",
};

const data = JSON.parse(fs.readFileSync(path.join(SRC, "products.json"), "utf8"));
fs.rmSync(OUT_IMG, { recursive: true, force: true });
const items = [];
for (const p of data.products) {
  const pick = PICK[p.slug];
  if (!pick) {
    console.log(`left out: ${p.brand} ${p.name} — ${LEFT_OUT[p.slug] ?? "not selected"}`);
    continue;
  }
  const dir = path.join(OUT_IMG, pick.ref.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  const images = [];
  for (const [i, [file, role]] of p.photos.entries()) {
    const to = path.join(dir, `${String(i + 1).padStart(2, "0")}.jpg`);
    const info = await sharp(path.join(SRC, "originals", file)).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toFile(to);
    images.push({ src: `/drafts/${pick.ref.toLowerCase()}/${path.basename(to)}`, width: info.width, height: info.height, alt: `${p.brand} ${p.name} — ${role}` });
  }
  const post = p.posts[0];
  const posted = p.posted_price;
  const uncertain = [...(p.uncertain ?? []), ...(p.visible_not_confirmed ?? [])].filter((u) => !/Current availability and price/.test(u));
  items.push({
    ref: pick.ref,
    status: "enquiry_only",
    name: p.name,
    brand: p.brand,
    category: pick.category,
    subcategory: pick.subcategory,
    description: p.en_desc,
    images,
    condition: "new",
    conditionNotes: "Brand new, as written in our Instagram post; to be confirmed.",
    colour: pick.colour,
    material: pick.material,
    ...(pick.size ? { size: pick.size } : {}),
    ...(pick.hardware ? { hardware: pick.hardware } : {}),
    ...(pick.audience ? { audience: pick.audience } : {}),
    listedAt: post.posted_dubai.slice(0, 10),
    featured: true,
    draftNote: [
      `From our Instagram post of ${post.posted_dubai.slice(0, 10)} (${post.url}).`,
      posted ? `The post gave AED ${posted.aed.toLocaleString("en-US")} on ${posted.date} — not a current price.` : "",
      "Price, stock and delivery to be confirmed by the owner before publishing.",
      uncertain.length ? `Still to confirm: ${uncertain.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
}
fs.writeFileSync(OUT_DATA, JSON.stringify(items, null, 2) + "\n");
console.log(`${items.length} drafts, ${items.reduce((n, i) => n + i.images.length, 0)} photos → ${OUT_DATA}, ${OUT_IMG}/`);
