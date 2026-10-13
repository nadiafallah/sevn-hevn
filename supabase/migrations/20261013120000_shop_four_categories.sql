-- SEVN HEVN shop (Oct 2026): four categories, permitted houses, category details, versions of a
-- piece, and purchase requests from the website's checkout.
--
-- * Categories: Bags, Shoes, Watches, Jewellery. Jewellery replaces Accessories.
-- * Houses: Hermès, Louis Vuitton, Gucci and Chanel in every category; Cartier, Van Cleef & Arpels
--   and Bvlgari in Jewellery only. The same list is in src/data/brands.ts — keep the two in step.
--   Spellings are normalised on save ("Hermes" → "Hermès").
-- * Enforced here, so neither the panel nor an import or a dashboard edit can publish a piece
--   outside the shop. Rows outside it are only unpublished (hidden), never deleted.
-- * Versions (colour / size / hardware) of one model live in product_variants, each with its own
--   code and, where it differs, its own price, stock and photo.
-- * Purchase requests: the checkout stores the verified bag and the customer's details as a request
--   of type "purchase" in the private panel, through shop_submit_purchase(), which only the
--   website's server key can call. No payment is taken or recorded; orders, customers and earlier
--   requests are not changed.
--
-- Requires 20261007120000_panel_products.sql and 20261011120000_concierge_languages.sql.
-- Rollback: supabase/rollbacks/20261013120000_shop_four_categories.down.sql

-- ── Houses and types ──────────────────────────────────────────────────────────────────

-- "Hermès", "HERMES", "hermes paris" → "Hermès"; null for any house the shop doesn't list.
create function private.canonical_brand(p text) returns text
language sql immutable
set search_path = ''
as $$
  select case btrim(regexp_replace(replace(lower(translate(coalesce(p, ''), 'ÀÁÂÄàáâäÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÖòóôöÙÚÛÜùúûü', 'AAAAaaaaEEEEeeeeIIIIiiiiOOOOooooUUUUuuuu')), '&', ' and '), '[^a-z0-9]+', ' ', 'g'))
    when 'hermes' then 'Hermès'
    when 'hermes paris' then 'Hermès'
    when 'louis vuitton' then 'Louis Vuitton'
    when 'lv' then 'Louis Vuitton'
    when 'vuitton' then 'Louis Vuitton'
    when 'gucci' then 'Gucci'
    when 'chanel' then 'Chanel'
    when 'cartier' then 'Cartier'
    when 'van cleef and arpels' then 'Van Cleef & Arpels'
    when 'van cleef arpels' then 'Van Cleef & Arpels'
    when 'van cleef' then 'Van Cleef & Arpels'
    when 'vca' then 'Van Cleef & Arpels'
    when 'bvlgari' then 'Bvlgari'
    when 'bulgari' then 'Bvlgari'
  end
$$;

create function private.brand_allowed(p_category text, p_brand text) returns boolean
language sql immutable
set search_path = ''
as $$
  select case private.canonical_brand(p_brand)
    when 'Hermès' then p_category in ('bags', 'shoes', 'watches', 'jewellery')
    when 'Louis Vuitton' then p_category in ('bags', 'shoes', 'watches', 'jewellery')
    when 'Gucci' then p_category in ('bags', 'shoes', 'watches', 'jewellery')
    when 'Chanel' then p_category in ('bags', 'shoes', 'watches', 'jewellery')
    when 'Cartier' then p_category = 'jewellery'
    when 'Van Cleef & Arpels' then p_category = 'jewellery'
    when 'Bvlgari' then p_category = 'jewellery'
    else false
  end
$$;

-- Type ids per category (src/data/taxonomy.ts), from an id or a familiar name; null if unknown.
create function private.subcategory_id(p_category text, p_value text) returns text
language sql immutable
set search_path = ''
as $$
  select case p_category
    when 'bags' then case
      when k in ('handbags', 'handbag', 'top handle', 'top-handle', 'tote', 'totes') then 'handbags'
      when k in ('shoulder', 'shoulder & crossbody', 'shoulder bags', 'shoulder bag', 'crossbody', 'crossbody bags', 'cross-body') then 'shoulder'
      when k in ('clutches', 'clutch', 'evening bags') then 'clutches' end
    when 'shoes' then case
      when k in ('sandals', 'sandal', 'slides') then 'sandals'
      when k in ('sneakers', 'sneaker', 'trainers') then 'sneakers'
      when k in ('loafers', 'loafers & mules', 'loafer', 'mules', 'mule', 'moccasins') then 'loafers'
      when k in ('heels', 'pumps', 'pump', 'heeled', 'slingbacks') then 'heels' end
    when 'watches' then case
      when k in ('women', 'womens', 'women''s', 'women’s', 'ladies') then 'women'
      when k in ('men', 'mens', 'men''s', 'men’s', 'gents') then 'men'
      when k = 'unisex' then 'unisex' end
    when 'jewellery' then case
      when k in ('rings', 'ring') then 'rings'
      when k in ('bracelets', 'bracelet', 'bangles', 'bangle', 'cuffs') then 'bracelets'
      when k in ('necklaces', 'necklace', 'pendants', 'pendant', 'chains') then 'necklaces'
      when k in ('earrings', 'earring', 'studs', 'hoops') then 'earrings' end
  end
  from (select lower(btrim(coalesce(p_value, ''))) as k) v
$$;

-- ── Category details ──────────────────────────────────────────────────────────────────

alter table public.products
  add column hardware text check (length(hardware) <= 80),
  add column size_system text check (size_system in ('EU', 'IT', 'FR', 'UK', 'US')),
  add column case_diameter_mm numeric(4, 1) check (case_diameter_mm between 10 and 70),
  add column movement text check (movement in ('automatic', 'manual', 'quartz')),
  add column purity text check (length(purity) <= 80),
  add column stones text check (length(stones) <= 300),
  add column audience text check (audience in ('women', 'men', 'unisex'));

comment on column public.products.purity is 'Jewellery: fineness or carat exactly as documented (e.g. 18k, 925). Never state gold or stones without documentation.';
comment on column public.products.stones is 'Jewellery: confirmed stone details only.';

-- ── Existing rows: normalise, and hide what is outside the shop ───────────────────────
-- Done before the guard below exists. Nothing is deleted.

update public.products set brand = private.canonical_brand(brand)
where private.canonical_brand(brand) is not null and brand is distinct from private.canonical_brand(brand);

update public.products set subcategory = private.subcategory_id(category, subcategory)
where private.subcategory_id(category, subcategory) is not null and subcategory is distinct from private.subcategory_id(category, subcategory);

update public.products set published = false
where published and (category not in ('bags', 'shoes', 'watches', 'jewellery') or not private.brand_allowed(category, brand));

-- ── Guard: only the four categories and the permitted houses can be published ─────────

create function private.products_shop_scope() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.brand := coalesce(private.canonical_brand(new.brand), nullif(btrim(new.brand), ''));
  if new.subcategory is not null then
    new.subcategory := coalesce(private.subcategory_id(new.category, new.subcategory), nullif(btrim(new.subcategory), ''));
  end if;
  if new.published and not (new.category in ('bags', 'shoes', 'watches', 'jewellery') and private.brand_allowed(new.category, new.brand)) then
    raise exception 'out_of_scope' using errcode = '22023',
      hint = 'Only Hermès, Louis Vuitton, Gucci and Chanel — and, for jewellery, Cartier, Van Cleef & Arpels and Bvlgari — in Bags, Shoes, Watches or Jewellery can be published.';
  end if;
  return new;
end;
$$;

create trigger products_shop_scope
  before insert or update on public.products
  for each row execute function private.products_shop_scope();

-- ── Versions of a piece ───────────────────────────────────────────────────────────────

create table public.product_variants (
  id bigint generated always as identity primary key,
  product_ref text not null references public.products (ref) on update cascade on delete cascade,
  -- The version's own code, quoted in the bag, enquiries and orders.
  sku text not null check (sku ~ '^[A-Za-z0-9-]{2,48}$'),
  colour text check (length(btrim(colour)) between 1 and 80),
  size text check (length(btrim(size)) between 1 and 40),
  hardware text check (length(btrim(hardware)) between 1 and 80),
  material text check (length(btrim(material)) between 1 and 120),
  -- Leave empty to use the piece's own price and stock.
  price_aed integer check (price_aed > 0),
  stock integer check (stock >= 0),
  image_id bigint references public.product_images (id) on delete set null,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_has_option check (coalesce(colour, size, hardware, material) is not null)
);
comment on table public.product_variants is 'Versions (colour / size / hardware) of a product. Public only when the parent product is published.';
create unique index product_variants_sku_key on public.product_variants (upper(sku));
create index product_variants_product_idx on public.product_variants (product_ref, position, id);

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

-- A version's photo must be one of its own piece's photos.
create function private.variant_image_check() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.image_id is not null and not exists (select 1 from public.product_images i where i.id = new.image_id and i.product_ref = new.product_ref) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger product_variants_image_check
  before insert or update on public.product_variants
  for each row execute function private.variant_image_check();

alter table public.product_variants enable row level security;
revoke all on public.product_variants from anon, authenticated;
grant select on public.product_variants to anon, authenticated;
create policy "Versions of published products are public" on public.product_variants for select to anon, authenticated
  using (exists (select 1 from public.products p where p.ref = product_ref and p.published));
create policy "Team can read every version" on public.product_variants for select to authenticated using (private.is_staff());

create trigger product_variants_notify_change
  after insert or update or delete on public.product_variants
  for each statement execute function public.notify_catalog_change();

-- ── Panel: save a piece (same as 20261007120000, with the shop's rules) ───────────────

create or replace function public.admin_save_product(p_ref text, p_fields jsonb) returns text
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
  v_cat text;
  v_brand text;
begin
  if jsonb_typeof(f) <> 'object' or exists (
    select 1 from jsonb_object_keys(f) k where k not in (
      'name', 'category', 'subcategory', 'brand', 'model_reference', 'description', 'price_aed', 'stock', 'condition',
      'condition_notes', 'year', 'material', 'colour', 'size', 'dimensions', 'included', 'authentication', 'delivery',
      'returns', 'status', 'published', 'featured',
      'hardware', 'size_system', 'case_diameter_mm', 'movement', 'purity', 'stones', 'audience')
  ) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if f ? 'category' and coalesce(f ->> 'category', '') <> all (array['bags', 'shoes', 'watches', 'jewellery']) then
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

  if p_ref is not null then
    select * into old from public.products where ref = p_ref for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if old.status = 'editorial_preview' then raise exception 'invalid_request' using errcode = '22023'; end if;
  end if;

  -- The house must be one of the shop's, and allowed in the category. (Hiding a piece is always
  -- possible, so a row from before these rules can still be taken off the website.)
  v_cat := coalesce(f ->> 'category', old.category);
  v_brand := case when f ? 'brand' then private.product_text(f, 'brand', 80) else old.brand end;
  if (p_ref is null or f ? 'brand' or f ? 'category' or coalesce((f ->> 'published')::boolean, old.published, false))
     and (v_brand is null or not private.brand_allowed(v_cat, v_brand)) then
    raise exception 'brand_not_allowed' using errcode = '22023';
  end if;
  if f ? 'subcategory' and private.product_text(f, 'subcategory', 80) is not null
     and private.subcategory_id(v_cat, private.product_text(f, 'subcategory', 80)) is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  begin
    if p_ref is null then
      if not (f ? 'name' and f ? 'category') then raise exception 'invalid_request' using errcode = '22023'; end if;
      if coalesce((f ->> 'published')::boolean, false) then raise exception 'needs_photo' using errcode = '22023'; end if;
      insert into public.products (
        ref, published, status, name, category, subcategory, brand, model_reference, description, price_aed, stock,
        condition, condition_notes, year, material, colour, size, dimensions, included, authentication, delivery, returns, featured,
        hardware, size_system, case_diameter_mm, movement, purity, stones, audience
      ) values (
        private.next_product_ref(), false, coalesce((f ->> 'status')::public.item_status, 'enquiry_only'),
        private.product_text(f, 'name', 160), f ->> 'category', private.product_text(f, 'subcategory', 80),
        v_brand, private.product_text(f, 'model_reference', 80), private.product_text(f, 'description', 2000),
        (private.product_text(f, 'price_aed', 12))::integer, (private.product_text(f, 'stock', 6))::integer,
        (private.product_text(f, 'condition', 20))::public.item_condition, private.product_text(f, 'condition_notes', 500),
        private.product_text(f, 'year', 20), private.product_text(f, 'material', 120), private.product_text(f, 'colour', 80),
        private.product_text(f, 'size', 80), private.product_text(f, 'dimensions', 120),
        coalesce(array(select btrim(x) from jsonb_array_elements_text(f -> 'included') x where btrim(x) <> '' limit 12), '{}'),
        private.product_text(f, 'authentication', 1000), private.product_text(f, 'delivery', 1000), private.product_text(f, 'returns', 1000),
        coalesce((f ->> 'featured')::boolean, false),
        private.product_text(f, 'hardware', 80), private.product_text(f, 'size_system', 2),
        (private.product_text(f, 'case_diameter_mm', 6))::numeric, private.product_text(f, 'movement', 20),
        private.product_text(f, 'purity', 80), private.product_text(f, 'stones', 300), private.product_text(f, 'audience', 10)
      ) returning * into new;
      perform private.audit(me, 'product.created', 'product', new.ref, null, to_jsonb(new) - 'created_at' - 'updated_at');
      return new.ref;
    end if;

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
      returns = case when f ? 'returns' then private.product_text(f, 'returns', 1000) else returns end,
      hardware = case when f ? 'hardware' then private.product_text(f, 'hardware', 80) else hardware end,
      size_system = case when f ? 'size_system' then private.product_text(f, 'size_system', 2) else size_system end,
      case_diameter_mm = case when f ? 'case_diameter_mm' then (private.product_text(f, 'case_diameter_mm', 6))::numeric else case_diameter_mm end,
      movement = case when f ? 'movement' then private.product_text(f, 'movement', 20) else movement end,
      purity = case when f ? 'purity' then private.product_text(f, 'purity', 80) else purity end,
      stones = case when f ? 'stones' then private.product_text(f, 'stones', 300) else stones end,
      audience = case when f ? 'audience' then private.product_text(f, 'audience', 10) else audience end
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

-- ── Panel: versions ───────────────────────────────────────────────────────────────────

-- p_id null adds a version; otherwise only the keys present change ("" clears an optional field).
create function public.admin_save_variant(p_ref text, p_id bigint, p_fields jsonb) returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  old public.product_variants;
  new public.product_variants;
  n integer;
begin
  if jsonb_typeof(f) <> 'object' or exists (
    select 1 from jsonb_object_keys(f) k where k not in ('sku', 'colour', 'size', 'hardware', 'material', 'price_aed', 'stock', 'image_id', 'position')
  ) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where ref = p_ref and status <> 'editorial_preview') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  begin
    if p_id is null then
      select count(*) into n from public.product_variants where product_ref = p_ref;
      if n >= 40 then raise exception 'invalid_request' using errcode = '22023'; end if;
      insert into public.product_variants (product_ref, sku, colour, size, hardware, material, price_aed, stock, image_id, position)
      values (
        p_ref, coalesce(private.product_text(f, 'sku', 48), p_ref || '-' || (n + 1)::text),
        private.product_text(f, 'colour', 80), private.product_text(f, 'size', 40), private.product_text(f, 'hardware', 80),
        private.product_text(f, 'material', 120), (private.product_text(f, 'price_aed', 12))::integer,
        (private.product_text(f, 'stock', 6))::integer, (private.product_text(f, 'image_id', 18))::bigint, n
      ) returning * into new;
      perform private.audit(me, 'product.variant_added', 'product', p_ref, null, to_jsonb(new) - 'created_at' - 'updated_at');
      return new.id;
    end if;
    select * into old from public.product_variants where id = p_id and product_ref = p_ref for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public.product_variants set
      sku = coalesce(case when f ? 'sku' then private.product_text(f, 'sku', 48) end, sku),
      colour = case when f ? 'colour' then private.product_text(f, 'colour', 80) else colour end,
      size = case when f ? 'size' then private.product_text(f, 'size', 40) else size end,
      hardware = case when f ? 'hardware' then private.product_text(f, 'hardware', 80) else hardware end,
      material = case when f ? 'material' then private.product_text(f, 'material', 120) else material end,
      price_aed = case when f ? 'price_aed' then (private.product_text(f, 'price_aed', 12))::integer else price_aed end,
      stock = case when f ? 'stock' then (private.product_text(f, 'stock', 6))::integer else stock end,
      image_id = case when f ? 'image_id' then (private.product_text(f, 'image_id', 18))::bigint else image_id end,
      position = coalesce((private.product_text(f, 'position', 4))::smallint, position)
    where id = p_id returning * into new;
  exception
    when check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_request' using errcode = '22023';
    when unique_violation then
      raise exception 'duplicate' using errcode = '23505';
  end;
  perform private.audit(me, 'product.variant_updated', 'product', p_ref, to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
  return new.id;
end;
$$;

create function public.admin_delete_variant(p_id bigint) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.product_variants;
begin
  select * into old from public.product_variants where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  delete from public.product_variants where id = p_id;
  perform private.audit(me, 'product.variant_removed', 'product', old.product_ref, to_jsonb(old) - 'created_at' - 'updated_at', null);
end;
$$;

-- ── Purchase requests from the checkout ───────────────────────────────────────────────

alter type public.request_type add value if not exists 'purchase';

alter table public.requests
  drop constraint requests_source_check,
  add constraint requests_source_check check (source in ('widget', 'page', 'checkout'));

-- Stores a purchase request (once per idempotency key): the customer, the request with the verified
-- bag in `details`, and the notification outbox rows, in one transaction. The website verifies the
-- bag against the catalogue before calling this. Nothing here records a payment.
create function public.shop_submit_purchase(p_key text, p_request jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  r public.requests;
  idem text := p_request ->> 'idempotency_key';
  phone text := p_request ->> 'contact_phone';
  hash text := nullif(p_request ->> 'client_hash', '');
  test boolean;
  cust uuid;
begin
  perform private.assert_server_key(p_key);
  if idem is null or idem !~ '^checkout:[A-Za-z0-9-]{16,64}$' or jsonb_typeof(p_request -> 'details') <> 'object'
     or jsonb_typeof(p_request -> 'details' -> 'lines') <> 'array' or jsonb_array_length(p_request -> 'details' -> 'lines') not between 1 and 20 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into r from public.requests where idempotency_key = idem;
  if found then
    return jsonb_build_object('id', r.id, 'reference', r.reference, 'created', false);
  end if;

  perform private.hit('purchase_submit', coalesce(hash, phone), 5, interval '1 hour');
  perform private.hit('purchase_submit_all', '*', 200, interval '1 hour');

  -- Numbers in the UK Ofcom drama range (+44 7700 900000–900999) are never assigned to real
  -- people; requests using them are automated tests and are kept out of statistics.
  test := phone ~ '^\+447700900[0-9]{3}$';

  insert into public.customers (name, phone_e164, email, preferred_language, preferred_contact, country_code, is_test)
  values (
    nullif(btrim(p_request ->> 'contact_name'), ''), phone, nullif(lower(btrim(p_request ->> 'contact_email')), ''),
    p_request ->> 'locale', p_request ->> 'contact_method', nullif(p_request ->> 'destination_country', ''), test
  )
  on conflict (phone_e164, is_test) do update set
    name = coalesce(public.customers.name, excluded.name),
    email = coalesce(public.customers.email, excluded.email),
    preferred_language = excluded.preferred_language,
    preferred_contact = excluded.preferred_contact,
    country_code = coalesce(excluded.country_code, public.customers.country_code)
  returning id into cust;

  insert into public.requests (
    customer_id, type, summary, details, needs_review, locale, destination_country, destination_label,
    contact_name, contact_phone, contact_email, contact_method, contact_consent, consent_text, source,
    idempotency_key, client_hash, is_test
  ) values (
    cust, 'purchase', p_request ->> 'summary', p_request -> 'details', 'availability', p_request ->> 'locale',
    nullif(p_request ->> 'destination_country', ''), nullif(p_request ->> 'destination_label', ''),
    nullif(btrim(p_request ->> 'contact_name'), ''), phone, nullif(lower(btrim(p_request ->> 'contact_email')), ''),
    p_request ->> 'contact_method', true, p_request ->> 'consent_text', 'checkout', idem, hash, test
  ) returning * into r;

  insert into public.notifications (request_id, channel) values (r.id, 'email'), (r.id, 'whatsapp');
  perform private.audit(null, 'request.created', 'request', r.id::text, null,
    jsonb_build_object('reference', r.reference, 'type', 'purchase', 'is_test', r.is_test));

  return jsonb_build_object('id', r.id, 'reference', r.reference, 'created', true);
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────

revoke execute on function
  private.canonical_brand(text), private.brand_allowed(text, text), private.subcategory_id(text, text),
  private.products_shop_scope(), private.variant_image_check()
from public, anon, authenticated;

revoke execute on function
  public.admin_save_variant(text, bigint, jsonb), public.admin_delete_variant(bigint), public.shop_submit_purchase(text, jsonb)
from public, anon, authenticated;

-- Signed-in accounts (owner role checked inside each function).
grant execute on function public.admin_save_variant(text, bigint, jsonb), public.admin_delete_variant(bigint) to authenticated;

-- The website server (anon key + server key checked inside the function).
grant execute on function public.shop_submit_purchase(text, jsonb) to anon;
