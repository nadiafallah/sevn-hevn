# Showcase samples for the 360° preview

These scripts build the demonstration samples in `public/showcase/` and the data file `src/data/showcase.ts`.

- Samples appear only on the protected Vercel preview of `feat/product-360`, or locally with `SHOWCASE_PREVIEW=true`. They never appear in production.
- They are not for sale.
- Do not merge `public/showcase/` or `src/data/showcase.ts` into `main` together with the 360° system. The samples stay in the preview only.

## Sources (checked 11 Oct 2026)

| Sample | Source | Licence | Author |
| --- | --- | --- | --- |
| Chronograph watch (4 colourways) | [Khronos glTF Sample Assets: ChronographWatch](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ChronographWatch) | CC BY 4.0 | Eric Chadwick (Darmstadt Graphics Group), after “Chronograph Watch Mudmaster” by graphiccompressor |
| Knit sneaker (3 colourways, plus the photo spin) | [Khronos: MaterialsVariantsShoe](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MaterialsVariantsShoe) | CC BY 4.0 | Shopify |
| Aviator sunglasses | [Khronos: SunglassesKhronos](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SunglassesKhronos) | CC BY 4.0 | Eric Chadwick (Darmstadt Graphics Group) |
| Pocket watch | [Poly Haven: pocket_watch](https://polyhaven.com/a/pocket_watch) | CC0 | PierreB3D |
| Engraved pocket watch | [Poly Haven: vintage_pocket_watch](https://polyhaven.com/a/vintage_pocket_watch) | CC0 | Tal Swicegood |
| Steel digital watch | [Poly Haven: digital_wrist_watch](https://polyhaven.com/a/digital_wrist_watch) | CC0 | Adrian C |
| Rubber boots (clean pair only) | [Poly Haven: rubber_boots](https://polyhaven.com/a/rubber_boots) | CC0 | L |
| Round spectacles | [Poly Haven: round_spectacles](https://polyhaven.com/a/round_spectacles) | CC0 | Sean Buckley |
| Bucket hat | [Poly Haven: fishermans_hat](https://polyhaven.com/a/fishermans_hat) | CC0 | PierreB3D |
| Vintage suitcases (plain, and with labels; split from one scene) | [Poly Haven: vintage_suitcase](https://polyhaven.com/a/vintage_suitcase) | CC0 | Maximilian Schuster |

### Sources not used

- **Brand websites (Hermès, Chanel, Louis Vuitton, Gucci).** They block automated access (HTTP 403). Their photographs are copyrighted, so they were not used.
- **Handbags.** No openly licensed 3D model of a handbag was found. The Smithsonian Open Access 3D collection has none. The bag category therefore shows the two travel suitcases.

## Recipe

1. **Download the source models.**
   - Khronos models: the `.glb` from `glTF-Binary/`.
   - Poly Haven models: the 1k glTF, through `https://api.polyhaven.com/files/<id>`.
2. **Convert and shrink** with `npx @gltf-transform/cli@4`:
   - `copy model.gltf model.glb`
   - `resize --width 1024 --height 1024`
   - `webp`
   - Use no Draco or Meshopt compression: the site's security policy allows no decoder.
3. **Split multi-item scenes**, e.g. `node split.mjs vintage_suitcase.glb suitcase_plain.glb "^vintage_suitcase_02_"`. Check visually which node is which.
4. **Serve the files.** Put `render.html`, `node_modules/@google/model-viewer/dist/model-viewer.min.js` and the `.glb` files in one folder. Serve it with `python3 -m http.server 3520 --bind 127.0.0.1`.
5. **Render the gallery angles** with `node render.mjs <out> '<jobs>'`. Each job looks like `{id, src, variant?, wait?, shots:[{name, orbit}]}`.
6. **Render the spin frames** with `DSF=1.6 node render.mjs …`, using 36 shots at `i*10deg 72deg auto`.
7. **Process the renders:**
   - `node process.mjs gallery <renders>/<id> public/showcase/<id> 0.74`
   - `node process.mjs spin <renders>/spin public/showcase/sneaker-spin`
8. **Write the data file:** `python3 scripts/showcase/build-data.py`.
