# Luxury editorial redesign — working notes

Status (28 Sep 2026): **local preview only, awaiting the owner's approval.** Nothing in this redesign has been committed, pushed or deployed.

- Branch: `redesign/luxury-editorial` (local only). It is based on `origin/main` at `9505e74`.
- Preview: `npm run build && npx next start -p 3200`, then open http://localhost:3200.
- Screenshots: `reference/redesign-preview/` (git-ignored).

## Context

A parallel session pushed its own redesign (`9505e74`, "Redesign closer to the homepage concept") straight to `main` at 23:40 on 27 Sep. Production (https://sevn-hevn.vercel.app) serves that version. This branch builds on top of it. It keeps that commit's functional fixes:

- the hydration warning fix on `<html>`
- canonical and Open Graph URLs that use the production hostname
- editorial taglines
- the menu drawer with the logo
- the documentation updates

## What changed

- **Type:** Cormorant Garamond is the display serif, with italic accents. Jost stays for text, labels and buttons. Both are self-hosted through `next/font`.
- **Header:**
  - the real wordmark, larger (300 px on desktop, 172 px on phones)
  - a WhatsApp icon on desktop
  - a category row in the brand PDF order, hidden on Collection, which has its own tabs
- **Hero:** a serif headline over the full-bleed image, with lines that rise from a mask. The AI-image label is kept.
- **Introduction:** a two-column editorial layout with Roman-numeral pillars.
- **Category discovery:** four staggered tiles (Bags, Watches, Shoes, and "Jewellery & beyond" as a request tile). They use detail crops of the supplied images. Every image carries an "AI editorial image" label.
- **The edit:** a swipeable rail of all six editorial previews. It uses native scrolling with snap, and its arrow buttons only move it by one card. Every card is still marked "Editorial preview".
- **Private sourcing band:** a typographic list of houses clients ask about, with the not-affiliated statement, three steps and the existing form.
- **Private viewing:** direct "Chat on WhatsApp" and "Call" buttons, the contact list and the existing form.
- **Footer:** Espresso background, with a WhatsApp button and the full-width wordmark.
- **Collection, item panel and bag:** serif titles and refined spacing. All logic is unchanged.
- **Motion:** CSS only. Nothing hijacks scrolling or plays sound. With reduced motion, everything is shown at once. Without JavaScript, all content stays visible.

## Tools and resources

| Resource | Used? | Why |
|---|---|---|
| MotionSites.ai | Design principles only | The fashion examples (e.g. "Orla Fashion") are premium ("Go Unlimited"), and the site publishes no licence terms (`/terms` returns 404). Nothing was copied: no prompts, code or assets. |
| Cormorant Garamond (Google Fonts) | Yes | SIL Open Font License 1.1: free, commercial web use, no attribution required. |
| Supplied brand/homepage PDF images | Yes | Already in the project. All are AI-generated mood imagery and labelled as such. |
| Playwright (Apache-2.0, already installed) | Yes, for testing | Screenshots and browser checks. |
| Canva, Google Flow, other AI image/video generators | No | Not needed, because the supplied imagery covers the design. Free quota and commercial terms were not verified. Generated luxury-goods imagery would add trademark and authenticity risk. |

## Checks run on this branch

- `npm run check` (typecheck, lint, production build): passed.
- Browser checks against a local production build (29 automated, plus 2 re-verified by hand), all passing:
  - logo size on desktop and phone
  - WhatsApp links
  - AI-image labels
  - rail buttons and keyboard
  - category navigation
  - item panel and shareable URL
  - add to bag, subtotal, persistence and server-side checkout re-check (using local demo records)
  - item WhatsApp message with the reference
  - viewing panel
  - sourcing form validation and WhatsApp hand-off
  - mobile menu
  - no horizontal overflow at 320, 360 and 390 px
  - reduced motion
  - no-JavaScript rendering
  - no console errors
- Not run:
  - HawkScan (the CLI and API key are not installed)
  - real-device iOS/Android testing
  - a screen-reader pass

## Open points

- Real photography of genuine pieces is still the biggest remaining improvement. The same six AI images appear in several places.
- Wording: "Private sourcing" is used throughout this branch. The live version says "Personal shopper", as in the PDF. Either can be used.
