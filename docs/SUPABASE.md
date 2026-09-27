# Supabase: catalogue, product photos and website enquiries

Supabase holds three things for SEVN HEVN:

| What | Where | Who can see it |
| --- | --- | --- |
| Products | table `products` | The public sees **published** rows only. Nobody except you (dashboard) and the server can change them. |
| Product photos | Storage bucket `product-images` + table `product_images` | Photos can be opened by their URL. Visitors cannot list, upload, replace or delete files. Image rows are visible only when their product is published. |
| Enquiries sent from the website | table `enquiries` | **Private.** Only you, in the dashboard. The public API can neither read nor write them. |

Supabase is not the payment provider. Online payment stays a separate integration (see `src/lib/payments`). An `orders` table will be added with that integration, under the same deny-by-default rules.

## Updating products, prices and availability

All of this happens in the Supabase dashboard: **Table Editor → products**. No code, no deploy.

1. **Add a piece**: *Insert row*.
   - `ref`: unique reference, letters, numbers and dashes only, e.g. `SH-0001`.
   - `name`, `category` (`bags`, `watches`, `shoes`, `jewellery`, `accessories`, `clothing`, `eyewear`, `lifestyle`).
   - Optional details: `brand`, `model_reference`, `description`, `condition`, `year`, `material`, `colour`, `size`, `dimensions`, `included` (a list such as `{"Box","Dust bag"}`), `authentication` (documented facts only), `delivery`, `returns`.
   - Leave `published` **unticked** while you prepare it. Unpublished pieces never appear on the site.
2. **Add photos**: see the next section.
3. **Choose the state** (`status`):
   - `enquiry_only`: a real piece, shown with "Enquire for details" (or its price, if set). No online checkout.
   - `available`: buyable. Supabase **refuses to save** this state unless `price_aed`, `stock` (at least 1) and `delivery` are all filled in.
   - `reserved` / `sold`: stays visible but cannot be bought.
   - `editorial_preview`: mood imagery only. It must have no brand, price or stock (Supabase enforces this).
4. **Publish**: tick `published` and save.
5. **Change a price**: edit `price_aed` (whole AED, e.g. `85000`). Clear the cell to show "Enquire for details". Zero is not allowed.
6. **Sold a piece**: set `status` to `sold` (and `stock` to `0`). To hide it completely, untick `published` instead of deleting the row, so its history is kept.
7. **Feature on the home page**: tick `featured`. Genuine featured pieces replace the editorial images once at least three are featured.

Never put supplier names, owner details, purchase prices or private notes in `products`. Published rows are public.

**When changes appear:** within seconds once the refresh webhook is configured (see below). Without it, they appear within 5 minutes. Checkout always re-reads price and stock directly, so a customer is never charged a stale price.

## Uploading product photos

1. **Storage → product-images → Upload**. Put each piece's photos in a folder named after its ref, e.g. `SH-0001/front.jpg`, `SH-0001/side.jpg`. JPEG, PNG, WebP or AVIF, up to 10 MB each.
2. **Table Editor → product_images → Insert row**:
   - `product_ref`: `SH-0001`
   - `storage_path`: `SH-0001/front.jpg` (the path inside the bucket, with no leading slash)
   - `alt`: describe what is visible, e.g. "Gold Epsom leather Kelly 25, front view"
   - `width` / `height`: the photo's pixel size. The defaults (1600 × 2000) suit 4:5 portrait photos.
   - `position`: `0` for the main photo, then `1`, `2`, and so on.
3. To replace a photo, upload it under a **new file name** and update `storage_path`. Reusing the same name can keep showing the old image from caches.

## Reading website enquiries

**Table Editor → enquiries**, newest first. Each row has the customer's chosen reply channel (`contact_method`, `contact_value`), the full prepared `message`, the structured `details`, and the `reference` the customer was shown. Set `status` to `replied`, `closed` or `spam` as you work through them.

- Only requests the customer sent with **"Send from the website"** appear here. WhatsApp and email hand-offs are sent by the customer from their own app, so the website cannot know whether they were sent and records nothing.
- There is **no automatic notification** yet. Check this table daily, or add an email notification later (this needs an email provider such as Resend or Postmark; it is not set up).
- Rows contain personal data. Delete ones you no longer need, and don't export them to shared places.
- Abuse limits: 5 enquiries per sender per hour and 200 site-wide per hour. Only a salted hash of the sender's IP is stored.

## Keys and where they live

| Key | Where it is used | Environments |
| --- | --- | --- |
| Project URL (`SUPABASE_URL`) | server | all |
| Publishable key `sb_publishable_…` (`SUPABASE_PUBLISHABLE_KEY`) | server, catalogue reads. Row-level security limits it to published rows. | all |
| Secret key `sb_secret_…` (`SUPABASE_SECRET_KEY`) | server, enquiry inserts only | **Vercel Production only** |
| `CATALOG_REVALIDATE_SECRET` | `/api/revalidate` and the Supabase Vault entry | Production only |

Keys are never sent to the browser and never use a `NEXT_PUBLIC_` prefix. Even if the secret key were added elsewhere by mistake, the site writes enquiries only when `VERCEL_ENV=production`.

## Catalogue refresh webhook (one-time setup, per project)

Migration `*_catalogue_revalidation.sql` adds a trigger that calls the site when `products` or `product_images` change. It stays silent until two Vault entries exist. **Dashboard → Integrations → Vault → Add new secret**:

- `catalog_revalidate_url` = `https://<production-domain>/api/revalidate`
- `catalog_revalidate_secret` = the same value as `CATALOG_REVALIDATE_SECRET` in Vercel (Production)

## Schema changes (migrations)

- Every change is a new file in `supabase/migrations/` (`YYYYMMDDHHMMSS_name.sql`). Never edit a migration that has already been applied.
- `npm run db:test` applies all migrations to an in-process Postgres 17 with stand-ins for Supabase's roles, Storage, Vault and `pg_net`, then checks the access rules: public reads published rows only, cannot write, and cannot read enquiries. CI runs it on every push and pull request.
- Only after the tests pass is a migration applied to the production project. Existing data is never reset or overwritten, and changes are additive (new tables, columns, policies).
- After applying, run Supabase's security advisor (**Dashboard → Advisors**) and check that there are no new warnings.
