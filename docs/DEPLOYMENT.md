# Deployment: GitHub → Vercel, with Supabase

## Pieces

| Piece | Where |
| --- | --- |
| Code | Private GitHub repo `nadiafallah/sevn-hevn`, default branch `main` |
| Checks | GitHub Actions `CI` on every push and pull request: migration tests, typecheck, lint, build |
| Hosting | Vercel project `sevn-hevn` (team "nadia", Hobby plan, pre-launch), linked to the repo through the Vercel GitHub app. Production branch `main`; functions in `bom1` (Mumbai) |
| Data | Supabase project `sevn-hevn` (ref `amjgwnuroshdqrruasmn`, Mumbai `ap-south-1`, org "nadia web vs", Free plan) |

## Branches and environments

| Git | Vercel environment | Catalogue | Website enquiries |
| --- | --- | --- | --- |
| `main` | **Production**, the public domain | live, published rows | **stored** in Supabase |
| any other branch / pull request | **Preview**, unique URL per push | live, published rows (public data, read-only) | **switched off**: the form says so and points to WhatsApp or email |
| your computer (`npm run dev`) | Development | from `.env.local`, or the static fallback | switched off |

Development and preview deployments can never write into, or read, customer data:

- they are not given `SUPABASE_SECRET_KEY`;
- the enquiry API also refuses to write unless `VERCEL_ENV=production`;
- the publishable key they use can only read published products, because row-level security enforces it.

Work on a branch, push, check the preview URL Vercel posts on the pull request, then merge to `main` to release.

**Only a push or merge to `main` on GitHub publishes.** Saving files on a computer, or committing without pushing, changes nothing on the live site. Each push to `main` starts a Production build automatically (about a minute); if the build fails, the previous version stays live.

**Who can open what:** Vercel Authentication (Standard Protection) is on, so preview URLs and per-deployment URLs (`sevn-hevn-<hash>-nadia-ea59.vercel.app`) open only for members of the Vercel team. The production domain **`https://www.sevnhevn.ae`** (and the fallback `https://sevn-hevn.vercel.app`) is **public**, but kept out of search engines: `SITE_INDEXING=false` makes robots.txt disallow everything and adds noindex.

## Status (5 Oct 2026)

| Item | State |
| --- | --- |
| GitHub repo, CI | connected, CI passing |
| Vercel project, GitHub integration, production from `main`, previews from other branches | connected |
| Supabase schema, RLS, Storage bucket | applied to production and verified over the public API |
| Catalogue refresh webhook (Vault → `https://www.sevnhevn.ae/api/revalidate`) | connected and verified |
| `SUPABASE_SECRET_KEY` in Vercel Production | **not set yet**. Until it is, the website's "Send from the website" option reports it is unavailable. You add it yourself (see below). |
| Main domain **`www.sevnhevn.ae`** | connected (5 Oct 2026). `sevnhevn.ae` redirects to it (308), HTTPS by Vercel (Let's Encrypt). DNS and email are at Tasjeel.ae / Host Arabia cPanel: apex `A 216.198.79.1` + `A 64.29.17.1`, `www CNAME f7cd6713914e89dd.vercel-dns-017.com`. Email stays on cPanel: `MX 0 mail.sevnhevn.ae`, `mail A 192.250.230.80`. Official address: `info@sevnhevn.ae`. |
| `sevnhevnmaison.com` (GoDaddy) | added to Vercel and set to redirect to `www.sevnhevn.ae`, but its DNS still points at GoDaddy parking. It only works once the GoDaddy records below are changed. |
| Backup workflow | prepared, waiting for its GitHub secrets ([BACKUPS.md](BACKUPS.md)) |
| Vercel Pro | not purchased. Upgrade before public launch (commercial use). |

**Pointing the domain at Vercel** (GoDaddy → My Products → sevnhevnmaison.com → DNS). These values come from Vercel's domain configuration for this project:

| Type | Name | Value | Action |
| --- | --- | --- | --- |
| A | `@` | `216.198.79.1` | add |
| A | `@` | `64.29.17.1` | add |
| A | `@` | `3.33.130.190`, `15.197.148.33` (GoDaddy parking) | delete |
| CNAME | `www` | `f7cd6713914e89dd.vercel-dns-017.com` | replace the current `www → @` |

Also switch off any GoDaddy "Forwarding" for the domain. Leave MX, TXT (SPF, DKIM, DMARC, verification) and any other email records untouched; on 27 Sep 2026 the domain had none. Vercel issues the HTTPS certificate on its own once the records resolve.

**Adding the Supabase secret key** (keeps it out of chat, files and git):

1. Supabase → project `sevn-hevn` → **Project Settings → API Keys → Secret keys** → create or reveal a secret key (`sb_secret_…`) and copy it.
2. Vercel → project `sevn-hevn` → **Settings → Environment Variables → Add**: name `SUPABASE_SECRET_KEY`, environment **Production only**, tick **Sensitive**, paste, save.
3. Vercel → **Deployments** → latest production deployment → **Redeploy**.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Production | Preview | Development | Notes |
| --- | --- | --- | --- | --- |
| `SUPABASE_URL` | ✓ | ✓ | ✓ | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | ✓ | ✓ | ✓ | `sb_publishable_…`, safe to expose but kept server-side |
| `SUPABASE_SECRET_KEY` | ✓ | – | – | `sb_secret_…`. Mark as **Sensitive**. Production only. |
| `CATALOG_REVALIDATE_SECRET` | ✓ | – | – | Random, e.g. `openssl rand -hex 32`. Mark as **Sensitive**. Same value as the Supabase Vault entry. |
| `NEXT_PUBLIC_SITE_URL` | ✓ | – | – | `https://www.sevnhevn.ae` |
| `SITE_INDEXING` | `false` until the launch is approved | – | – | |
| `DEMO_INVENTORY` | – | optional `true` | optional | always ignored on production |

Enter secret values yourself in the Vercel dashboard (or `vercel env add`, which prompts without echoing). Never paste them into chat, issues or commits. `.env*` files are git-ignored, except `.env.example`.

## How catalogue updates reach the site

1. Pages render from a cached catalogue (Next.js data cache, tag `catalog`).
2. Editing `products` or `product_images` in Supabase fires a trigger. Via `pg_net`, it POSTs to `/api/revalidate` with the shared secret, and the cache expires at once. The next visitor gets fresh data.
3. Safety net: the cache also refreshes itself every 5 minutes, so changes appear even if the webhook is not configured or a call fails.
4. Checkout never uses the cache. It re-reads price and stock on every request.
5. If Supabase is unreachable, the last good catalogue keeps being served rather than an empty shop.

## Region

Supabase has no Middle East region. Mumbai (`ap-south-1`) is closest to Dubai. Vercel functions should run in the same region (`bom1`), so cache refreshes and enquiry writes stay short. `vercel.json` pins the function region.

## Costs to know about

- **Vercel Hobby** (free) is limited by Vercel's terms to personal, non-commercial use. A business website should run on **Vercel Pro**: US$20 per member per month, which includes commercial use, more bandwidth and function time. Nothing is upgraded without your decision.
- **Supabase Free**: 500 MB database and 1 GB file storage. Projects **pause after 7 days without activity**, and there are no downloadable daily backups (see [BACKUPS.md](BACKUPS.md)). **Supabase Pro** is US$25 per month per organisation: no pausing, daily backups kept for 7 days, and more storage. Optional add-ons such as point-in-time recovery cost extra.
- **GitHub Free** private repos include 2,000 Actions minutes and 500 MB of artifact storage per month. CI takes about 2–3 minutes per push, and backups are small.
