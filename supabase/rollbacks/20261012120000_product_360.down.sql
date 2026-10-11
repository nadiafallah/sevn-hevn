-- Rollback for 20261012120000_product_360.sql (360° views of pieces).
-- Export first: this removes every view setting and media row. Files in the product-media bucket
-- are not deleted here; list them before rolling back (admin_view_files) and remove them in Storage.
begin;
drop trigger if exists product_view_media_notify_change on public.product_view_media;
drop trigger if exists product_views_notify_change on public.product_views;
drop function if exists public.admin_view_files(text);
drop function if exists public.admin_save_view(text, jsonb);
drop function if exists public.admin_clear_view_model(text);
drop function if exists public.admin_set_view_model(text, text, integer, text[]);
drop function if exists public.admin_delete_view_media(bigint);
drop function if exists public.admin_reverse_view_frames(text);
drop function if exists public.admin_move_view_media(bigint, integer);
drop function if exists public.admin_add_view_media(text, text, text, text, integer, integer, text);
drop function if exists private.require_piece(text);
drop function if exists private.check_view_complete(text);
drop function if exists private.renumber_view_media(text, text);
drop function if exists private.view_frame_count(text);
drop policy if exists "Owner can delete product media" on storage.objects;
drop policy if exists "Owner can upload product media" on storage.objects;
drop policy if exists "Owner can see product media files" on storage.objects;
drop table if exists public.product_view_media;
drop table if exists public.product_views;
-- The bucket can only be removed once it is empty: delete its files first, then
-- delete from storage.buckets where id = 'product-media';
commit;
