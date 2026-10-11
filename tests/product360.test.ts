// 360° views without a database or browser: run with `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GlbError, inspectGlb, naturalCompare } from "../src/lib/media/glb";
import { attachView, type MediaRow, type ViewRow } from "../src/lib/views";
import type { Item } from "../src/data/types";

/** A minimal .glb: JSON chunk (padded to 4 bytes) + optional BIN chunk. */
function glb(json: object, bin = new Uint8Array(4)) {
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const j = new TextEncoder().encode(text);
  const total = 12 + 8 + j.length + (bin.length ? 8 + bin.length : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, j.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  if (bin.length) {
    dv.setUint32(20 + j.length, bin.length, true);
    dv.setUint32(24 + j.length, 0x004e4942, true);
    out.set(bin, 28 + j.length);
  }
  return out;
}
const base = { asset: { version: "2.0" }, meshes: [{ primitives: [] }], buffers: [{ byteLength: 4 }], bufferViews: [{ buffer: 0, byteLength: 4 }] };
const code = (f: () => unknown) => {
  try {
    f();
    return "accepted";
  } catch (e) {
    return e instanceof GlbError ? e.code : String(e);
  }
};

test("a real, self-contained .glb is accepted with its animations and colourways", () => {
  const watch = inspectGlb(new Uint8Array(readFileSync("public/showcase/ChronographWatch/model.glb")));
  assert.deepEqual(watch.animations, ["Anim_0"]);
  assert.equal(watch.variants.length, 4);
  const made = inspectGlb(glb({ ...base, animations: [{ name: "open" }, {}] }));
  assert.deepEqual(made.animations, ["open", "animation_1"]);
});

test("broken, foreign, external or compressed models are refused with a reason", () => {
  const good = glb(base);
  assert.equal(code(() => inspectGlb(good.slice(0, good.length - 2))), "model_corrupt");
  assert.equal(code(() => inspectGlb(new TextEncoder().encode("this is not a model at all"))), "model_type");
  assert.equal(code(() => inspectGlb(glb({ ...base, asset: { version: "1.0" } }))), "model_version");
  assert.equal(code(() => inspectGlb(glb({ ...base, buffers: [{ byteLength: 4, uri: "scene.bin" }] }))), "model_external");
  assert.equal(code(() => inspectGlb(glb({ ...base, images: [{ uri: "https://example.com/t.png" }] }))), "model_external");
  assert.equal(code(() => inspectGlb(glb({ ...base, extensionsUsed: ["KHR_draco_mesh_compression"] }))), "model_compressed");
  assert.equal(code(() => inspectGlb(glb({ ...base, meshes: [] }))), "model_empty");
  assert.equal(code(() => inspectGlb(glb({ ...base, bufferViews: [{ buffer: 0, byteLength: 400 }] }))), "model_corrupt");
});

test("spin photos are ordered as the camera numbered them", () => {
  const names = ["IMG_10.jpg", "IMG_2.jpg", "IMG_1.jpg", "img_3.JPG"];
  assert.deepEqual(names.sort(naturalCompare), ["IMG_1.jpg", "IMG_2.jpg", "img_3.JPG", "IMG_10.jpg"]);
});

const piece: Item = { ref: "SH-0001", status: "enquiry_only", name: "Kelly 28", category: "bags", images: [{ src: "https://x/p.jpg", width: 1600, height: 2000, alt: "Front" }] };
const URL = "https://db.example";
const frame = (i: number, kind: "frame" | "interior" = "frame"): MediaRow => ({
  product_ref: "SH-0001", kind, storage_path: `SH-0001/360/${String(i).padStart(36, "0")}.webp`, zoom_path: null, width: 1600, height: 2000, alt: kind === "interior" ? "Inside" : null,
});
const spinView: ViewRow = { product_ref: "SH-0001", kind: "spin", start_frame: 40, reverse: false, model_path: null, model_bytes: null, open_animation: null };

test("a spin appears only with 12–72 frames; the start frame stays in range", () => {
  assert.equal(attachView(piece, URL, spinView, Array.from({ length: 11 }, (_, i) => frame(i))).view, undefined);
  const ok = attachView(piece, URL, spinView, Array.from({ length: 24 }, (_, i) => frame(i)));
  assert.equal(ok.view?.kind, "spin");
  assert.equal(ok.view?.kind === "spin" && ok.view.start, 23);
  assert.ok(ok.view?.kind === "spin" && ok.view.frames[0].src.startsWith(`${URL}/storage/v1/object/public/product-media/SH-0001/360/`));
});

test("a model needs a file and a photo for its poster; inside photos come only with a view", () => {
  const modelView: ViewRow = { ...spinView, kind: "model", model_path: "SH-0001/360/x.glb", model_bytes: 10 };
  assert.equal(attachView(piece, URL, { ...modelView, model_path: null }, []).view, undefined);
  assert.equal(attachView({ ...piece, images: [] }, URL, modelView, []).view, undefined);
  const withInside = attachView(piece, URL, modelView, [frame(1, "interior")]);
  assert.equal(withInside.view?.kind, "model");
  assert.equal(withInside.interior?.length, 1);
  assert.equal(attachView(piece, URL, undefined, [frame(1, "interior")]).interior, undefined, "no view, no inside button");
});
