# Asset sources

Every image and brand file used on the site, and where it came from. Update this file whenever an asset is added.

| File | Source | Type | Usage rule |
|---|---|---|---|
| `src/components/Wordmark.tsx`, `public/brand/sevn-hevn-wordmark.svg` | Vector trace of the wordmark in the supplied *SEVN_HEVN_Brand_and_Website_Concept* PDF (page 2, 2172×724 raster + alpha mask) | Brand logo | Both V cuts preserved. Diagonals straightened and the S smoothed during tracing. Checked on 27 Sep 2026 against the embedded artwork: 96% pixel overlap, differences only at 1 px edges. The same artwork appears in both PDFs (brand PDF pages 1–3, homepage PDF header and footer); no separate company logo exists. Replace with the original vector file from the designer when available. |
| `src/app/icon.svg`, `src/app/apple-icon.png` | "S" glyph taken from the traced wordmark, on Espresso | Favicon | — |
| `public/images/editorial/hero-maison-trio.jpg` | Hero image approved by the owner on 17 Oct 2026 (1672×941 PNG, re-encoded as JPEG, metadata removed) | AI-generated editorial image | Home hero still: shown first, and whenever the film doesn't play. Shown without a label at the owner's request (17 Oct 2026). |
| `public/video/hero-maison-trio-1080.mp4`, `hero-maison-trio-mobile.mp4` | Animated from `hero-maison-trio.jpg` on Higgsfield (Kling O3 first-last-frame, pro, 10 s, 16:9, no sound; the approved image as start and end frame), 17 Oct 2026; second version, with wind in the hair and dresses and the seated woman uncrossing and recrossing her legs. Made into a seamless 9.5 s loop with a 0.5 s cross-fade and encoded as H.264 without audio: 1920×1080 and a 1092×900 phone cut of the right-hand side. Leg fix (17 Oct 2026): in two moments of the leg cross (frames 59–71 and 139–153) the model drew the moving shin white and then snapped it into place; in those frames the leg area is replaced by motion-interpolated frames between the last good frame before and the first good frame after (ffmpeg minterpolate), everything outside the legs untouched. Re-encoded: 1920×1080 (2.4 MB), phone 1092×900 (1.4 MB) | AI-generated editorial film | Home hero cinemagraph over the still, without a label. Never a product film. |
| `public/images/editorial/hero-emerald-noir.jpg` | Brand PDF, homepage hero (1672×941) | AI-generated editorial image (labelled so in the PDF) | No longer the home hero (replaced 17 Oct 2026). Kept as the source of `og-image.jpg`. |
| `public/images/editorial/bag-emerald.jpg`, `bag-cobalt.jpg`, `bag-rose.jpg` | Homepage PDF, "Latest arrivals" (1122×1402) | AI-generated editorial | No longer shown (the shop lists real pieces only). Kept for reference. |
| `public/images/editorial/bag-cognac.jpg` | Brand PDF, marketing example (cropped to remove the burned-in wordmark and caption) | AI-generated editorial | Home category card for Bags **only until a real bag photo is published**; always labelled "AI editorial image". Never a product photo. |
| `public/images/editorial/watch-gold-rectangular.jpg`, `loafer-cobalt-suede.jpg` | Homepage PDF, category images (1122×1402) | AI-generated editorial | Same, for Watches and Shoes. Jewellery has no stand-in: its card is typographic until a real photo exists. |
| `public/og-image.jpg` | 1200×630 crop of the hero image | Social sharing image | — |

## Product photos (rules)

- A product photo shows **that model in that colour, size and version**. Never a similar model, another colour or size, another house, or an AI-generated image.
- Use your own photos first. A catalogue photo from a house or a retailer needs permission to reuse it (being publicly visible is not permission), and it only introduces the model: it is not proof that SEVN HEVN holds the piece. A pre-owned or one-of-a-kind piece needs photos of that actual piece.
- Never remove a watermark. Store photos in the panel (Supabase Storage) — never hot-link another site.
- Record each photo's source, the model it shows and the permission held, in the private register kept with the owner's files (not in this public repository).
- Photos are uploaded through the panel, which re-encodes them and removes hidden data (camera, location).
- Drafts for the private design preview (`public/drafts/`, built by `scripts/drafts/build.mjs`) are the shop's own Instagram photos, resized only; they are git-ignored and never published from here.

## Notes

- The AI-generated images show designs and hardware that resemble well-known houses (for example a quilted bag with an interlocking-C clasp). They are labelled as AI-generated and are never named with a brand on the site. For the public launch, consider replacing them with real photography of genuine items, or editorial images without recognisable third-party logos.
- No competitor photography (including VIVENT) has been used.
- Real product photos go in Supabase Storage / `public/images/items/` — see README → "Adding products". Record their source here if they are not your own photos.
