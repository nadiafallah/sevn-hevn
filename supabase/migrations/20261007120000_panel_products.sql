-- SEVN HEVN: products in the private panel.
--
-- * The owner adds and edits pieces and their photos at /admin/products. Every change goes through
--   an admin_* function below that checks the role and writes the activity log in the same
--   transaction, like the rest of the panel.
-- * The whole team can see every piece, drafts included, so staff can answer customers. Only the
--   owner can change anything.
-- * The public still sees published pieces only (policies from the catalogue migration).
-- * Only the four active categories (bags, watches, shoes, accessories) can be chosen here.
-- * A piece can be published only with at least one photo.
--
-- Rollback: supabase/rollbacks/20261007120000_panel_products.down.sql

-- ── Team reads (drafts included) ──────────────────────────────────────────────────────

create policy "Team can read every product" on public.products for select to authenticated using (private.is_staff());
create policy "Team can read every product image" on public.product_images for select to authenticated using (private.is_staff());

-- ── Photo files: the owner uploads and removes them through the panel ─────────────────
-- The bucket stays public-read by URL (catalogue migration); visitors still cannot list, upload,
-- replace or delete files.

create policy "Owner can see product photo files" on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and private.is_owner());
create policy "Owner can upload product photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and private.is_owner());
create policy "Owner can delete product photos" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and private.is_owner());

-- ── Helpers ───────────────────────────────────────────────────────────────────────────

-- Next free reference in the SH-0001 series.
create function private.next_product_ref() returns text
language sql volatile
set search_path = ''
as $$
  select 'SH-' || lpad((coalesce(max(substring(ref from '^SH-([0-9]{1,6})$')::integer), 0) + 1)::text, 4, '0')
  from public.products
$$;

-- Keeps photo positions 0, 1, 2, … in their current order.
create function private.renumber_product_images(p_ref text) returns void
language sql volatile
set search_path = ''
as $$
  update public.product_images i set position = o.rn
  from (select id, (row_number() over (order by position, id) - 1)::smallint as rn
        from public.product_images where product_ref = p_ref) o
  where i.id = o.id and i.position <> o.rn
$$;

create function private.product_text(p jsonb, k text, max integer) returns text
language plpgsql immutable
set search_path = ''
as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is not null and length(v) > max then raise exception 'invalid_request' using errcode = '22023'; end if;
  return v;
end;
$$;

-- ── Save (create or update) ───────────────────────────────────────────────────────────

-- p_ref null creates a new piece (unpublished unless asked) and returns its reference.
-- Only the keys present in p_fields are changed; an empty string clears an optional field.
create function public.admin_save_product(p_ref text, p_fields jsonb) returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  old public.products;
  new public.products;
  d record;
  cname text;
  photos integer;
begin
  if jsonb_typeof(f) <> 'object' or exists (
    select 1 from jsonb_object_keys(f) k where k not in (
      'name', 'category', 'subcategory', 'brand', 'model_reference', 'description', 'price_aed', 'stock', 'condition',
      'condition_notes', 'year', 'material', 'colour', 'size', 'dimensions', 'included', 'authentication', 'delivery',
      'returns', 'status', 'published', 'featured')
  ) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if f ? 'category' and coalesce(f ->> 'category', '') <> all (array['bags', 'watches', 'shoes', 'accessories']) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  -- Editorial previews are mood images in the website code, never inventory.
  if f ? 'status' and coalesce(f ->> 'status', '') <> all (array['enquiry_only', 'available', 'reserved', 'sold']) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if f ? 'included' and jsonb_typeof(f -> 'included') <> 'array' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if f ? 'name' and private.product_text(f, 'name', 160) is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  begin
    if p_ref is null then
      if not (f ? 'name' and f ? 'category') then raise exception 'invalid_request' using errcode = '22023'; end if;
      if coalesce((f ->> 'published')::boolean, false) then raise exception 'needs_photo' using errcode = '22023'; end if;
      insert into public.products (
        ref, published, status, name, category, subcategory, brand, model_reference, description, price_aed, stock,
        condition, condition_notes, year, material, colour, size, dimensions, included, authentication, delivery, returns, featured
      ) values (
        private.next_product_ref(), false, coalesce((f ->> 'status')::public.item_status, 'enquiry_only'),
        private.product_text(f, 'name', 160), f ->> 'category', private.product_text(f, 'subcategory', 80),
        private.product_text(f, 'brand', 80), private.product_text(f, 'model_reference', 80), private.product_text(f, 'description', 2000),
        (private.product_text(f, 'price_aed', 12))::integer, (private.product_text(f, 'stock', 6))::integer,
        (private.product_text(f, 'condition', 20))::public.item_condition, private.product_text(f, 'condition_notes', 500),
        private.product_text(f, 'year', 20), private.product_text(f, 'material', 120), private.product_text(f, 'colour', 80),
        private.product_text(f, 'size', 80), private.product_text(f, 'dimensions', 120),
        coalesce(array(select btrim(x) from jsonb_array_elements_text(f -> 'included') x where btrim(x) <> '' limit 12), '{}'),
        private.product_text(f, 'authentication', 1000), private.product_text(f, 'delivery', 1000), private.product_text(f, 'returns', 1000),
        coalesce((f ->> 'featured')::boolean, false)
      ) returning * into new;
      perform private.audit(me, 'product.created', 'product', new.ref, null, to_jsonb(new) - 'created_at' - 'updated_at');
      return new.ref;
    end if;

    select * into old from public.products where ref = p_ref for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if old.status = 'editorial_preview' then raise exception 'invalid_request' using errcode = '22023'; end if;

    update public.products set
      name = case when f ? 'name' then private.product_text(f, 'name', 160) else name end,
      category = coalesce(f ->> 'category', category),
      status = coalesce((f ->> 'status')::public.item_status, status),
      published = coalesce((f ->> 'published')::boolean, published),
      featured = coalesce((f ->> 'featured')::boolean, featured),
      subcategory = case when f ? 'subcategory' then private.product_text(f, 'subcategory', 80) else subcategory end,
      brand = case when f ? 'brand' then private.product_text(f, 'brand', 80) else brand end,
      model_reference = case when f ? 'model_reference' then private.product_text(f, 'model_reference', 80) else model_reference end,
      description = case when f ? 'description' then private.product_text(f, 'description', 2000) else description end,
      price_aed = case when f ? 'price_aed' then (private.product_text(f, 'price_aed', 12))::integer else price_aed end,
      stock = case when f ? 'stock' then (private.product_text(f, 'stock', 6))::integer else stock end,
      condition = case when f ? 'condition' then (private.product_text(f, 'condition', 20))::public.item_condition else condition end,
      condition_notes = case when f ? 'condition_notes' then private.product_text(f, 'condition_notes', 500) else condition_notes end,
      year = case when f ? 'year' then private.product_text(f, 'year', 20) else year end,
      material = case when f ? 'material' then private.product_text(f, 'material', 120) else material end,
      colour = case when f ? 'colour' then private.product_text(f, 'colour', 80) else colour end,
      size = case when f ? 'size' then private.product_text(f, 'size', 80) else size end,
      dimensions = case when f ? 'dimensions' then private.product_text(f, 'dimensions', 120) else dimensions end,
      included = case when f ? 'included'
        then coalesce(array(select btrim(x) from jsonb_array_elements_text(f -> 'included') x where btrim(x) <> '' limit 12), '{}')
        else included end,
      authentication = case when f ? 'authentication' then private.product_text(f, 'authentication', 1000) else authentication end,
      delivery = case when f ? 'delivery' then private.product_text(f, 'delivery', 1000) else delivery end,
      returns = case when f ? 'returns' then private.product_text(f, 'returns', 1000) else returns end
    where ref = p_ref returning * into new;
  exception
    when check_violation then
      get stacked diagnostics cname = constraint_name;
      if cname = 'available_needs_price_stock_delivery' then
        raise exception 'available_incomplete' using errcode = '22023';
      end if;
      raise exception 'invalid_request' using errcode = '22023';
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_request' using errcode = '22023';
  end;

  if new.published then
    select count(*) into photos from public.product_images where product_ref = new.ref;
    if photos = 0 then raise exception 'needs_photo' using errcode = '22023'; end if;
  end if;

  select * into d from private.diff(to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
  if d.d_after is not null and d.d_after <> '{}'::jsonb then
    perform private.audit(me, 'product.updated', 'product', p_ref, d.d_before, d.d_after);
  end if;
  return p_ref;
end;
$$;

-- ── Photos ────────────────────────────────────────────────────────────────────────────

-- Registers a photo the panel has just uploaded to <ref>/<file>.jpg in the product-images bucket.
create function public.admin_add_product_image(p_ref text, p_path text, p_width integer, p_height integer, p_alt text) returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  n integer;
  new_id bigint;
begin
  if not exists (select 1 from public.products where ref = p_ref and status <> 'editorial_preview') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_path is null or p_path !~ ('^' || p_ref || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select count(*) into n from public.product_images where product_ref = p_ref;
  if n >= 12 then raise exception 'photo_limit' using errcode = '22023'; end if;
  insert into public.product_images (product_ref, storage_path, width, height, alt, position)
  values (p_ref, p_path, p_width, p_height, left(coalesce(nullif(btrim(p_alt), ''), p_ref), 300), n)
  returning id into new_id;
  perform private.audit(me, 'product.photo_added', 'product', p_ref, null, jsonb_build_object('photo', p_path));
  return new_id;
end;
$$;

-- Makes a photo the main (first) one.
create function public.admin_set_main_product_image(p_id bigint) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  img public.product_images;
begin
  select * into img from public.product_images where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.product_images set position = case when id = p_id then -1 else position end where product_ref = img.product_ref;
  perform private.renumber_product_images(img.product_ref);
  perform private.audit(me, 'product.photo_main', 'product', img.product_ref, null, jsonb_build_object('photo', img.storage_path));
end;
$$;

-- Removes a photo's row and returns its file path so the panel can delete the file.
create function public.admin_delete_product_image(p_id bigint) returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  img public.product_images;
begin
  select * into img from public.product_images where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select published from public.products where ref = img.product_ref)
     and (select count(*) from public.product_images where product_ref = img.product_ref) = 1 then
    raise exception 'needs_photo' using errcode = '22023';
  end if;
  delete from public.product_images where id = p_id;
  perform private.renumber_product_images(img.product_ref);
  perform private.audit(me, 'product.photo_removed', 'product', img.product_ref, jsonb_build_object('photo', img.storage_path), null);
  return img.storage_path;
end;
$$;

-- Deletes a piece and its photo rows; returns the file paths so the panel can delete the files.
-- (Unpublishing keeps the history; deleting is for mistakes.)
create function public.admin_delete_product(p_ref text) returns text[]
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.products;
  paths text[];
begin
  select * into old from public.products where ref = p_ref for update;
  if not found or old.status = 'editorial_preview' then raise exception 'not_found' using errcode = 'P0002'; end if;
  select coalesce(array_agg(storage_path), '{}') into paths from public.product_images where product_ref = p_ref;
  delete from public.products where ref = p_ref;
  perform private.audit(me, 'product.deleted', 'product', p_ref, to_jsonb(old) - 'created_at' - 'updated_at', null);
  return paths;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────

revoke execute on function private.next_product_ref(), private.renumber_product_images(text), private.product_text(jsonb, text, integer)
  from public, anon, authenticated;

revoke execute on function
  public.admin_save_product(text, jsonb),
  public.admin_add_product_image(text, text, integer, integer, text),
  public.admin_set_main_product_image(bigint),
  public.admin_delete_product_image(bigint),
  public.admin_delete_product(text)
from public, anon, authenticated;

-- Signed-in accounts (owner role checked inside each function).
grant execute on function
  public.admin_save_product(text, jsonb),
  public.admin_add_product_image(text, text, integer, integer, text),
  public.admin_set_main_product_image(bigint),
  public.admin_delete_product_image(bigint),
  public.admin_delete_product(text)
to authenticated;
