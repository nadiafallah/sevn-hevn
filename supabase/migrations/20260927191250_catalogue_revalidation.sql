-- Tells the website to refresh its cached catalogue whenever products or images change.
-- The target URL and shared secret are read from Supabase Vault at run time, so no secret is
-- stored in this file. Until both Vault entries exist the trigger does nothing, and the site
-- still refreshes on its own every few minutes.
--
-- Vault entries (created once per project, outside migrations):
--   catalog_revalidate_url     e.g. https://sevnhevnmaison.com/api/revalidate
--   catalog_revalidate_secret  same value as CATALOG_REVALIDATE_SECRET in Vercel (Production)

create extension if not exists pg_net with schema extensions;

create function public.notify_catalog_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text;
  secret text;
begin
  select decrypted_secret into target from vault.decrypted_secrets where name = 'catalog_revalidate_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'catalog_revalidate_secret';
  if target is null or secret is null then
    return null;
  end if;
  perform net.http_post(
    url := target,
    headers := jsonb_build_object('content-type', 'application/json', 'x-revalidate-secret', secret),
    body := jsonb_build_object('table', tg_table_name, 'op', tg_op),
    timeout_milliseconds := 5000
  );
  return null;
end;
$$;

revoke execute on function public.notify_catalog_change() from public, anon, authenticated;

create trigger products_notify_change
  after insert or update or delete on public.products
  for each statement execute function public.notify_catalog_change();

create trigger product_images_notify_change
  after insert or update or delete on public.product_images
  for each statement execute function public.notify_catalog_change();
