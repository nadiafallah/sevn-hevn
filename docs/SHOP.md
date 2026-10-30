# The shop

How the store works: what it lists, its pages, the bag and checkout, and how the team runs it from the private panel. Owner decisions, October 2026.

## What the shop lists

- **Four categories, in this order:** Bags | Shoes | Watches | Jewellery (`src/data/taxonomy.ts`). Jewellery replaces Accessories and is for fine jewellery only. Clothing, fragrance, eyewear, home, beauty and anything else are never shown, searched or suggested.
- **Types:** a few per category. Bags: handbags, shoulder & crossbody, clutches, pouches & cases. Shoes: sandals, sneakers, loafers & mules, heels. Watches: women's, men's, unisex. Jewellery: rings, bracelets, necklaces, earrings. A type, a house or a filter appears only when at least one listed piece has it, so nothing empty is ever offered.
- **Houses (owner decision, 28 Oct 2026): only the houses SEVN HEVN actually holds.** Hermès and Chanel in every category; Miu Miu and Loro Piana in **Bags and Shoes only** (`src/data/brands.ts`). Louis Vuitton, Gucci, Cartier, Van Cleef & Arpels and Bvlgari were listed until then and are no longer offered anywhere; add a house back (code and database) when a piece of it is held. Spellings are unified ("Hermes" → "Hermès", "miu-miu" → "Miu Miu").

The rule is enforced in several places, so no route can get around it:

| Where | How |
| --- | --- |
| Database | A trigger refuses to publish a piece outside the four categories or the permitted houses (`out_of_scope`). The panel's save function refuses such a house (`brand_not_allowed`). Rows from before these rules are only hidden, never deleted. Migrations `20261013120000_shop_four_categories.sql` and `20261028120000_shop_houses.sql` (the houses as of 28 Oct 2026). |
| Website catalogue | `lib/catalog.ts` drops any piece outside the shop before it reaches a page, the menu, search or the sitemap. |
| Panel | The house and type fields are pick-lists of the permitted values. |
| Sourcing form and chat | The form's house field offers only the permitted houses for the chosen category, and `/api/enquiries` refuses others. The chat offers the same houses as quick choices. |
| Addresses | `/bags/gucci` or `/watches/loro-piana` do not exist (404). |

## Pages and addresses

| Page | Address |
| --- | --- |
| Home | `/` (the retired `/ar`, `/ru` and `/fr` redirect to the English page) |
| Category | `/bags`, `/shoes`, `/watches`, `/jewellery` |
| Category and house | `/bags/hermes`, `/jewellery/cartier`, … |
| Every category, search results | `/collection`, `/collection?q=kelly`, `/collection?brand=hermes` |
| A piece | `/product/SH-0001` (a chosen version adds `?sku=…`) |
| Checkout, confirmation | `/checkout`, `/checkout/received?ref=REQ-…` |

Filters live in the query string (`?type=clutches&colour=noir&size=40.5&price_min=…&sort=price-asc`), so a link can be shared, and Back undoes the last change (changes made inside the filter panel count as one step). Older addresses redirect permanently (308): `/collection?category=bags` → `/bags`, `/collection?category=bags&designer=Hermès` → `/bags/hermes`, `/collection?category=accessories` → `/jewellery`, `/collection?item=REF` → `/product/REF`.

Search engines: a category or house page with no genuine piece carries `noindex` and stays out of the sitemap until something is published. Drafts and demo records are never indexed or put in structured data. Product pages carry Product + BreadcrumbList data, with an Offer only where a price is actually listed.

## Header and menu

On wide screens each category opens a panel showing its houses, types, "Shop all" and one or two newest real pieces, each with its own link. It opens on click, on the keyboard (Enter, Space or ↓; Escape closes and returns focus) and, for a mouse, on hover. A category with nothing listed offers sourcing requests for its houses instead of empty links. On phones and tablets the four categories are plain links under the header, and the menu drawer holds the same structure in fold-out sections.

## Listings

The grid has four columns on desktop, three on tablets and two on phones. Every photo sits in the same 3:4 frame. A photo of another shape is shown whole, so a piece is never cropped, and a second photo fades in on hover where one exists. Each card shows the house, the model, one line of the details that matter for the category (size and colour, case size and movement, metal), the price or "Price on request", and the real availability.

Filters are offered only from real data: availability, price (min / max; pieces without a price are left out while it is on), colour, size, case size, metal. Sorting is by newest or by price, and pieces without a price always come last, never as AED 0. Search matches house (with or without accents), model, product code and version code.

## Product page

The page has a photo gallery with full-screen zoom, the house, model, code, price and real availability. It also shows the options the piece really has (colour, size, hardware). The photo, price, code and WhatsApp message follow the chosen version. Details are shown per category:

- **Bags:** dimensions, colour, material, hardware.
- **Shoes:** size and size system, colour, material.
- **Watches:** reference, case diameter, material, movement, condition, year, for whom.
- **Jewellery:** metal, fineness / carat, size, confirmed stone details.

Condition, what's included, documentation, delivery and returns show only what has been entered for the piece. Without that, the page shows the honest default ("confirmed with you before payment"). There are no claims of authorisation or guarantees.

The buttons follow the piece's real state:

| State | Buttons |
| --- | --- |
| Available to buy | Add to bag (after a version is chosen, if it has versions) |
| By enquiry | Enquire on WhatsApp, Request availability |
| Reserved or sold | Request a similar piece |

Related pieces come from the same category only, same house first.

## Bag and checkout

The bag keeps each line's version and survives a reload (local storage in the visitor's browser). One-off pieces are limited to quantity 1. The checkout steps are: bag (re-checked on the server: price, stock, version, availability) → details → delivery or collection in Dubai → payment.

**Online payment is not connected.** The last step therefore stores a **purchase request** in the panel through `shop_submit_purchase()`. Only the website's server key can call it. It is rate-limited, and the same request sent twice (double click or retry) is stored once. The page says plainly that this is not a confirmed order and that nothing has been charged. Delivery cost and VAT appear as "confirmed by our team before payment", because no rates or VAT registration have been supplied. If requests can't be stored (preview deployments, local development, or a database without the shop migration), the checkout hands over to WhatsApp with the bag in the message instead. It never shows a fake confirmation.

Every WhatsApp message carries the piece's name, link, code, chosen options and listed price. Opening WhatsApp sends nothing until the visitor presses Send.

To take card payments later, see README → Payments: you need a provider with a merchant account, its keys in Vercel, and a verified webhook before anything can be shown as paid.

## Running it from the panel

- **Products → Add a piece:** name, house and category are required. Add photos, then the price, stock and delivery details when they are confirmed, then press "Publish on the website". The website updates within a minute.
- **Versions:** on a piece's page, add one per colour, size or hardware you can actually supply. Each version has its own code and, where it differs, its own price, stock and photo.
- **Requests:** purchase requests appear here as "Purchase request (website checkout)", with the verified lines, subtotal and delivery choice, marked "Not paid". Confirm availability and the total with the customer, then create an order from the request. Staff and owner rights are unchanged.

## Adding a batch of pieces at once

`scripts/stock/import.mjs` puts a prepared batch on the website: it uploads each piece's photos to the `product-images` bucket and writes the products, photos and versions, the same rows the panel writes. Re-running it replaces those pieces' photos and versions. It needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.local` (never committed); its changes are not in the panel's activity log.

```
node --env-file=.env.local scripts/stock/import.mjs scripts/stock/2026-10-28.json <photos folder>
```

The first batch (`scripts/stock/2026-10-28.json`, 28 Oct 2026) is 15 pieces from the owner's inventory and photos:

- Photos: the owner's own, given one studio treatment (`scripts/stock/studio.py`; Python with `rembg[cpu] pillow numpy scipy`, the isnet-general-use model on the CPU provider — the CoreML provider stalls on this Mac): the piece cut out of its photo, colour and exposure balanced against the white table it was shot on, placed on one warm studio background (#F3EFE9) with a soft shadow, 3:4, 1800 × 2400. The piece itself is never redrawn. Close-ups and pieces photographed in their box (Kelly Dépêches, Farandole) keep their own background, colour-balanced only.
- Prices: the prices in the owner's Instagram posts; where there was none, the owner's estimate (inventory "Dubai asking" price), and for Miu Miu and Oran an estimate from UAE retail prices, to be confirmed by the owner.
- Five pieces held but not photographed yet (Constance Élan, Birkin 25, Evelyne 16, Chanel mini flap, Chaîne d'Ancre pendant) are listed enquiry-only with a branded "photographs coming soon" card that shows no product. The card is made by `scripts/stock/placeholder.py` with the site's fonts (Jost, Cormorant Garamond). Replace the card with real photos in the panel when they exist. Photos of other sellers or of the brands are never used.

## Private design preview (drafts)

`node scripts/drafts/build.mjs` builds draft pieces from the owner's selection of the shop's own Instagram posts into git-ignored files, resizing the photos only. Run the site with `DRAFT_PREVIEW=true` to see them, labelled "Draft · preview only". Drafts can't be bought, are never indexed and are ignored on production.

## Going live (database)

The production database needs the shop migration, plus the two earlier updates it depends on. Use the SQL Editor (see `docs/SUPABASE.md`): one file containing `20261007120000_panel_products`, `20261011120000_concierge_languages` and `20261013120000_shop_four_categories`, run in one transaction. The code keeps working before the migration runs: it reads the older columns, and the checkout falls back to WhatsApp.

## A fix included here

Before this change the language segment had `dynamicParams = false`. With that setting, every pre-rendered page (home, chat, checkout, in all four languages) answered 404 after the catalogue cache was refreshed: by a product change in Supabase or a save in the panel, until the next deployment. It is removed. Unknown languages still get a 404 from `notFound()`. A browser test covers it.

## Tests

- `npm run test:unit`: brands, types, prices, buying rules, filters, sorting, search, WhatsApp messages.
- `npm run db:test`: houses and scope in the database, hiding without deleting, versions, purchase requests.
- `tests/e2e/shop.e2e.mjs` (via `tests/e2e/run.sh`): menu by click, keyboard and hover; house pages; combined filters with shareable addresses and Back; search; versions; bag after reload; checkout stored, retried and refused; WhatsApp fallback; phone layout; redirects; pages after a catalogue refresh.
