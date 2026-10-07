-- Rollback for 20261007120000_panel_products.sql (products in the private panel).
-- Products and photos already saved stay in place; only the panel's ability to change them goes.
begin;
drop function if exists public.admin_delete_product(text);
drop function if exists public.admin_delete_product_image(bigint);
drop function if exists public.admin_set_main_product_image(bigint);
drop function if exists public.admin_add_product_image(text, text, integer, integer, text);
drop function if exists public.admin_save_product(text, jsonb);
drop function if exists private.product_text(jsonb, text, integer);
drop function if exists private.renumber_product_images(text);
drop function if exists private.next_product_ref();
drop policy if exists "Owner can delete product photos" on storage.objects;
drop policy if exists "Owner can upload product photos" on storage.objects;
drop policy if exists "Owner can see product photo files" on storage.objects;
drop policy if exists "Team can read every product image" on public.product_images;
drop policy if exists "Team can read every product" on public.products;
delete from supabase_migrations.schema_migrations where version = '20261007120000';
commit;
