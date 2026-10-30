-- SEVN HEVN shop houses (owner decision, 28 Oct 2026): the shop lists only the houses SEVN HEVN
-- actually holds.
--
-- * Hermès and Chanel: bags, shoes, watches and jewellery.
-- * Miu Miu and Loro Piana: bags and shoes.
-- * Louis Vuitton, Gucci, Cartier, Van Cleef & Arpels and Bvlgari are no longer listed. Published
--   pieces of those houses are unpublished, never deleted.
-- * A new bag type, "Pouches & cases" (e.g. Hermès Bride-à-Brac).
--
-- Keep in step with src/data/brands.ts and src/data/taxonomy.ts.
-- Depends on 20261013120000_shop_four_categories.sql.
--
-- Rollback: supabase/rollbacks/20261028120000_shop_houses.down.sql

-- "Hermès", "HERMES", "miu-miu" → "Hermès", "Miu Miu"; null for any house the shop doesn't list.
create or replace function private.canonical_brand(p text) returns text
language sql immutable
set search_path = ''
as $$
  select case btrim(regexp_replace(replace(lower(translate(coalesce(p, ''), 'ÀÁÂÄàáâäÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÖòóôöÙÚÛÜùúûü', 'AAAAaaaaEEEEeeeeIIIIiiiiOOOOooooUUUUuuuu')), '&', ' and '), '[^a-z0-9]+', ' ', 'g'))
    when 'hermes' then 'Hermès'
    when 'hermes paris' then 'Hermès'
    when 'chanel' then 'Chanel'
    when 'miu miu' then 'Miu Miu'
    when 'miumiu' then 'Miu Miu'
    when 'loro piana' then 'Loro Piana'
    when 'loropiana' then 'Loro Piana'
  end
$$;

create or replace function private.brand_allowed(p_category text, p_brand text) returns boolean
language sql immutable
set search_path = ''
as $$
  select case private.canonical_brand(p_brand)
    when 'Hermès' then p_category in ('bags', 'shoes', 'watches', 'jewellery')
    when 'Chanel' then p_category in ('bags', 'shoes', 'watches', 'jewellery')
    when 'Miu Miu' then p_category in ('bags', 'shoes')
    when 'Loro Piana' then p_category in ('bags', 'shoes')
    else false
  end
$$;

-- Type ids per category (src/data/taxonomy.ts), from an id or a familiar name; null if unknown.
create or replace function private.subcategory_id(p_category text, p_value text) returns text
language sql immutable
set search_path = ''
as $$
  select case p_category
    when 'bags' then case
      when k in ('handbags', 'handbag', 'top handle', 'top-handle', 'tote', 'totes') then 'handbags'
      when k in ('shoulder', 'shoulder & crossbody', 'shoulder bags', 'shoulder bag', 'crossbody', 'crossbody bags', 'cross-body') then 'shoulder'
      when k in ('clutches', 'clutch', 'evening bags') then 'clutches'
      when k in ('pouches', 'pouches & cases', 'pouch', 'case', 'cases', 'toiletry case', 'toiletry cases') then 'pouches' end
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

-- Pieces of a house the shop no longer lists leave the website; nothing is deleted.
update public.products set published = false
where published and not private.brand_allowed(category, brand);
