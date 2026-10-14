-- Newsletter sign-ups from the website footer.
-- Private: no public access at all. Only the server (service role) inserts; the owner reads or
-- exports the list in the Supabase dashboard. Additive: creates one table, one function and one
-- trigger; changes nothing that exists.

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  -- Stored lower-case so the same address can only be on the list once.
  email text not null unique check (email = lower(email) and length(email) between 6 and 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  name text check (length(name) <= 80),
  -- The exact wording shown next to the Join button when the visitor agreed.
  consent_text text not null check (length(consent_text) between 10 and 600),
  consent_at timestamptz not null default now(),
  source text not null default 'footer' check (source in ('footer')),
  -- Set when someone asks to be removed. The row is kept so they are never added back by mistake.
  unsubscribed_at timestamptz,
  -- Salted hash of the sender's IP address, used only for rate limiting. Never the raw IP.
  client_hash text check (length(client_hash) <= 128),
  created_at timestamptz not null default now()
);

comment on table public.newsletter_subscribers is 'Private. Newsletter sign-ups from the website footer (personal data). Server-only writes; no public access.';
create index newsletter_subscribers_created_idx on public.newsletter_subscribers (created_at desc);
create index newsletter_subscribers_client_hash_idx on public.newsletter_subscribers (client_hash, created_at desc);

alter table public.newsletter_subscribers enable row level security;
revoke all on public.newsletter_subscribers from anon, authenticated;
-- No policies: anon and authenticated can neither read nor write. The service role bypasses RLS.

-- Abuse guard: at most 5 sign-ups per sender per hour and 300 site-wide per hour.
create function public.newsletter_rate_limit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_hash is not null and (
    select count(*) from public.newsletter_subscribers
    where client_hash = new.client_hash and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'per_sender';
  end if;
  if (select count(*) from public.newsletter_subscribers where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'site_wide';
  end if;
  return new;
end;
$$;

revoke all on function public.newsletter_rate_limit() from public, anon, authenticated;

create trigger newsletter_rate_limit
  before insert on public.newsletter_subscribers
  for each row execute function public.newsletter_rate_limit();
