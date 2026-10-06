# SEVN HEVN — website

The website for SEVN HEVN, Dubai (https://www.sevnhevn.ae). It has two pages, **Home** (`/`) and **Collection** (`/collection`). Item detail, bag, sourcing, viewing, contact and policies open as panels.

Built with Next.js 16 (App Router), React 19 and TypeScript. It uses plain CSS and has no UI framework.

## Run locally

Requires Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local   # optional: adjust settings
npm run dev                  # http://localhost:3000
```

Production check:

```bash
npm run check                # typecheck + lint + build
npm run db:test              # migrations and database access rules (in-process Postgres)
npm run test:unit            # concierge conversation logic
tests/e2e/run.sh             # browser end-to-end checks on a local stack (needs postgresql@17 + postgrest)
npm start                    # serves the build on http://localhost:3000
```

## Where things live

| What | File |
|---|---|
| Phone, WhatsApp, email, Instagram, Facebook, company name, reseller statement | `src/config/site.ts` |
| Genuine products | Supabase (see [docs/SUPABASE.md](docs/SUPABASE.md)); offline fallback `src/data/products.ts` |
| Editorial previews (AI mood images, not for sale) | `src/data/editorial.ts` |
| Demo records for testing the bag | `src/data/demo.ts` (only with `DEMO_INVENTORY=true`, never in production) |
| Categories (full taxonomy from the brand PDF) | `src/data/taxonomy.ts` |
| Shipping / returns / privacy / terms text | `src/content/policies.ts` |
| WhatsApp message wording | `src/lib/whatsapp.ts` |
| Styles and brand colours | `src/app/globals.css` (tokens at the top) |
| Logo | `src/components/Wordmark.tsx` |
| Concierge chat (wording, flow, server) | `src/lib/concierge/` (`i18n.ts` wording, `engine.ts` conversation), `src/components/concierge/` |
| Private panel | `src/app/admin/`, `src/lib/admin/` |
| Image sources | [ASSETS.md](ASSETS.md) |

## Changing contact details

Edit `src/config/site.ts`. Every link on the site reads from it. To show Facebook, set `NEXT_PUBLIC_FACEBOOK_URL`. The link stays hidden while this is empty.

## Adding products

Each item has a **status**:

- `enquiry_only`: a real piece. The item panel shows "Enquire for details" or its price, plus WhatsApp and viewing buttons. There is no online checkout.
- `available`: a real piece that can be added to the bag. It needs a price in AED, stock and delivery text. If any of these is missing, the site automatically shows the item as `enquiry_only`.
- `reserved` / `sold`: the item stays visible, cannot be bought, and offers "Request a similar piece".
- `editorial_preview`: inspiration only. It is never purchasable and never appears in product structured data.

Only fill in fields you know are true. The site hides empty fields and never shows AED 0. Never put supplier or owner details in product data, because it is public.

For the Supabase workflow (dashboard entry and photo upload), see [docs/SUPABASE.md](docs/SUPABASE.md). Without Supabase configured, the site reads `src/data/products.ts`, which contains a commented template.

Each item gets a shareable link: `/collection?item=REFERENCE`.

## Preview vs live

| Setting | Effect |
|---|---|
| `SITE_INDEXING=false` (default) | `robots.txt` blocks everything and pages carry `noindex`. Use for previews. |
| `SITE_INDEXING=true` | Indexing on (production deployment only). Turn on only when the public launch is approved. |
| `DEMO_INVENTORY=true` | Shows labelled demo records for testing. Ignored on production. |
| `NEXT_PUBLIC_ANALYTICS_ENABLED` | Analytics events (`src/lib/analytics.ts`) are forwarded only when this is on **and** the visitor has consented. A consent banner must be added before enabling any tracking tool. |

## Enquiries

The sourcing and viewing forms validate the input and then prepare a WhatsApp message (or an email). The customer sends it themselves, so the site never claims that a message was sent, and nothing is recorded.

As an alternative, the customer can choose **"Send from the website"** and give a reply contact. `/api/enquiries` then stores the request in the private Supabase `enquiries` table. A reference is shown only after the database confirms the save. This works on the production deployment only; previews and local development (and production until `SUPABASE_SECRET_KEY` is set) say it isn’t available and point to WhatsApp or email. See [docs/SUPABASE.md](docs/SUPABASE.md).

## Concierge chat and private panel

A virtual-assistant chat (English and Arabic) takes customer requests, with photos, and stores them for the team. It opens from the **Concierge** button on every page and at `/chat`. The team works in a private panel at `/admin`, with owner and staff roles, notes, follow-ups, approved prices, orders and notifications. The chat never states a price, stock level, delivery promise or policy unless it comes from approved data.

Setup, roles, daily use, notification connections, order checks, optional AI, migrations and tests are all in [docs/CONCIERGE.md](docs/CONCIERGE.md).

## Payments

No payment provider is connected. `/api/checkout` re-checks every item against the server catalogue and ignores prices sent by the browser. It then returns a truthful "online payment is not available yet" response, and the bag offers WhatsApp instead. To connect a provider, implement `PaymentProvider` in `src/lib/payments/index.ts`. The requirements are:

- Use a hosted or tokenised checkout, with secrets stored server-side only.
- Mark an order paid only from a verified webhook (`src/app/api/payments/webhook`), never from a redirect.
- Make webhook handling idempotent.
- Reserve stock for one-off pieces.
- Start in test mode.

## Deployment, backups

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/BACKUPS.md](docs/BACKUPS.md).

## Notes on the two-page design

Items have no individual pages. `/collection?item=REF` is server-rendered with the item's title, description, image, canonical link and (for genuine items only) Product structured data, so shared links preview correctly. Search engines may still give query-string URLs less weight than dedicated product pages. If organic product search becomes important, add per-item pages later.
