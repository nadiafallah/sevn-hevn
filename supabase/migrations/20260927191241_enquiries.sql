-- Enquiries submitted through the website's own "send" action.
-- A WhatsApp or email hand-off never creates a row: those messages are sent (or not) by the
-- customer outside the website, so we cannot know they were sent.
-- Private: no public access at all. Only the server (service role) inserts; the owner reads
-- them in the Supabase dashboard.

create type public.enquiry_kind as enum ('sourcing', 'viewing');
create type public.enquiry_status as enum ('new', 'replied', 'closed', 'spam');

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  -- Short code shown to the customer and quoted in replies.
  reference text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  kind public.enquiry_kind not null,
  status public.enquiry_status not null default 'new',
  -- Catalogue ref the enquiry is about, if any (may be an editorial preview, so no foreign key).
  item_ref text check (item_ref ~ '^[A-Za-z0-9-]{2,40}$'),
  name text check (length(name) <= 80),
  contact_method text not null check (contact_method in ('whatsapp', 'phone', 'email')),
  contact_value text not null check (length(btrim(contact_value)) between 3 and 120),
  message text not null check (length(message) between 1 and 4000),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8000),
  -- Salted hash of the sender's IP address, used only for rate limiting. Never the raw IP.
  client_hash text check (length(client_hash) <= 128),
  created_at timestamptz not null default now()
);

comment on table public.enquiries is 'Private. Enquiries submitted through the website (personal data). Server-only writes; no public access.';
create index enquiries_created_idx on public.enquiries (created_at desc);
create index enquiries_client_hash_idx on public.enquiries (client_hash, created_at desc);

alter table public.enquiries enable row level security;
revoke all on public.enquiries from anon, authenticated;
-- No policies: anon and authenticated can neither read nor write. The service role bypasses RLS.

-- Abuse guard: at most 5 enquiries per sender per hour and 200 site-wide per hour.
create function public.enquiries_rate_limit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_hash is not null and (
    select count(*) from public.enquiries
    where client_hash = new.client_hash and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'per_sender';
  end if;
  if (select count(*) from public.enquiries where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'site_wide';
  end if;
  return new;
end;
$$;

create trigger enquiries_rate_limit
  before insert on public.enquiries
  for each row execute function public.enquiries_rate_limit();
