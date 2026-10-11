-- SEVN HEVN: 360° views of pieces, managed in the private panel.
--
-- * A view is either a photo spin (12–72 photographs taken in one horizontal turn, all the same
--   shape) or a 3D model (.glb checked by the server). Interior photographs can be added to either.
-- * Files live in the public "product-media" bucket under <ref>/360/…; only the owner can add or
--   remove them. Visitors can read a file by its URL but cannot list, upload or delete.
-- * The website shows a view only when the owner has switched it on AND it is complete; removing
--   frames or the model switches an incomplete view off again, so a broken button never shows.
-- * Visitors read views and media of published pieces only; the team reads everything.
-- * Every change goes through an admin_* function that checks the role and writes the activity log.
--
-- Rollback: supabase/rollbacks/20261012120000_product_360.down.sql

create table public.product_views (
  product_ref text primary key references public.products (ref) on update cascade on delete cascade,
  enabled boolean not null default false,
  kind text not null default 'spin' check (kind in ('spin', 'model')),
  start_frame smallint not null default 0 check (start_frame between 0 and 71),
  reverse boolean not null default false,
  model_path text check (model_path is null or (model_path ~ '^[A-Za-z0-9-]{2,40}/360/[0-9a-f-]{36}\.glb$')),
  model_bytes integer check (model_bytes is null or model_bytes between 1 and 26214400),
  model_animations text[] not null default '{}' check (cardinality(model_animations) <= 50),
  open_animation text,
  updated_at timestamptz not null default now(),
  constraint product_views_open_animation_known check (open_animation is null or open_animation = any (model_animations))
);
comment on table public.product_views is '360° view settings per piece. Shown on the website only when enabled and complete.';

create table public.product_view_media (
  id bigint generated always as identity primary key,
  product_ref text not null references public.products (ref) on update cascade on delete cascade,
  kind text not null check (kind in ('frame', 'interior')),
  storage_path text not null unique check (storage_path ~ '^[A-Za-z0-9-]{2,40}/360/[0-9a-f-]{36}\.webp$'),
  zoom_path text check (zoom_path is null or zoom_path ~ '^[A-Za-z0-9-]{2,40}/360/[0-9a-f-]{36}-zoom\.webp$'),
  width integer not null check (width between 1 and 12000),
  height integer not null check (height between 1 and 12000),
  alt text check (alt is null or length(btrim(alt)) between 1 and 300),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.product_view_media is 'Spin frames and interior photographs. Public only when the parent piece is published.';
create index product_view_media_ref_idx on public.product_view_media (product_ref, kind, position, id);

create trigger product_views_set_updated_at before update on public.product_views
  for each row execute function public.set_updated_at();

-- ── Access ────────────────────────────────────────────────────────────────────────────

alter table public.product_views enable row level security;
alter table public.product_view_media enable row level security;
revoke all on public.product_views, public.product_view_media from anon, authenticated;
grant select on public.product_views, public.product_view_media to anon, authenticated;

create policy "Views of published products are public" on public.product_views for select to anon, authenticated
  using (exists (select 1 from public.products p where p.ref = product_ref and p.published));
create policy "360 media of published products are public" on public.product_view_media for select to anon, authenticated
  using (exists (select 1 from public.products p where p.ref = product_ref and p.published));
create policy "Team can read every view" on public.product_views for select to authenticated using (private.is_staff());
create policy "Team can read every 360 media" on public.product_view_media for select to authenticated using (private.is_staff());

-- ── Files ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-media', 'product-media', true, 26214400, array['image/webp', 'model/gltf-binary'])
on conflict (id) do nothing;

create policy "Owner can see product media files" on storage.objects for select to authenticated
  using (bucket_id = 'product-media' and private.is_owner());
create policy "Owner can upload product media" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-media' and private.is_owner());
create policy "Owner can delete product media" on storage.objects for delete to authenticated
  using (bucket_id = 'product-media' and private.is_owner());

-- ── Helpers ───────────────────────────────────────────────────────────────────────────

create function private.view_frame_count(p_ref text) returns integer
language sql stable set search_path = '' as $$
  select count(*)::integer from public.product_view_media where product_ref = p_ref and kind = 'frame'
$$;

-- Keeps positions 0, 1, 2, … in their current order.
create function private.renumber_view_media(p_ref text, p_kind text) returns void
language sql volatile set search_path = '' as $$
  update public.product_view_media m set position = r.n - 1
  from (select id, row_number() over (order by position, id) as n from public.product_view_media where product_ref = p_ref and kind = p_kind) r
  where m.id = r.id and m.position <> r.n - 1
$$;

-- A view that is no longer complete is switched off, so the website never offers a broken one.
create function private.check_view_complete(p_ref text) returns void
language plpgsql volatile set search_path = '' as $$
declare v public.product_views; n integer;
begin
  select * into v from public.product_views where product_ref = p_ref;
  if not found or not v.enabled then return; end if;
  n := private.view_frame_count(p_ref);
  if (v.kind = 'spin' and (n < 12 or n > 72)) or (v.kind = 'model' and v.model_path is null) then
    update public.product_views set enabled = false where product_ref = p_ref;
  elsif v.kind = 'spin' and v.start_frame >= n then
    update public.product_views set start_frame = 0 where product_ref = p_ref;
  end if;
end;
$$;

create function private.require_piece(p_ref text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not exists (select 1 from public.products where ref = p_ref and status <> 'editorial_preview') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- ── Media ─────────────────────────────────────────────────────────────────────────────

-- Registers a frame or interior photo the server has just stored (both sizes) in product-media.
create function public.admin_add_view_media(p_ref text, p_kind text, p_path text, p_zoom_path text, p_width integer, p_height integer, p_alt text)
returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  n integer;
  first record;
  new_id bigint;
begin
  perform private.require_piece(p_ref);
  if p_kind not in ('frame', 'interior')
     or p_path is null or p_path !~ ('^' || p_ref || '/360/[0-9a-f-]{36}\.webp$')
     or (p_zoom_path is not null and p_zoom_path <> regexp_replace(p_path, '\.webp$', '-zoom.webp')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select count(*) into n from public.product_view_media where product_ref = p_ref and kind = p_kind;
  if (p_kind = 'frame' and n >= 72) or (p_kind = 'interior' and n >= 12) then
    raise exception 'media_limit' using errcode = '22023';
  end if;
  -- Every frame of a spin must have the same shape, or the piece would jump while turning.
  if p_kind = 'frame' then
    select width, height into first from public.product_view_media where product_ref = p_ref and kind = 'frame' order by position, id limit 1;
    if found and abs(first.width::numeric / first.height - p_width::numeric / p_height) > 0.01 then
      raise exception 'frame_mismatch' using errcode = '22023';
    end if;
  end if;
  insert into public.product_views (product_ref) values (p_ref) on conflict (product_ref) do nothing;
  insert into public.product_view_media (product_ref, kind, storage_path, zoom_path, width, height, alt, position)
  values (p_ref, p_kind, p_path, p_zoom_path, p_width, p_height, nullif(left(btrim(coalesce(p_alt, '')), 300), ''), n)
  returning id into new_id;
  perform private.audit(me, 'product.view_media_added', 'product', p_ref, null, jsonb_build_object('kind', p_kind, 'path', p_path));
  return new_id;
end;
$$;

-- Moves a frame or interior photo one place earlier (-1) or later (+1).
create function public.admin_move_view_media(p_id bigint, p_delta integer) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  m public.product_view_media;
  other public.product_view_media;
begin
  select * into m from public.product_view_media where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_delta not in (-1, 1) then raise exception 'invalid_request' using errcode = '22023'; end if;
  perform private.renumber_view_media(m.product_ref, m.kind);
  select * into m from public.product_view_media where id = p_id;
  select * into other from public.product_view_media where product_ref = m.product_ref and kind = m.kind and position = m.position + p_delta for update;
  if not found then return; end if;
  update public.product_view_media set position = other.position where id = m.id;
  update public.product_view_media set position = m.position where id = other.id;
  perform private.audit(me, 'product.view_media_moved', 'product', m.product_ref, null, jsonb_build_object('id', p_id, 'delta', p_delta));
end;
$$;

-- Reverses the order of the spin frames (photographs taken turning the other way).
create function public.admin_reverse_view_frames(p_ref text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare me uuid := private.require_owner();
begin
  perform private.require_piece(p_ref);
  update public.product_view_media m set position = r.n - 1
  from (select id, row_number() over (order by position desc, id desc) as n from public.product_view_media where product_ref = p_ref and kind = 'frame') r
  where m.id = r.id;
  perform private.audit(me, 'product.view_frames_reversed', 'product', p_ref, null, null);
end;
$$;

-- Removes a frame or interior photo; returns its file paths so the panel can delete the files.
create function public.admin_delete_view_media(p_id bigint) returns text[]
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  m public.product_view_media;
begin
  delete from public.product_view_media where id = p_id returning * into m;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.renumber_view_media(m.product_ref, m.kind);
  perform private.check_view_complete(m.product_ref);
  perform private.audit(me, 'product.view_media_removed', 'product', m.product_ref, jsonb_build_object('kind', m.kind, 'path', m.storage_path), null);
  return array_remove(array[m.storage_path, m.zoom_path], null);
end;
$$;

-- ── Model ─────────────────────────────────────────────────────────────────────────────

-- Records a .glb the server has checked; returns the previous file's path (to delete) if any.
create function public.admin_set_view_model(p_ref text, p_path text, p_bytes integer, p_animations text[]) returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old text;
begin
  perform private.require_piece(p_ref);
  if p_path is null or p_path !~ ('^' || p_ref || '/360/[0-9a-f-]{36}\.glb$') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  insert into public.product_views (product_ref) values (p_ref) on conflict (product_ref) do nothing;
  select model_path into old from public.product_views where product_ref = p_ref for update;
  update public.product_views set
    model_path = p_path, model_bytes = p_bytes, model_animations = coalesce(p_animations, '{}'),
    open_animation = case when open_animation = any (coalesce(p_animations, '{}')) then open_animation end
  where product_ref = p_ref;
  perform private.audit(me, 'product.view_model_set', 'product', p_ref, jsonb_build_object('path', old), jsonb_build_object('path', p_path, 'bytes', p_bytes));
  return old;
end;
$$;

create function public.admin_clear_view_model(p_ref text) returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old text;
begin
  select model_path into old from public.product_views where product_ref = p_ref for update;
  if not found or old is null then return null; end if;
  update public.product_views set model_path = null, model_bytes = null, model_animations = '{}', open_animation = null where product_ref = p_ref;
  perform private.check_view_complete(p_ref);
  perform private.audit(me, 'product.view_model_removed', 'product', p_ref, jsonb_build_object('path', old), null);
  return old;
end;
$$;

-- ── Settings ──────────────────────────────────────────────────────────────────────────

-- Changes kind, start frame, direction, opening animation and on/off. Switching on is refused
-- unless the view is complete (raises view_incomplete).
create function public.admin_save_view(p_ref text, p_fields jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.product_views;
  new public.product_views;
  n integer;
  d record;
begin
  perform private.require_piece(p_ref);
  if exists (select 1 from jsonb_object_keys(p_fields) k where k not in ('enabled', 'kind', 'start_frame', 'reverse', 'open_animation')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  insert into public.product_views (product_ref) values (p_ref) on conflict (product_ref) do nothing;
  select * into old from public.product_views where product_ref = p_ref for update;
  update public.product_views set
    kind = coalesce(p_fields ->> 'kind', kind),
    start_frame = coalesce((p_fields ->> 'start_frame')::smallint, start_frame),
    reverse = coalesce((p_fields ->> 'reverse')::boolean, reverse),
    open_animation = case when p_fields ? 'open_animation' then nullif(p_fields ->> 'open_animation', '') else open_animation end,
    enabled = coalesce((p_fields ->> 'enabled')::boolean, enabled)
  where product_ref = p_ref returning * into new;
  n := private.view_frame_count(p_ref);
  if new.kind = 'spin' and new.start_frame >= greatest(n, 1) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if new.enabled and ((new.kind = 'spin' and (n < 12 or n > 72)) or (new.kind = 'model' and new.model_path is null)) then
    raise exception 'view_incomplete' using errcode = '22023';
  end if;
  select * into d from private.diff(to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
  perform private.audit(me, 'product.view_saved', 'product', p_ref, d.d_before, d.d_after);
end;
$$;

-- Deleting a piece removes its view rows (cascade); this returns the files to delete first.
create function public.admin_view_files(p_ref text) returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(p), '{}') from (
    select unnest(array_remove(array[storage_path, zoom_path], null)) as p from public.product_view_media where product_ref = p_ref and private.is_owner()
    union all
    select model_path from public.product_views where product_ref = p_ref and model_path is not null and private.is_owner()
  ) f
$$;

-- ── Website refresh ───────────────────────────────────────────────────────────────────

create trigger product_views_notify_change after insert or update or delete on public.product_views
  for each statement execute function public.notify_catalog_change();
create trigger product_view_media_notify_change after insert or update or delete on public.product_view_media
  for each statement execute function public.notify_catalog_change();

-- ── Grants ────────────────────────────────────────────────────────────────────────────

revoke execute on function
  private.view_frame_count(text), private.renumber_view_media(text, text), private.check_view_complete(text), private.require_piece(text)
from public, anon, authenticated;

revoke execute on function
  public.admin_add_view_media(text, text, text, text, integer, integer, text),
  public.admin_move_view_media(bigint, integer),
  public.admin_reverse_view_frames(text),
  public.admin_delete_view_media(bigint),
  public.admin_set_view_model(text, text, integer, text[]),
  public.admin_clear_view_model(text),
  public.admin_save_view(text, jsonb),
  public.admin_view_files(text)
from public, anon, authenticated;

-- Signed-in accounts (owner role checked inside each function).
grant execute on function
  public.admin_add_view_media(text, text, text, text, integer, integer, text),
  public.admin_move_view_media(bigint, integer),
  public.admin_reverse_view_frames(text),
  public.admin_delete_view_media(bigint),
  public.admin_set_view_model(text, text, integer, text[]),
  public.admin_clear_view_model(text),
  public.admin_save_view(text, jsonb),
  public.admin_view_files(text)
to authenticated;
