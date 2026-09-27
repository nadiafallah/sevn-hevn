# Deployment: GitHub → Vercel, with Supabase

## Pieces

| Piece | Where |
| --- | --- |
| Code | Private GitHub repo `nadiafallah/sevn-hevn`, default branch `main` |
| Checks | GitHub Actions `CI` on every push and pull request: migration tests, typecheck, lint, build |
| Hosting | Vercel project linked to the repo through the Vercel GitHub app |
| Data | Supabase project for SEVN HEVN (catalogue, product photos, website enquiries) |

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

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Production | Preview | Development | Notes |
| --- | --- | --- | --- | --- |
| `SUPABASE_URL` | ✓ | ✓ | ✓ | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | ✓ | ✓ | ✓ | `sb_publishable_…`, safe to expose but kept server-side |
| `SUPABASE_SECRET_KEY` | ✓ | – | – | `sb_secret_…`. Mark as **Sensitive**. Production only. |
| `CATALOG_REVALIDATE_SECRET` | ✓ | – | – | Random, e.g. `openssl rand -hex 32`. Mark as **Sensitive**. Same value as the Supabase Vault entry. |
| `NEXT_PUBLIC_SITE_URL` | ✓ | – | – | `https://sevnhevnmaison.com` once the domain is connected |
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
