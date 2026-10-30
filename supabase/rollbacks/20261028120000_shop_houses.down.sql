-- Rollback of 20261028120000_shop_houses.sql: the houses and types of 20261013120000_shop_four_categories.sql.
-- Pieces unpublished by the migration stay unpublished (publish them again in the panel if wanted).
-- Pieces typed "pouches" keep that value; choose another type for them in the panel.

create or replace function private.canonical_brand(p text) returns text
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

create or replace function private.brand_allowed(p_category text, p_brand text) returns boolean
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

create or replace function private.subcategory_id(p_category text, p_value text) returns text
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
