// Renders still images of a .glb with <model-viewer> in headless Chromium. Serve this folder's
// render.html, model-viewer.min.js and the .glb files on http://127.0.0.1:3520 first (see README.md).
// Usage: node render.mjs <outDir> '<jobs JSON>'   (DSF=1.6 for zoom-size spin frames)
import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.argv[2];
const jobs = JSON.parse(process.argv[3]);
const DSF = Number(process.env.DSF || 1);
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const job of jobs) {
  // A fresh page per job: no state carried between models or colourways.
  const p = await b.newPage({ viewport: { width: 1000, height: 1250 }, deviceScaleFactor: DSF });
  p.setDefaultTimeout(60000);
  await p.goto("http://127.0.0.1:3520/render.html");
  await p.evaluate(async ({ src, variant }) => {
    const mv = document.getElementById("mv");
    const loaded = new Promise((r) => mv.addEventListener("load", r, { once: true }));
    mv.src = src;
    await loaded;
    if (variant) {
      const done = new Promise((r) => { mv.addEventListener("variant-applied", r, { once: true }); setTimeout(r, 4000); });
      mv.variantName = variant;
      await done;
    }
  }, job);
  fs.mkdirSync(`${OUT}/${job.id}`, { recursive: true });
  for (const shot of job.shots) {
    await p.evaluate((orbit) => { const mv = document.getElementById("mv"); mv.cameraOrbit = orbit; mv.jumpCameraToGoal(); }, shot.orbit);
    await p.waitForTimeout(job.wait ?? 400);
    await p.locator("#mv").screenshot({ path: `${OUT}/${job.id}/${shot.name}.png` });
  }
  await p.close();
  console.log("rendered", job.id, job.shots.length);
}
await b.close();
