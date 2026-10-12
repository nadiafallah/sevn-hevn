# Asset sources

Every image and brand file used on the site, and where it came from. Update this file whenever an asset is added.

| File | Source | Type | Usage rule |
|---|---|---|---|
| `src/components/Wordmark.tsx`, `public/brand/sevn-hevn-wordmark.svg` | Vector trace of the wordmark in the supplied *SEVN_HEVN_Brand_and_Website_Concept* PDF (page 2, 2172×724 raster + alpha mask) | Brand logo | Both V cuts preserved. Diagonals straightened and the S smoothed during tracing. Checked on 27 Sep 2026 against the embedded artwork: 96% pixel overlap, differences only at 1 px edges. The same artwork appears in both PDFs (brand PDF pages 1–3, homepage PDF header and footer); no separate company logo exists. Replace with the original vector file from the designer when available. |
| `src/app/icon.svg`, `src/app/apple-icon.png` | "S" glyph taken from the traced wordmark, on Espresso | Favicon | — |
| `public/images/editorial/hero-emerald-noir.jpg` | Brand PDF, homepage hero (1672×941) | AI-generated editorial image (labelled so in the PDF) | Mood imagery only. Always shown with an "AI-generated editorial image" label. |
| `public/images/editorial/bag-emerald-v2.jpg`, `bag-cobalt-v2.jpg`, `bag-rose-v2.jpg` | Homepage PDF, "Latest arrivals" (1122×1402). The JPEGs embedded in the PDF, copied byte for byte (not re-encoded) | AI-generated editorial | Editorial preview items only — never as proof of a real item. |
| `public/images/editorial/bag-cognac-v2.jpg` | Brand PDF, marketing example: the embedded 1122×1402 JPEG, cropped to rows 290–1317 to remove the burned-in wordmark and caption, saved once at quality 95 (4:4:4) | AI-generated editorial | Same as above. |
| `public/images/editorial/watch-gold-rectangular-v2.jpg`, `loafer-cobalt-suede-v2.jpg` | Homepage PDF, category images (1122×1402), copied byte for byte from the PDF | AI-generated editorial | Same as above. |
| `public/og-image.jpg` | 1200×630 crop of the hero image | Social sharing image | — |
| `public/images/hero/bag-cognac-cutout.png` | `bag-cognac.jpg` (brand PDF, AI-generated) with the background removed locally by rembg 2.0.61 (MIT) and the isnet-general-use model; trimmed to 791×805. On 12 Oct 2026 its colour was retaken from the PDF original (offset 166, 330) under the same mask | AI-generated editorial, cut out | Homepage hero stage only, always with the “AI-generated editorial image” line. Shape, colour and hardware are unchanged. Replace with a cut-out of a real piece via `src/data/hero.ts`. |

## Image quality (12 Oct 2026)

- The site's first copies of the editorial images had been re-saved as JPEG once more than the PDFs, which added compression noise. The `-v2` files come straight from the PDFs instead: same pixels, crop and colours (average difference under 0.5 of 255 per channel), without that extra layer of artefacts. No larger originals exist; nothing was upscaled, sharpened, retouched or generated.
- The `-v2` names make browsers and Vercel's image cache fetch the new files instead of the old cached copies.
- Images are served by `next/image` as AVIF or WebP at the width each screen needs. `sizes` allows for crops (`coverSizes` in `src/lib/images.ts`) and for the zoom on the category doors.
- The product panel shows the main photo at quality 85. On desktop, a photo wider than the frame (the cognac bag) is shown whole over a soft blur of itself instead of being cut at the sides.

## Notes

- The AI-generated images show designs and hardware that resemble well-known houses (for example a quilted bag with an interlocking-C clasp). They are labelled as AI-generated and are never named with a brand on the site. For the public launch, consider replacing them with real photography of genuine items, or editorial images without recognisable third-party logos.
- No competitor photography (including VIVENT) has been used.
- Real product photos go in Supabase Storage / `public/images/items/` — see README → "Adding products". Record their source here if they are not your own photos.
