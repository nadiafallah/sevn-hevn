-- Rollback of 20261013120000_shop_four_categories.sql.
-- Purchase requests already stored stay in the panel (their type value remains in the enum;
-- PostgreSQL can't drop an enum value). Versions are removed. Products keep their (normalised) data.

drop function if exists public.shop_submit_purchase(text, jsonb);
drop function if exists public.admin_delete_variant(bigint);
drop function if exists public.admin_save_variant(text, bigint, jsonb);
drop table if exists public.product_variants;
drop function if exists private.variant_image_check();
drop trigger if exists products_shop_scope on public.products;
drop function if exists private.products_shop_scope();

alter table public.requests drop constraint requests_source_check;
alter table public.requests add constraint requests_source_check check (source in ('widget', 'page', 'checkout'));

alter table public.products
  drop column if exists hardware, drop column if exists size_system, drop column if exists case_diameter_mm,
  drop column if exists movement, drop column if exists purity, drop column if exists stones, drop column if exists audience;

drop function if exists private.subcategory_id(text, text);
drop function if exists private.brand_allowed(text, text);
drop function if exists private.canonical_brand(text);

-- admin_save_product: re-run its definition from 20261007120000_panel_products.sql (it then
-- accepts bags, watches, shoes and accessories again).
