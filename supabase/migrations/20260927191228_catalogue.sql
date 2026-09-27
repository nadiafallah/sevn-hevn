-- SEVN HEVN catalogue: products and their images.
-- Public visitors (anon / authenticated) may read published rows only. Nobody except the
-- service role (server) and the dashboard can insert, update or delete.

create type public.item_status as enum ('editorial_preview', 'enquiry_only', 'available', 'reserved', 'sold');
create type public.item_condition as enum ('new', 'unworn', 'excellent', 'very_good', 'good', 'fair');

create table public.products (
  ref text primary key check (ref ~ '^[A-Za-z0-9-]{2,40}$'),
  -- Draft until ticked. Unpublished rows are invisible to the website and the public API.
  published boolean not null default false,
  status public.item_status not null default 'enquiry_only',
  name text not null check (length(btrim(name)) between 1 and 160),
  category text not null check (category in ('bags', 'watches', 'shoes', 'jewellery', 'accessories', 'clothing', 'eyewear', 'lifestyle')),
  subcategory text,
  brand text,
  model_reference text,
  description text,
  -- Whole AED. Leave empty when not confirmed: the site shows "Enquire for details", never AED 0.
  price_aed integer check (price_aed > 0),
  stock integer check (stock >= 0),
  max_per_order integer not null default 1 check (max_per_order >= 1),
  condition public.item_condition,
  condition_notes text,
  year text,
  material text,
  colour text,
  size text,
  dimensions text,
  included text[] not null default '{}',
  authentication text,
  delivery text,
  returns text,
  featured boolean not null default false,
  editorial_note text,
  listed_at date default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- "available" means buyable: it needs a confirmed price, stock and delivery details.
  constraint available_needs_price_stock_delivery check (
    status <> 'available'
    or (price_aed is not null and stock is not null and stock >= 1 and nullif(btrim(delivery), '') is not null)
  ),
  -- Editorial previews are mood imagery, never inventory: no brand, price or stock.
  constraint editorial_preview_is_not_inventory check (
    status <> 'editorial_preview' or (brand is null and price_aed is null and stock is null)
  )
);

comment on table public.products is 'Catalogue. Public: published rows only. Do not store supplier, owner or private notes here.';

-- The site looks items up case-insensitively (/collection?item=sh-0001).
create unique index products_ref_upper_key on public.products (upper(ref));
create index products_published_listed_idx on public.products (published, listed_at desc);

create table public.product_images (
  id bigint generated always as identity primary key,
  product_ref text not null references public.products (ref) on update cascade on delete cascade,
  -- Object path inside the "product-images" Storage bucket, e.g. SH-0001/front.jpg
  storage_path text not null check (storage_path ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$' and storage_path !~ '\.\.'),
  width integer not null default 1600 check (width between 1 and 12000),
  height integer not null default 2000 check (height between 1 and 12000),
  alt text not null check (length(btrim(alt)) between 1 and 300),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.product_images is 'Images for products. Public only when the parent product is published.';
create index product_images_product_ref_idx on public.product_images (product_ref, position, id);

-- updated_at bookkeeping
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- Row-level security: deny by default, then allow public reads of published rows.
alter table public.products enable row level security;
alter table public.product_images enable row level security;

revoke all on public.products, public.product_images from anon, authenticated;
grant select on public.products, public.product_images to anon, authenticated;

create policy "Published products are public"
  on public.products for select
  to anon, authenticated
  using (published);

create policy "Images of published products are public"
  on public.product_images for select
  to anon, authenticated
  using (exists (select 1 from public.products p where p.ref = product_ref and p.published));

-- Storage: public-read bucket for product photos. Files are served by URL; with no policies on
-- storage.objects for this bucket, visitors cannot list, upload, replace or delete files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;
