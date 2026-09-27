# Project status: SEVN HEVN

Last updated: 27 September 2026

## Done

- **Brand:** the wordmark was traced to vector from the brand PDF (both V cuts kept) and is used in the header and footer. The favicon is the "S" glyph. The brand colour tokens are Ivory, Espresso, Champagne and Black, and the typeface is Jost (self-hosted through next/font).
- **Home (`/`):**
  - hero with "Welcome to your happy place." and an AI-image label
  - maison introduction
  - Bags / Watches / Shoes category entries, plus a "request anything else" link
  - curated edit, labelled "Editorial preview"
  - private sourcing form
  - private viewing request
  - footer with company name, contact details, Instagram, policy panels and the independent-reseller statement
- **Collection (`/collection`):**
  - URL-synced category tabs and search
  - designer, availability, condition and price filters, each shown only when the data supports it
  - helpful empty state that offers a sourcing request
  - item panel at `/collection?item=REF`, server-rendered with metadata; direct load, refresh, Back and Forward all work
- **Enquiries:** sourcing and viewing forms validate input and then hand off to WhatsApp or email, with the message prepared and correctly encoded. The site never shows a fake "sent" confirmation. Item enquiries include the name, reference and URL. A persistent WhatsApp button hides while a panel is open.
- **Bag:** stored in localStorage; one-off pieces are limited to quantity 1. Unavailable, sold or unknown items are flagged and left out of the subtotal. The checkout API re-checks everything on the server and ignores browser prices. With no payment provider connected, it returns an honest "not available yet" message and a WhatsApp handoff.
- **Honesty rules in data:** an item marked "available" without a price, stock or delivery details is shown as enquiry-only. The site never shows AED 0. Demo records are rejected by checkout and never included in structured data.
- **SEO:** titles and descriptions, Open Graph image, canonical URLs, Organization JSON-LD, and Product JSON-LD for genuine items only. The sitemap is in place. Robots and `noindex` apply until `SITE_INDEXING=true`.
- **Security headers:** CSP, X-Frame-Options, nosniff, Referrer-Policy and HSTS.
- **Supabase catalogue, enquiry storage, GitHub and Vercel:** handled by a parallel session. See `docs/`.

## Checks run (27 Sep 2026, commit 9414bea, before the Supabase changes)

- `tsc --noEmit`, `eslint .` and `next build` passed.
- Screenshots at 1440 px and 390 px of Home, Collection and the item panel. No horizontal overflow and no console errors.
- 30 automated browser checks with Playwright against the production build, including test items (not committed). All passed, apart from one assertion that was wrong in the test itself: it did not allow for the non-breaking space in "AED 18,500". The checks covered:
  - shared item URL, Escape, Back and Forward
  - filter URL and Back
  - search and the empty state
  - WhatsApp encoding
  - form errors and focus
  - bag panel focus trap and focus return
  - scroll lock
  - bag persistence
  - quantity limits
  - stale or sold items
  - server revalidation and the 503 unavailable state
  - policy deep link
  - mobile menu to panel
  - WhatsApp button against bag overlap
- API checks with curl: bad JSON, empty bag, unknown / demo / sold / unpriced / over-quantity items, and browser-sent prices ignored.
- Not run: a HawkScan DAST scan (the HawkScan CLI and API key are not installed), real-device iOS/Android testing and a screen-reader pass.

## Known issues / limits

- The editorial images are AI-generated and resemble designs from known houses. They are labelled clearly, but real photography is recommended before a public launch (see ASSETS.md).
- The policies are interim notices that say only what is true today. They are not final business policies.
- Items have no individual pages; see the README for the SEO note.
- On small phones the floating WhatsApp button can briefly cover part of a card while scrolling.

## Waiting on the owner

1. Real inventory: photos, prices in AED, condition, year, what's included, documentation, and delivery and returns details per item.
2. Office address and visit process, if a street address should appear. Until then the site shows "Dubai, UAE" only.
3. Final trade licence number and issuing authority, to go in `site.licence`.
4. Approved shipping, returns, privacy and terms text.
5. A payment provider and merchant account, with credentials added only through Vercel environment variables.
6. Domain registrar or DNS access for sevnhevnmaison.com.
7. A Facebook URL (optional).
8. The original logo vector file from the designer (optional, better than the trace).

## Next actions

- After the Supabase and Vercel work lands: re-run `npm run check` and the browser checks against the preview deployment.
- Add real items and review the item panel with genuine data.
- When approved, set `SITE_INDEXING=true` on production, connect the domain with the host's DNS values, and choose one canonical hostname (apex or www) with a redirect from the other.
