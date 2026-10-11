// Usage: node process.mjs gallery|spin <renders dir> <public/showcase/… dir> [fill]
// Trims each render to the piece (plus its shadow), centres it on the site's ivory in a 4:5 frame,
// and writes WebP. Spin frames share ONE crop box so the piece never jumps between angles.
import { createRequire } from "node:module";
const sharp = createRequire(import.meta.url)("sharp");
import fs from "node:fs";
import path from "node:path";
const BG = { r: 237, g: 229, b: 216 };

// The 3D viewer's loading bar can leave a thin line along the top edge: paint the top rows ivory.
const clean = async (file) => {
  const m = await sharp(file).metadata();
  const cut = Math.round(12 * (m.width / 1000));
  return sharp(file).removeAlpha().extract({ left: 0, top: cut, width: m.width, height: m.height - cut }).extend({ top: cut, background: BG }).png().toBuffer();
};

async function bbox(file) {
  const { data, info } = await sharp(await clean(file)).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      if (Math.abs(data[i] - BG.r) + Math.abs(data[i + 1] - BG.g) + Math.abs(data[i + 2] - BG.b) > 18) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  return { x0, y0, x1, y1, w: info.width, h: info.height };
}

function frameBox(b, fill) {
  // Smallest 4:5 box around the content, with the content filling `fill` of it.
  const cw = (b.x1 - b.x0 + 1) / fill, ch = (b.y1 - b.y0 + 1) / fill;
  let w = Math.max(cw, ch * 0.8), h = w / 0.8;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return { left: Math.round(cx - w / 2), top: Math.round(cy - h / 2), width: Math.round(w), height: Math.round(h) };
}

async function write(file, box, out, width, quality = 82) {
  const meta = await sharp(file).metadata();
  // Extend with ivory where the box leaves the render, then crop.
  const pad = { top: Math.max(0, -box.top), left: Math.max(0, -box.left), bottom: Math.max(0, box.top + box.height - meta.height), right: Math.max(0, box.left + box.width - meta.width) };
  const buf = await sharp(await clean(file)).extend({ ...pad, background: BG }).toBuffer();
  await sharp(buf)
    .extract({ left: box.left + pad.left, top: box.top + pad.top, width: box.width, height: box.height })
    .resize(width, Math.round(width * 1.25))
    .webp({ quality })
    .toFile(out);
}

const [mode, src, dest, fillArg] = process.argv.slice(2);
fs.mkdirSync(dest, { recursive: true });
const files = fs.readdirSync(src).filter((f) => f.endsWith(".png")).sort();
if (mode === "gallery") {
  for (const f of files) {
    const box = frameBox(await bbox(path.join(src, f)), Number(fillArg || 0.78));
    await write(path.join(src, f), box, path.join(dest, f.replace(".png", ".webp")), 1200);
  }
} else {
  let u = null;
  for (const f of files) {
    const b = await bbox(path.join(src, f));
    u = u ? { x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) } : b;
  }
  const box = frameBox(u, 0.86);
  for (const f of files) {
    const n = f.replace(".png", "");
    await write(path.join(src, f), box, path.join(dest, `${n}.webp`), 800, 80);
    await write(path.join(src, f), box, path.join(dest, `${n}-zoom.webp`), 1600, 82);
  }
}
console.log(mode, src.split("/").pop(), files.length);
