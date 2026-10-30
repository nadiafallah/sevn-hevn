-- Rollback for 20261030120000_compliance_site.sql.
-- DELETES the country of origin and Arabic composition of every piece. Export the products table
-- first and get the owner's written approval. The fixed compliance_decide() is kept (harmless).
-- After this, the website falls back to its built-in defaults for the returns notice and checkout.

drop trigger if exists products_condition_disclosure on public.products;
drop function if exists private.products_condition_disclosure();
drop function if exists public.admin_save_product_compliance(text, jsonb);
alter table public.products drop column if exists composition_ar, drop column if exists country_of_origin;
drop function if exists public.compliance_site_settings();
