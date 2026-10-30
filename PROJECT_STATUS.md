# Project status: SEVN HEVN

Last updated: 30 October 2026

## Compliance on the website (30 Oct 2026)

Branch `feat/compliance-on-site`. The website now follows the approved rules. Details: [docs/COMPLIANCE.md](docs/COMPLIANCE.md), "What the website does with the rules".

| Part | State |
| --- | --- |
| Returns notice built from the rules (change of mind 7 days, faults without warranty 30 days from when they appear, discount within 7 days) | done; still labelled interim |
| Checkout tick box for the returns notice and terms, checked on the server and stored with the request | done |
| Product page: returns line from the rules, country of origin, materials in Arabic | done (fields filled in the panel) |
| Panel: origin and Arabic fields; pre-owned pieces need condition notes to publish; Compliance → "On the website" | done |
| Migration `20261030120000_compliance_site.sql` | **not applied in production yet**, together with the three earlier pending ones (`20261007…`, `20261011…`, `20261013…`). The assistant's database connector was refused for production schema changes; the combined file goes to the owner for the SQL Editor. Until then the site uses the built-in defaults (same values) and hides the new product fields |

## Compliance ledger (27 Oct 2026)

Branch `feat/compliance-ledger`. A ledger of the UAE rules for selling online, with a weekly monitor and owner approval. Details: [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

| Part | State |
| --- | --- |
| Database: rules, official sources, monitor runs, changes; owner-only decision function | done; migration `20261027191858_compliance.sql` **applied in production** 27 Oct 2026 |
| Starting data: 22 rules, 12 official sources | loaded in production. 15 confirmed by several sources, 2 disputed (change-of-mind returns, personal data law), 2 for a lawyer (free-zone selling, insurance), 3 single-source. 2 checked against the official text so far |
| Weekly monitor ("Seven Heaven compliance monitor", Mondays 08:31 Dubai) | scheduled in Claude; first run 2 Nov 2026. Emails the owner a Persian report; approvals by reply or in the panel |
| Panel → Compliance (`/admin/compliance`, owner only) | done: pending changes with Approve / Reject, rules, sources, runs, decisions |
| Website reading the rules (checkout, returns policy, invoices) | **not yet**. Policies in `src/content/policies.ts` are unchanged |

Tests: `supabase/tests/compliance.test.mjs` (access rules, owner-only decisions, amendment, rejection, new rule, repeal, verification). Run in CI; the session that built this had no npm registry access, so local checks were not run.

## Home hero film (17 Oct 2026)

Branch `feat/hero-video`. The home hero shows the new approved image (three women, a black top-handle bag, an emerald tote) with a cinemagraph made from it: a breeze through the hair and the satin dresses, the seated woman slowly uncrossing and recrossing her legs, the woman in espresso brushing back her hair, breathing and blinks; no camera move. Headline, buttons and links are unchanged and remain HTML over the empty wall.

| Part | State |
| --- | --- |
| Film | Higgsfield, Kling O3 first-last-frame (pro, 10 s, 16:9, no sound), with the approved image as both start and end frame. Kling 3.0 was not used: Higgsfield refuses it on the account's Basic plan ("requires plus plan or higher"). Second version (17 Oct 2026), asked for by the owner because the first one only blinked. A take where the woman in espresso opened the emerald tote was rejected: the bag changed design (padlock gone, a flap appeared). The kept take was reviewed frame by frame: faces, skin tones, bags (the tote keeps its padlock), watches, jewellery and shoes keep their shape; legs stay sharp apart from light motion blur. Made into a seamless 9.5 s loop with a 0.5 s cross-fade. Leg fix (17 Oct 2026, branch `fix/hero-leg-still`): twice during the leg cross the model drew the moving shin white, then snapped it into place, which showed as a jump. The leg cross (with the head turns and hand moves around it) is cut out: a calm 2.75 s loop of the opening and closing moments, legs crossed, wind in the hair and dresses |
| Files | `public/video/hero-maison-trio-1080.mp4` (1920×1080, 1.0 MB) for screens 900 px and wider; `hero-maison-trio-mobile.mp4` (1092×900, 0.5 MB), cut to the phone framing. H.264, no audio track |
| Loading | The still (`next/image`, priority) is the first paint and the fallback. The film is requested only after the page has loaded, and fades in once it is actually playing |
| Motion preferences | With "reduce motion" or Data Saver on, the film is not downloaded and the still stays; the play button starts it on request. Autoplay refused by the browser (e.g. iOS Low Power Mode) leaves the still with the play button |
| Controls | A small pause/play button in the hero's lower right corner (WCAG 2.2.2); the film also pauses while the hero is scrolled out of view |
| Framing | Desktop: the photograph always keeps its full height (heads and shoes) on the right; on screens wider than 16:9 its wall continues behind the headline. Phones: the right-hand part of the image, with all three figures and every piece |
| Labelling | No label on the hero: the owner asked for the "AI-generated editorial image" line to be removed (17 Oct 2026). The category cards keep their "AI editorial image" label |

## English only (14 Oct 2026)

Branch `feat/english-only`. The website and the concierge chat are English only. The Arabic, Russian and French versions (Oct 2026) are retired.

| Part | State |
| --- | --- |
| Pages, menus, product pages, forms, bag, checkout messages, policies and metadata | English only. `src/i18n/` keeps one dictionary, and `<html lang="en" dir="ltr">` is set on every page |
| Language selector (utility bar, menu drawer, chat) | removed. Nothing switches language automatically |
| Old addresses `/ar/…`, `/ru/…`, `/fr/…` (and `/en/…`) | redirect permanently (308) to the same page in English, in one step. The old `/collection?item=…` and `?category=…` forms go straight to the new shop address |
| Saved language choice | the `sevn-hevn-lang` cookie is ignored and cleared on the next visit. A chat conversation saved in the browser in another language is not resumed: a new one starts in English |
| Language metadata | no `hreflang` alternates. `og:locale` is `en_AE`, with no alternate locales. WebSite `inLanguage` is `en`. The sitemap lists each page once |
| Concierge chat | replies only in English, whatever language the customer writes in. Arabic, Russian and French words (brands, categories, colours, countries, yes/no) are still understood. Only English store-knowledge entries are quoted. A conversation saved in another language continues in English |
| Database | unchanged. New requests and conversations are stored as `en`. Older records keep their language label in the panel |
| Fonts | Arabic fonts and the Cyrillic subsets removed (smaller downloads) |

Tests (14 Oct 2026): `npm run typecheck`, `npm run lint`, `npm run build`; `npm run test:unit` 35 of 35; e2e 28 of 28 (local stack). The e2e suite covers Arabic, Russian and French input answered in English, old addresses, the remembered-language cookie and an old saved chat. A browser review made 48 page loads (Chromium desktop, laptop, tablet and phone; WebKit desktop and phone) with `lang="en"`, no horizontal scroll, no language controls, no Arabic or Cyrillic text, and no serious axe findings. Not run: HawkScan (no CLI or API key).

## Shop: four categories, permitted houses, product pages, checkout (13 Oct 2026)

Branch `feat/shop-four-categories`. Not on the live site until it is merged and the database update is run. Details: [docs/SHOP.md](docs/SHOP.md).

| Part | State |
| --- | --- |
| Four categories (Bags, Shoes, Watches, Jewellery; Jewellery replaces Accessories) and their few types | done: site, menu, search, sourcing form, chat, panel and database |
| Permitted houses only (Hermès, Louis Vuitton, Gucci, Chanel; plus Cartier, Van Cleef & Arpels, Bvlgari for Jewellery) | done: enforced in the catalogue, the panel, the forms, the chat's choices and the database (pieces outside are hidden, never deleted) |
| Header with a menu per category (houses, types, real pieces), click / keyboard / hover; phone drawer with fold-out sections | done |
| Home: hero, four category cards, new arrivals (real pieces only), houses, special request + WhatsApp | done |
| Category / house pages with filters from real data, sorting, shareable addresses, Back | done |
| Product pages with gallery, zoom, versions (colour / size / hardware), details per category, related pieces, structured data | done |
| Bag with versions; checkout (bag re-checked on the server → details → delivery → payment notice) storing a purchase request in the panel | done; **online payment not connected** (no provider or merchant account) |
| Redirects from the old addresses (308) | done |
| Footer: wordmark, then four columns (Support, Follow us, Contact, Newsletter) on black, legal lines underneath | done (14 Oct 2026) |
| Newsletter sign-up in the footer: name + email, consent wording stored, rate limited, production only | done; needs migration `20261014120000_newsletter.sql` (independent of the others). Until it runs, the form answers "couldn't add you just now" and stores nothing |
| Database migration `20261013120000_shop_four_categories.sql` | **not applied in production yet** (with the two pending earlier ones; the SQL file is with the owner) |
| Real pieces | none published. Four documented pieces from the shop's own Instagram exist as private-preview drafts only, waiting for the owner's confirmation of price, stock and details |
| Fix: home / chat / checkout answered 404 after a catalogue refresh (since the language release) | fixed in this branch |

Tests (13 Oct 2026): `npm run typecheck`, `npm run lint`; `npm run test:unit` 35 of 35; `npm run db:test` 43 of 43; `tests/e2e/run.sh` 27 of 27. A browser review made 264 page loads (Chromium, Firefox and WebKit; desktop and phone; four languages; eleven pages) with no horizontal scroll, no errors and no broken images. The axe scan found no serious or critical issues, including with the menu open. Not run: HawkScan (no CLI or API key), real phones and real Safari.

## Website languages (Oct 2026, retired 14 Oct 2026, see "English only" above)

The public site was in English, Arabic (right-to-left), Russian and French. English keeps the unprefixed addresses (`/`, `/collection`, `/chat`); the others live under `/ar`, `/ru` and `/fr`. `/en/…` redirects to the unprefixed address. Every page lists the other languages with `hreflang`.

| Part | State |
| --- | --- |
| Pages, panels, forms, bag, policies, metadata and sitemap in four languages | done (`src/i18n/`) |
| Language selector: utility bar (all screen sizes) and menu drawer | done; the choice is remembered in a cookie and the open panel, form fields and chat carry over |
| Arabic typography and right-to-left layout | IBM Plex Sans Arabic and Noto Naskh Arabic, no letter-spacing on Arabic, logical CSS properties; the hero copy stays on the lit wall of the photograph |
| Concierge chat | English, Arabic, Russian and French (11 Oct 2026): it opens in the page's language and can be switched without losing the conversation. Migration `20261011120000_concierge_languages.sql` must be run in production; until then Russian and French requests are saved marked English |
| Product text per language | not stored yet: database items show their English text in every language |
| Native-speaker review of the Russian and French wording | recommended |

Also in this release: Instagram links point to @sevnhevn.dubai, buttons have rounded corners with a moving border, the header switches to the menu button where its links no longer fit beside the wordmark, and the mobile Collection filters no longer widen the page.

Tests (10 Oct 2026): `npm run check`; `npm run db:test` 36 of 36; `npm run test:unit` 19 of 19; `tests/e2e/run.sh` 17 of 17; a browser check of home, Collection and chat in all four languages at 1440 px and 390 px (no horizontal overflow, no console errors, no serious axe findings; bag and language selector open). `npm run typecheck` now runs `next typegen` first, so route types exist on a clean checkout.

## Concierge chat and private panel (6 Oct 2026)

Built, tested and deployed. **Dormant until the one-time database setup is run.** Details: [docs/CONCIERGE.md](docs/CONCIERGE.md).

| Part | State |
| --- | --- |
| Customer chat: widget on every page and `/chat`, English only (since 14 Oct 2026) | in production code; hidden until the database setup is run (`/chat` honestly says “not available” with WhatsApp and phone) |
| Private panel `/admin`: owner and staff roles, requests, customers, orders, knowledge, team, export, audit | in production code; sign-in grants access after the database setup |
| Database migration `20261006120000_concierge_crm.sql` | **not applied yet**. The assistant’s Supabase connector refuses schema changes, so the owner must run it once in the SQL Editor (CONCIERGE.md §2.0). A tested file with the migration, server-key hash and owner entry is on the owner’s Desktop: `SEVN-HEVN-production-setup.sql`. |
| Vercel env `CONCIERGE_SERVER_KEY`, `CRON_SECRET` (Production, Secret) | set 6 Oct 2026 |
| E-mail notifications (SMTP of info@sevnhevn.ae) | needs connection: mailbox password in Vercel (CONCIERGE.md §5.1) |
| WhatsApp notifications (Meta Cloud API) | needs connection (CONCIERGE.md §5.2); manual “Open WhatsApp” link in the panel works |
| Order status in the chat | waits for e-mail; until then customers get a call-back request, no order details shown |
| AI assistance | built, off (paid API; owner decision, CONCIERGE.md §7) |
| Supabase Auth URL settings | recommended: Site URL `https://www.sevnhevn.ae`, redirect `https://www.sevnhevn.ae/admin/**`; custom SMTP for staff e-mails |

Decisions:

- **Database writes from the website.** These use a dedicated server key whose hash is in the database and which can only call the chat’s functions. The all-powerful secret key is not used. This is least privilege, and it no longer depends on adding `SUPABASE_SECRET_KEY`.
- **Panel sign-in.** Supabase Auth (email + password) with httpOnly cookies. Only people the owner adds can set up access. Roles are enforced in the database: RLS for reads, role-checked functions for writes, and an audit log.
- **Owner identity.** The owner is the account e-mail used for GitHub, Vercel and Supabase. Staff are added in the panel.
- **Test data.** Uses the Ofcom fiction phone range (+44 7700 900xxx). It is marked as test and kept out of statistics.
- **Public pages moved into a route group.** `src/app/(site)/` lets the panel have its own layout. The site itself is unchanged.

Tests (6 Oct 2026, commit on `main`):

- `npm run check` (typecheck, lint, build) passed.
- `npm run db:test`: 28 of 28 (9 existing + 19 new access-rule tests).
- `npm run test:unit`: 18 of 18.
- `tests/e2e/run.sh`: 11 of 11 browser scenarios on a local Postgres + PostgREST stack. Covers desktop and mobile, English and Arabic, photo with GPS removed, panel roles, server-side refusals, order verification, e-mail failure and retry, existing pages, and the axe accessibility scan.
- Not run: the HawkScan DAST scan (CLI and API key not installed), and live chat/panel tests (blocked by the pending database setup).

## Earlier work

- **Redesign (27 Sep 2026), closer to the homepage PDF:** three-tier header (utility bar, large centred wordmark with Menu / Search / Bag, full category row in the concept's order), full-bleed hero with staggered text entrance, centred introduction with numbered pillars, three category doors, "Latest arrivals" (three editorial previews with the concept's captions; a swipe row on phones), Personal shopping band with the sourcing form, "Discover more" category row, private viewing, and a new footer. Fixed a hydration error on every page and canonical / Open Graph URLs that pointed at protected per-deployment URLs.

- **Brand:** the wordmark was traced to vector from the brand PDF (both V cuts kept; checked against the embedded artwork at 96% pixel overlap). It is shown large and centred in the header (about 400 px wide on desktop, 226 px on phones, settling to a compact size on scroll), in the menu drawer and at full size in the footer. The footer carries the company name SEVN HEVN MAISON GENERAL TRADING L.L.C. The favicon is the "S" glyph. The brand colour tokens are Ivory, Espresso, Champagne and Black, and the typeface is Jost (self-hosted through next/font).
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
- **SEO:** titles and descriptions, Open Graph image, canonical URLs, Organization JSON-LD, and Product JSON-LD for genuine items only. The sitemap is in place. Indexing is on in production since 10 Oct 2026 (`SITE_INDEXING=true`); see the Search engines section in `docs/DEPLOYMENT.md`.
- **Security headers:** CSP, X-Frame-Options, nosniff, Referrer-Policy and HSTS.
- **Supabase catalogue, website-sent enquiry storage, `/api/revalidate`, CI and backups:** added by a parallel session (commits eaebc6e, 0a38adc, 8b82df9). See `docs/SUPABASE.md`, `docs/DEPLOYMENT.md` and `docs/BACKUPS.md`. The Supabase project and Vercel deployment are waiting for the owner to choose a region and plan and to log in.
- **GitHub:** public repository https://github.com/nadiafallah/sevn-hevn (public since 28 Sep 2026).

## Checks run (27 Sep 2026, re-run on commit 8b82df9)

- `tsc --noEmit`, `eslint .` and `next build` passed.
- Screenshots at 1440 px and 390 px of Home, Collection and the item panel. No horizontal overflow and no console errors.
- `npm run db:test`: 9 of 9 migration and database tests passed (RLS, enquiry privacy, rate limiting, product states, storage rules).
- 31 automated browser checks with Playwright against a local production build, using temporary test items that were not committed. Supabase was not configured, so the static catalogue fallback was used. All 31 passed. The checks covered:
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
  - the "send from the website" option honestly shows as switched off outside production (`/api/enquiries` returns 503 `enquiries_unavailable` locally)
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

Concierge (6 Oct 2026):

- **Run the one-time concierge database setup** (docs/CONCIERGE.md §2.0). Then sign in at `/admin/setup` or `/admin/login`.
- Add the `info@sevnhevn.ae` mailbox password as `SMTP_PASSWORD` (plus `SMTP_HOST`, `SMTP_USER`, `NOTIFY_EMAIL_TO`) in Vercel Production to turn on e-mail alerts and order checks.
- Decide on WhatsApp Cloud API and AI (both cost money; see CONCIERGE.md).

Earlier items:


1. Real inventory: photos, prices in AED, condition, year, what's included, documentation, and delivery and returns details per item.
2. Office address and visit process, if a street address should appear. Until then the site shows "Dubai, UAE" only.
3. Final trade licence number and issuing authority, to go in `site.licence`.
4. Approved shipping, returns, privacy and terms text.
5. A payment provider and merchant account, with credentials added only through Vercel environment variables.
6. Optional: DNS change at GoDaddy for sevnhevnmaison.com (values in docs/DEPLOYMENT.md), so it redirects to https://www.sevnhevn.ae. The main domain www.sevnhevn.ae is live.
7. A Facebook URL (optional).
8. The original logo vector file from the designer (optional, better than the trace).

## Next actions

- After the database setup: run a controlled live test, using an Ofcom test number, of the widget, `/chat`, the panel sign-in and a request. Then delete the test request from the panel.
- Approve English store-knowledge entries, and replace the interim policies when final.
- Roadmap (CONCIERGE.md §11): stock sync, request analytics, saved replies, follow-up reminders, and a customer order page.

- After the Supabase and Vercel work lands: re-run `npm run check` and the browser checks against the preview deployment.
- Add real items and review the item panel with genuine data.
- Done: `SITE_INDEXING=true` on production (10 Oct 2026); `www.sevnhevn.ae` is the canonical hostname, with `sevnhevn.ae` and `sevn-hevn.vercel.app` redirecting to it.
