# Asset sources

Every image and brand file used on the site, and where it came from. Update this file whenever an asset is added.

| File | Source | Type | Usage rule |
|---|---|---|---|
| `src/components/Wordmark.tsx`, `public/brand/sevn-hevn-wordmark.svg` | Vector trace of the wordmark in the supplied *SEVN_HEVN_Brand_and_Website_Concept* PDF (page 2, 2172×724 raster + alpha mask) | Brand logo | Both V cuts preserved. Diagonals straightened and the S smoothed during tracing. Checked on 27 Sep 2026 against the embedded artwork: 96% pixel overlap, differences only at 1 px edges. The same artwork appears in both PDFs (brand PDF pages 1–3, homepage PDF header and footer); no separate company logo exists. Replace with the original vector file from the designer when available. |
| `src/app/icon.svg`, `src/app/apple-icon.png` | "S" glyph taken from the traced wordmark, on Espresso | Favicon | — |
| `public/images/editorial/hero-emerald-noir.jpg` | Brand PDF, homepage hero (1672×941) | AI-generated editorial image (labelled so in the PDF) | Mood imagery only. Always shown with an "AI-generated editorial image" label. |
| `public/images/editorial/bag-emerald.jpg`, `bag-cobalt.jpg`, `bag-rose.jpg` | Homepage PDF, "Latest arrivals" (1122×1402) | AI-generated editorial | Editorial preview items only — never as proof of a real item. |
| `public/images/editorial/bag-cognac.jpg` | Brand PDF, marketing example (cropped to remove the burned-in wordmark and caption) | AI-generated editorial | Same as above. |
| `public/images/editorial/watch-gold-rectangular.jpg`, `loafer-cobalt-suede.jpg` | Homepage PDF, category images (1122×1402) | AI-generated editorial | Same as above. |
| `public/og-image.jpg` | 1200×630 crop of the hero image | Social sharing image | — |

## Notes

- The AI-generated images show designs and hardware that resemble well-known houses (for example a quilted bag with an interlocking-C clasp). They are labelled as AI-generated and are never named with a brand on the site. For the public launch, consider replacing them with real photography of genuine items, or editorial images without recognisable third-party logos.
- No competitor photography (including VIVENT) has been used.
- Real product photos go in Supabase Storage / `public/images/items/` — see README → "Adding products". Record their source here if they are not your own photos.
