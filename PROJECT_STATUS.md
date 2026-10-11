# Project status: SEVN HEVN

Last updated: 10 October 2026

## Website languages (Oct 2026)

The public site is in English, Arabic (right-to-left), Russian and French. English keeps the unprefixed addresses (`/`, `/collection`, `/chat`); the others live under `/ar`, `/ru` and `/fr`. `/en/…` redirects to the unprefixed address. Every page lists the other languages with `hreflang`.

| Part | State |
| --- | --- |
| Pages, panels, forms, bag, policies, metadata and sitemap in four languages | done (`src/i18n/`) |
| Language selector: utility bar (all screen sizes) and menu drawer | done; the choice is remembered in a cookie and the open panel, form fields and chat carry over |
| Arabic typography and right-to-left layout | IBM Plex Sans Arabic and Noto Naskh Arabic, no letter-spacing on Arabic, logical CSS properties; the hero copy stays on the lit wall of the photograph |
| Concierge chat | English and Arabic, as before; it opens in Arabic on the Arabic site and in English elsewhere. Russian and French chat wording is not written yet, and the chat database accepts only `en`/`ar` |
| Product text per language | not stored yet: database items show their English text in every language |
| Native-speaker review of the Russian and French wording | recommended |

Also in this release: Instagram links point to @sevnhevn.dubai, buttons have rounded corners with a moving border, the header switches to the menu button where its links no longer fit beside the wordmark, and the mobile Collection filters no longer widen the page.

Tests (10 Oct 2026): `npm run check`; `npm run db:test` 36 of 36; `npm run test:unit` 19 of 19; `tests/e2e/run.sh` 17 of 17; a browser check of home, Collection and chat in all four languages at 1440 px and 390 px (no horizontal overflow, no console errors, no serious axe findings; bag and language selector open). `npm run typecheck` now runs `next typegen` first, so route types exist on a clean checkout.

## Concierge chat and private panel (6 Oct 2026)

Built, tested and deployed. **Dormant until the one-time database setup is run.** Details: [docs/CONCIERGE.md](docs/CONCIERGE.md).

| Part | State |
| --- | --- |
| Customer chat: widget on every page and `/chat`, English and Arabic (RTL) | in production code; hidden until the database setup is run (`/chat` honestly says “not available” with WhatsApp and phone) |
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
- **SEO:** titles and descriptions, Open Graph image, canonical URLs, Organization JSON-LD, and Product JSON-LD for genuine items only. The sitemap is in place. Robots and `noindex` apply until `SITE_INDEXING=true`.
- **Security headers:** CSP, X-Frame-Options, nosniff, Referrer-Policy and HSTS.
- **Supabase catalogue, website-sent enquiry storage, `/api/revalidate`, CI and backups:** added by a parallel session (commits eaebc6e, 0a38adc, 8b82df9). See `docs/SUPABASE.md`, `docs/DEPLOYMENT.md` and `docs/BACKUPS.md`. The Supabase project and Vercel deployment are waiting for the owner to choose a region and plan and to log in.
- **GitHub:** private repository https://github.com/nadiafallah/sevn-hevn.

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
- Approve Arabic store-knowledge entries, and replace the interim policies when final.
- Roadmap (CONCIERGE.md §11): stock sync, request analytics, saved replies, follow-up reminders, and a customer order page.

- After the Supabase and Vercel work lands: re-run `npm run check` and the browser checks against the preview deployment.
- Add real items and review the item panel with genuine data.
- When approved, set `SITE_INDEXING=true` on production, connect the domain with the host's DNS values, and choose one canonical hostname (apex or www) with a redirect from the other.
