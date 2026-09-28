# Backups

Code, database rows and uploaded images are backed up separately. None of them covers the others.

## 1. Code: GitHub

- **What:** everything in the repository, including the database schema (`supabase/migrations/`) and the editorial images in `public/`.
- **How:** every commit pushed to the private repo `nadiafallah/sevn-hevn`. Your local clone is a second full copy with complete history.
- **Not included (on purpose):** `.env*` secrets, the `reference/` brand and company documents, `node_modules`, and build output. Keep the private reference documents in your own storage (for example Google Drive). They exist only on this computer.

## 2. Database rows: products, image records, enquiries

| Layer | Status | What it keeps |
| --- | --- | --- |
| Supabase platform backups | **Free plan: none you can download or restore yourself.** Pro (US$25/month): daily, kept 7 days, one-click restore. | whole database |
| GitHub Action `Backup` (`.github/workflows/backup.yml`) | **Prepared, inactive** until its secrets are set | every night: `public` data (products, product_images, enquiries) and Storage metadata, encrypted with your passphrase, kept 30 days as a private workflow artifact |
| Schema | in git (`supabase/migrations/`) | tables, constraints, RLS policies, triggers |

**To activate the nightly backup** (GitHub → repo → Settings → Secrets and variables → Actions):

1. Secret `SUPABASE_DB_URL`: Supabase → **Connect** → **Session pooler** connection string, with your database password filled in. The direct connection doesn't work from GitHub, because it is IPv6-only.
2. Secret `BACKUP_PASSPHRASE`: a long random passphrase. **Also save it in your password manager.** Without it the backups cannot be opened.
3. Variable (not secret) `SUPABASE_URL`: `https://<project-ref>.supabase.co`
4. Actions → Backup → **Run workflow** once, and check that an artifact appears.

The backup contains customer enquiries (personal data). It is encrypted before upload, and GitHub deletes each copy after 30 days.

**The website code repository is public**, and anyone can download the artifacts and logs of a public repository. So the workflow refuses to run there. To activate backups, create a separate **private** repository (for example `nadiafallah/sevn-hevn-backups`), copy `.github/workflows/backup.yml` into it, and add the secrets and variable below to that private repository, not to the public one.

**Restore** into a new or empty project:

```sh
gpg -d sevn-hevn-backup-YYYYMMDD.tar.gz.gpg | tar xz          # asks for the passphrase
# 1. apply supabase/migrations/* in order (creates tables, policies, bucket)
# 2. load rows:
pg_restore --data-only --no-owner -d "$SUPABASE_DB_URL" backup/public-data.dump
# 3. re-upload backup/product-images/* to the product-images bucket (same paths)
```

Never restore over a live database that has newer rows. Restore into a fresh project, check it, then switch the site's environment variables over.

## 3. Uploaded images: Supabase Storage

Supabase's database backups (on any plan) **do not include the files** in Storage, only their metadata.

- **Primary copy:** keep the original, full-resolution photos of every piece in your own storage (for example a Google Drive folder per ref: `SH-0001/…`). Upload copies to Supabase.
- **Automatic copy:** the `Backup` workflow downloads every file in `product-images` on Sundays and on every manual run, inside the same encrypted archive.
- Editorial and brand images in `public/` are in git (section 1).

## What is not backed up

- Vercel settings and environment variables: re-enter them from [DEPLOYMENT.md](DEPLOYMENT.md). Keep the secret values in your password manager.
- Customers' bags: these live only in each visitor's browser.
- WhatsApp and email conversations: those are on your phone or email account, with their own backup settings.
