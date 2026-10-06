-- SEVN HEVN concierge chat + private client panel (CRM).
--
-- Access model (deny by default):
-- * anon (the public API key) has no table access at all. The website's server reaches the
--   concierge functions below with the anon key plus a dedicated server key whose SHA-256 hash is
--   stored in private.server_keys. The functions validate everything they write and are rate
--   limited, so the key only allows what the chat itself can do.
-- * authenticated users see CRM data only if they are an active row in staff_members.
--   Reads go through row-level security; every change goes through an admin_* function that
--   checks the caller's role and writes an audit_log row in the same transaction.
-- * The owner can do everything; staff can read everything except the audit log and team emails,
--   add notes, and update follow-up / delivery fields. Prices, payments, orders, knowledge,
--   team, exports and deletions are owner-only.
--
-- Rollback: supabase/rollbacks/20261006120000_concierge_crm.down.sql

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────

create function private.sha256_hex(p text) returns text
language sql immutable strict
set search_path = ''
as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- Unambiguous upper-case code (no 0/O/1/I/L), e.g. REQ-7K2M9Q.
create function private.random_code(n integer) returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()));
  out text := '';
begin
  for i in 0 .. n - 1 loop
    out := out || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return out;
end;
$$;

create function private.new_reference(prefix text) returns text
language sql volatile
set search_path = ''
as $$ select prefix || '-' || private.random_code(6) $$;

-- The website server key (hash only; the key itself lives in Vercel Production env).
create table private.server_keys (
  name text primary key,
  sha256_hex text not null check (sha256_hex ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table private.server_keys enable row level security;
revoke all on private.server_keys from public, anon, authenticated;

create function private.assert_server_key(p_key text) returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_key is null or length(p_key) < 32 or not exists (
    select 1 from private.server_keys k where k.name = 'concierge' and k.sha256_hex = private.sha256_hex(p_key)
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
end;
$$;

-- Generic sliding-window rate limiter. Raises 'rate_limited' when the limit is reached.
create table private.rate_events (
  bucket text not null,
  key text not null,
  at timestamptz not null default now()
);
create index rate_events_lookup_idx on private.rate_events (bucket, key, at desc);
alter table private.rate_events enable row level security;
revoke all on private.rate_events from public, anon, authenticated;

create function private.hit(p_bucket text, p_key text, p_max integer, p_window interval) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  delete from private.rate_events where bucket = p_bucket and key = coalesce(p_key, '-') and at < now() - p_window;
  if random() < 0.02 then
    delete from private.rate_events where at < now() - interval '2 days';
  end if;
  if (select count(*) from private.rate_events where bucket = p_bucket and key = coalesce(p_key, '-')) >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001', hint = p_bucket;
  end if;
  insert into private.rate_events (bucket, key) values (p_bucket, coalesce(p_key, '-'));
end;
$$;

-- AI usage per day (only used when an AI provider is configured).
create table private.ai_usage (
  day date primary key,
  calls integer not null default 0
);
alter table private.ai_usage enable row level security;
revoke all on private.ai_usage from public, anon, authenticated;

-- ── Team ────────────────────────────────────────────────────────────────────────────────

create type public.staff_role as enum ('owner', 'staff');

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  -- Linked on the person's first verified sign-in (matching email); never chosen by the client.
  user_id uuid unique references auth.users (id) on delete set null,
  email text not null check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  display_name text check (length(display_name) <= 80),
  role public.staff_role not null default 'staff',
  active boolean not null default true,
  created_by uuid references public.staff_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index staff_members_email_key on public.staff_members (email);
comment on table public.staff_members is 'Who may use the private panel. Add people from the panel (owner only). No public sign-up grants access.';

create function private.staff_id() returns uuid
language sql stable security definer
set search_path = ''
as $$ select s.id from public.staff_members s where s.user_id = auth.uid() and s.active $$;

create function private.staff_role() returns public.staff_role
language sql stable security definer
set search_path = ''
as $$ select s.role from public.staff_members s where s.user_id = auth.uid() and s.active $$;

create function private.is_staff() returns boolean
language sql stable
set search_path = ''
as $$ select private.staff_role() is not null $$;

create function private.is_owner() returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(private.staff_role() = 'owner', false) $$;

create function private.require_staff() returns uuid
language plpgsql stable
set search_path = ''
as $$
declare sid uuid := private.staff_id();
begin
  if sid is null then raise exception 'not_authorized' using errcode = '42501'; end if;
  return sid;
end;
$$;

create function private.require_owner() returns uuid
language plpgsql stable
set search_path = ''
as $$
declare sid uuid := private.staff_id();
begin
  if sid is null or not private.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  return sid;
end;
$$;

-- ── Customers, conversations, requests ─────────────────────────────────────────────────

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text check (length(name) <= 80),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')),
  preferred_language text not null default 'en' check (preferred_language in ('en', 'ar')),
  preferred_contact text check (preferred_contact in ('whatsapp', 'call', 'email')),
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_has_contact check (phone_e164 is not null or email is not null)
);
create unique index customers_phone_key on public.customers (phone_e164, is_test);
comment on table public.customers is 'Private. Customer contact details (personal data).';

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 of the random token held by the customer's browser; every call must present the token.
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  locale text not null default 'en' check (locale in ('en', 'ar')),
  source text not null default 'widget' check (source in ('widget', 'page')),
  state jsonb not null default '{}' check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 24000),
  version integer not null default 0,
  last_client_msg_id text check (length(last_client_msg_id) <= 64),
  last_reply jsonb check (last_reply is null or octet_length(last_reply::text) <= 24000),
  message_count integer not null default 0,
  ai_calls integer not null default 0,
  customer_id uuid references public.customers (id) on delete set null,
  client_hash text check (length(client_hash) <= 128),
  is_test boolean not null default false,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index conversations_activity_idx on public.conversations (last_activity_at desc);

create table public.conversation_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('customer', 'assistant')),
  body text not null check (length(body) between 1 and 4000),
  locale text check (locale in ('en', 'ar')),
  meta jsonb not null default '{}' check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 4000),
  created_at timestamptz not null default now()
);
create index conversation_messages_conv_idx on public.conversation_messages (conversation_id, id);

create type public.request_type as enum ('sourcing', 'question', 'order_followup', 'callback');
create type public.request_status as enum ('new', 'in_progress', 'awaiting_approval', 'awaiting_customer', 'converted', 'closed');

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default private.new_reference('REQ'),
  customer_id uuid not null references public.customers (id) on delete restrict,
  conversation_id uuid references public.conversations (id) on delete set null,
  type public.request_type not null,
  status public.request_status not null default 'new',
  summary text not null check (length(btrim(summary)) between 1 and 2000),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8000),
  -- What the team must confirm before answering (price, availability, shipping terms, …).
  needs_review text check (needs_review in ('price', 'availability', 'shipping', 'authenticity', 'returns', 'order', 'other')),
  locale text not null check (locale in ('en', 'ar')),
  destination_country text check (destination_country ~ '^[A-Z]{2}$'),
  destination_label text check (length(destination_label) <= 120),
  contact_name text check (length(contact_name) <= 80),
  contact_phone text not null check (contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  contact_email text check (contact_email is null or (length(contact_email) <= 254 and contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')),
  contact_method text not null check (contact_method in ('whatsapp', 'call', 'email')),
  -- Consent to be contacted about THIS request. Marketing consent is never inferred from it.
  contact_consent boolean not null check (contact_consent),
  consent_text text not null check (length(consent_text) between 10 and 600),
  consent_at timestamptz not null default now(),
  marketing_consent boolean not null default false,
  assigned_to uuid references public.staff_members (id) on delete set null,
  next_action text check (length(next_action) <= 300),
  follow_up_at timestamptz,
  source text not null check (source in ('widget', 'page')),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 100),
  client_hash text check (length(client_hash) <= 128),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint requests_email_contact check (contact_method <> 'email' or contact_email is not null)
);
create index requests_created_idx on public.requests (created_at desc);
create index requests_status_idx on public.requests (status, created_at desc);
create index requests_customer_idx on public.requests (customer_id);
create index requests_client_hash_idx on public.requests (client_hash, created_at desc);
comment on table public.requests is 'Private. Requests captured by the concierge chat. Personal data.';

-- Photos customers attach. Files live in the private Storage bucket "request-photos" at
-- <conversation id>/<photo id>.jpg, re-encoded by the server (metadata such as GPS removed).
create table public.request_photos (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  request_id uuid references public.requests (id) on delete set null,
  object_path text not null unique check (object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  status text not null default 'pending' check (status in ('pending', 'stored')),
  bytes integer check (bytes between 1 and 3000000),
  width integer check (width between 1 and 4000),
  height integer check (height between 1 and 4000),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  -- An upload slot is valid for a few minutes only.
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);
create index request_photos_conv_idx on public.request_photos (conversation_id);
create index request_photos_request_idx on public.request_photos (request_id);

create table public.request_notes (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests (id) on delete cascade,
  author_id uuid references public.staff_members (id) on delete set null,
  kind text not null check (kind in ('note', 'call')),
  outcome text check (outcome in ('reached', 'no_answer', 'left_message', 'wrong_number', 'call_back_later')),
  body text check (length(body) <= 2000),
  created_at timestamptz not null default now(),
  constraint request_notes_shape check (
    (kind = 'note' and length(btrim(coalesce(body, ''))) > 0) or (kind = 'call' and outcome is not null)
  )
);
create index request_notes_request_idx on public.request_notes (request_id, id);

-- Owner-confirmed price / availability for a request (the chat never quotes these itself).
create table public.price_approvals (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests (id) on delete cascade,
  item_description text not null check (length(btrim(item_description)) between 1 and 300),
  amount numeric(14, 2) check (amount > 0),
  currency text check (currency ~ '^[A-Z]{3}$'),
  availability text not null check (availability in ('available', 'unavailable', 'on_request', 'sourcing')),
  valid_until date,
  note text check (length(note) <= 600),
  approved_by uuid not null references public.staff_members (id),
  approved_at timestamptz not null default now(),
  constraint price_approvals_amount_currency check ((amount is null) = (currency is null))
);
create index price_approvals_request_idx on public.price_approvals (request_id, approved_at desc);

-- ── Orders (entered by the owner) ──────────────────────────────────────────────────────

create type public.order_status as enum ('open', 'completed', 'cancelled');
create type public.payment_status as enum ('unpaid', 'partially_paid', 'paid', 'refunded');
create type public.fulfilment_status as enum ('not_started', 'preparing', 'ready', 'shipped', 'delivered', 'collected', 'cancelled');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default private.new_reference('ORD'),
  customer_id uuid not null references public.customers (id) on delete restrict,
  request_id uuid references public.requests (id) on delete set null,
  status public.order_status not null default 'open',
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total_amount numeric(14, 2) not null check (total_amount > 0),
  amount_approved_by uuid not null references public.staff_members (id),
  amount_approved_at timestamptz not null default now(),
  payment_status public.payment_status not null default 'unpaid',
  fulfilment_status public.fulfilment_status not null default 'not_started',
  shipping_destination text check (length(shipping_destination) <= 160),
  carrier text check (length(carrier) <= 80),
  tracking_number text check (length(tracking_number) <= 80),
  tracking_url text check (length(tracking_url) <= 500 and tracking_url ~ '^https://[^\s]+$'),
  -- Where order-status verification codes are sent. Set by the team, never by the website.
  contact_email text check (contact_email is null or (length(contact_email) <= 254 and contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')),
  -- Shown to the verified customer. Never put internal notes here.
  customer_note text check (length(customer_note) <= 600),
  is_test boolean not null default false,
  created_by uuid references public.staff_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index orders_reference_upper_key on public.orders (upper(reference));
create index orders_customer_idx on public.orders (customer_id);

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  description text not null check (length(btrim(description)) between 1 and 300),
  brand text check (length(brand) <= 80),
  product_ref text check (product_ref ~ '^[A-Za-z0-9-]{2,40}$'),
  quantity integer not null default 1 check (quantity between 1 and 50),
  unit_amount numeric(14, 2) check (unit_amount > 0),
  position smallint not null default 0
);
create index order_items_order_idx on public.order_items (order_id, position, id);

create table public.order_access_challenges (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts smallint not null default 0,
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index order_access_challenges_idx on public.order_access_challenges (conversation_id, order_id, created_at desc);

-- ── Store knowledge (the only policy text the chat may quote) ─────────────────────────

create type public.knowledge_status as enum ('draft', 'approved', 'retired');

create table public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in ('shipping', 'returns', 'authenticity', 'warranty', 'payment', 'viewing', 'general')),
  -- NULL applies to every destination; otherwise an ISO country code such as AE.
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  locale text not null check (locale in ('en', 'ar')),
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null check (length(btrim(body)) between 1 and 2000),
  source text not null check (length(btrim(source)) between 1 and 300),
  source_url text check (length(source_url) <= 500 and source_url ~ '^https://[^\s]+$'),
  status public.knowledge_status not null default 'draft',
  approved_by uuid references public.staff_members (id) on delete set null,
  approved_at timestamptz,
  approval_note text check (length(approval_note) <= 300),
  -- After this date the chat stops quoting the entry and refers the question to the team.
  review_by date,
  created_by uuid references public.staff_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_approved_has_date check (status <> 'approved' or approved_at is not null)
);
create index knowledge_lookup_idx on public.knowledge_entries (topic, locale, status);

-- ── Notifications outbox and audit log ─────────────────────────────────────────────────

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'not_configured')),
  attempts smallint not null default 0,
  last_error text check (length(last_error) <= 500),
  provider_id text check (length(provider_id) <= 200),
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, channel)
);
create index notifications_status_idx on public.notifications (status, updated_at);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.staff_members (id) on delete set null,
  actor_label text not null check (length(actor_label) <= 120),
  action text not null check (length(action) <= 60),
  entity text not null check (length(entity) <= 40),
  entity_id text check (length(entity_id) <= 80),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);
create index audit_log_created_idx on public.audit_log (created_at desc);

create function private.audit(p_actor uuid, p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb) returns void
language sql volatile security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, actor_label, action, entity, entity_id, before, after)
  values (
    p_actor,
    coalesce((select coalesce(s.display_name, s.email) from public.staff_members s where s.id = p_actor), 'website concierge'),
    p_action, p_entity, p_entity_id, p_before, p_after
  );
$$;

-- Only the keys whose values differ, as {"key": [old, new]}-style before/after objects.
create function private.diff(p_before jsonb, p_after jsonb, out d_before jsonb, out d_after jsonb)
language sql immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, p_before -> k), '{}'), coalesce(jsonb_object_agg(k, p_after -> k), '{}')
  from (select key as k from jsonb_object_keys(p_after) as key where (p_before -> key) is distinct from (p_after -> key)) d
$$;

-- updated_at bookkeeping (public.set_updated_at() comes from the catalogue migration).
create trigger staff_members_set_updated_at before update on public.staff_members for each row execute function public.set_updated_at();
create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger requests_set_updated_at before update on public.requests for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger knowledge_set_updated_at before update on public.knowledge_entries for each row execute function public.set_updated_at();
create trigger notifications_set_updated_at before update on public.notifications for each row execute function public.set_updated_at();

-- ── Row-level security ──────────────────────────────────────────────────────────────────

alter table public.staff_members enable row level security;
alter table public.customers enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.requests enable row level security;
alter table public.request_photos enable row level security;
alter table public.request_notes enable row level security;
alter table public.price_approvals enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_access_challenges enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

revoke all on
  public.staff_members, public.customers, public.conversations, public.conversation_messages, public.requests,
  public.request_photos, public.request_notes, public.price_approvals, public.orders, public.order_items,
  public.order_access_challenges, public.knowledge_entries, public.notifications, public.audit_log
from anon, authenticated;

-- Staff read access (row-level security limits it to active team members). No direct writes.
grant select on
  public.customers, public.conversation_messages, public.requests, public.request_photos, public.request_notes,
  public.price_approvals, public.orders, public.order_items, public.knowledge_entries, public.notifications, public.audit_log
to authenticated;
-- Column-limited: team emails are for the owner (admin_list_staff); conversation tokens stay private.
grant select (id, display_name, role, active) on public.staff_members to authenticated;
grant select (id, locale, source, message_count, customer_id, is_test, started_at, last_activity_at) on public.conversations to authenticated;
-- The website reads approved knowledge with the public key.
grant select on public.knowledge_entries to anon;

create policy "Team can read the team list" on public.staff_members for select to authenticated using (private.is_staff());
create policy "Team can read customers" on public.customers for select to authenticated using (private.is_staff());
create policy "Team can read conversations" on public.conversations for select to authenticated using (private.is_staff());
create policy "Team can read messages" on public.conversation_messages for select to authenticated using (private.is_staff());
create policy "Team can read requests" on public.requests for select to authenticated using (private.is_staff());
create policy "Team can read photos" on public.request_photos for select to authenticated using (private.is_staff());
create policy "Team can read notes" on public.request_notes for select to authenticated using (private.is_staff());
create policy "Team can read approvals" on public.price_approvals for select to authenticated using (private.is_staff());
create policy "Team can read orders" on public.orders for select to authenticated using (private.is_staff());
create policy "Team can read order items" on public.order_items for select to authenticated using (private.is_staff());
create policy "Team can read notifications" on public.notifications for select to authenticated using (private.is_staff());
create policy "Owner can read the audit log" on public.audit_log for select to authenticated using (private.is_owner());
create policy "Approved knowledge is public; team sees all" on public.knowledge_entries for select to anon, authenticated
  using (status = 'approved' or private.is_staff());

-- ── Storage: private bucket for customer photos ────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-photos', 'request-photos', false, 3000000, array['image/jpeg'])
on conflict (id) do nothing;

-- An upload is accepted only into a slot the server opened moments earlier (unguessable name).
create function private.photo_slot_open(p_name text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.request_photos p
    where p.object_path = p_name and p.status = 'pending' and p.expires_at > now()
  )
$$;

create policy "Website uploads into an open photo slot" on storage.objects for insert to anon
  with check (bucket_id = 'request-photos' and private.photo_slot_open(name));
create policy "Team can view request photos" on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and private.is_staff());
create policy "Owner can delete request photos" on storage.objects for delete to authenticated
  using (bucket_id = 'request-photos' and private.is_owner());

-- ── Concierge functions (website server only: anon key + server key) ─────────────────

create function private.conversation_for(p_key text, p_conversation uuid, p_token_hash text) returns public.conversations
language plpgsql volatile security definer
set search_path = ''
as $$
declare c public.conversations;
begin
  perform private.assert_server_key(p_key);
  select * into c from public.conversations where id = p_conversation for update;
  if not found or c.token_hash <> p_token_hash then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;
  return c;
end;
$$;

create function public.concierge_start(p_key text, p_token_hash text, p_locale text, p_source text, p_client_hash text)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare new_id uuid;
begin
  perform private.assert_server_key(p_key);
  perform private.hit('conversation_start', p_client_hash, 30, interval '1 hour');
  perform private.hit('conversation_start_all', '*', 1500, interval '1 hour');
  insert into public.conversations (token_hash, locale, source, client_hash)
  values (p_token_hash, case when p_locale = 'ar' then 'ar' else 'en' end, case when p_source = 'page' then 'page' else 'widget' end, p_client_hash)
  returning id into new_id;
  return new_id;
end;
$$;

create function public.concierge_load(p_key text, p_conversation uuid, p_token_hash text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare c public.conversations;
begin
  c := private.conversation_for(p_key, p_conversation, p_token_hash);
  return jsonb_build_object(
    'id', c.id, 'locale', c.locale, 'state', c.state, 'version', c.version,
    'last_client_msg_id', c.last_client_msg_id, 'last_reply', c.last_reply,
    'last_activity_at', c.last_activity_at, 'ai_calls', c.ai_calls,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('role', m.role, 'body', m.body, 'meta', m.meta, 'at', m.created_at) order by m.id)
      from (select * from public.conversation_messages where conversation_id = c.id order by id desc limit 120) m
    ), '[]'::jsonb)
  );
end;
$$;

create function public.concierge_save(
  p_key text, p_conversation uuid, p_token_hash text, p_expected_version integer,
  p_state jsonb, p_locale text, p_messages jsonb, p_client_msg_id text, p_reply jsonb
) returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.conversations;
  m jsonb;
  added integer := coalesce(jsonb_array_length(p_messages), 0);
begin
  c := private.conversation_for(p_key, p_conversation, p_token_hash);
  if c.version <> p_expected_version then
    raise exception 'conflict' using errcode = 'P0001';
  end if;
  if c.message_count + added > 300 then
    raise exception 'conversation_too_long' using errcode = 'P0001';
  end if;
  perform private.hit('conversation_message', c.id::text, 150, interval '1 hour');
  for m in select * from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) loop
    insert into public.conversation_messages (conversation_id, role, body, locale, meta)
    values (c.id, m ->> 'role', left(m ->> 'body', 4000), case when m ->> 'locale' in ('en', 'ar') then m ->> 'locale' end, coalesce(m -> 'meta', '{}'));
  end loop;
  update public.conversations set
    state = p_state,
    locale = case when p_locale = 'ar' then 'ar' else 'en' end,
    version = version + 1,
    message_count = message_count + added,
    last_client_msg_id = p_client_msg_id,
    last_reply = p_reply,
    last_activity_at = now()
  where id = c.id;
  return c.version + 1;
end;
$$;

-- Creates (once per idempotency key) the customer, the request, its photo links and the
-- notification outbox rows, all in one transaction.
create function public.concierge_submit(p_key text, p_conversation uuid, p_token_hash text, p_request jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.conversations;
  r public.requests;
  idem text := p_request ->> 'idempotency_key';
  phone text := p_request ->> 'contact_phone';
  test boolean;
  cust uuid;
begin
  c := private.conversation_for(p_key, p_conversation, p_token_hash);
  if idem is null or left(idem, 37) <> c.id::text || ':' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into r from public.requests where idempotency_key = idem;
  if found then
    return jsonb_build_object('id', r.id, 'reference', r.reference, 'created', false);
  end if;

  perform private.hit('request_submit', coalesce(c.client_hash, c.id::text), 6, interval '1 hour');
  perform private.hit('request_submit_all', '*', 300, interval '1 hour');

  -- Numbers in the UK Ofcom drama range (+44 7700 900000–900999) are never assigned to real
  -- people; requests using them are automated tests and are kept out of statistics.
  test := phone ~ '^\+447700900[0-9]{3}$';

  insert into public.customers (name, phone_e164, email, preferred_language, preferred_contact, country_code, is_test)
  values (
    nullif(btrim(p_request ->> 'contact_name'), ''), phone, nullif(lower(btrim(p_request ->> 'contact_email')), ''),
    p_request ->> 'locale', p_request ->> 'contact_method', p_request ->> 'destination_country', test
  )
  on conflict (phone_e164, is_test) do update set
    name = coalesce(public.customers.name, excluded.name),
    email = coalesce(public.customers.email, excluded.email),
    preferred_language = excluded.preferred_language,
    preferred_contact = excluded.preferred_contact,
    country_code = coalesce(excluded.country_code, public.customers.country_code)
  returning id into cust;

  insert into public.requests (
    customer_id, conversation_id, type, summary, details, needs_review, locale, destination_country, destination_label,
    contact_name, contact_phone, contact_email, contact_method, contact_consent, consent_text, source,
    idempotency_key, client_hash, is_test
  ) values (
    cust, c.id, (p_request ->> 'type')::public.request_type, p_request ->> 'summary', coalesce(p_request -> 'details', '{}'),
    nullif(p_request ->> 'needs_review', ''), p_request ->> 'locale', nullif(p_request ->> 'destination_country', ''),
    nullif(p_request ->> 'destination_label', ''), nullif(btrim(p_request ->> 'contact_name'), ''), phone,
    nullif(lower(btrim(p_request ->> 'contact_email')), ''), p_request ->> 'contact_method',
    coalesce((p_request ->> 'contact_consent')::boolean, false), p_request ->> 'consent_text', c.source,
    idem, c.client_hash, test
  ) returning * into r;

  update public.request_photos set request_id = r.id
  where conversation_id = c.id and status = 'stored' and request_id is null;
  update public.conversations set customer_id = cust, is_test = test where id = c.id;

  insert into public.notifications (request_id, channel) values (r.id, 'email'), (r.id, 'whatsapp');
  perform private.audit(null, 'request.created', 'request', r.id::text, null,
    jsonb_build_object('reference', r.reference, 'type', r.type, 'is_test', r.is_test));

  return jsonb_build_object('id', r.id, 'reference', r.reference, 'created', true);
end;
$$;

create function public.concierge_photo_slot(p_key text, p_conversation uuid, p_token_hash text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.conversations;
  slot uuid := gen_random_uuid();
  path text;
begin
  c := private.conversation_for(p_key, p_conversation, p_token_hash);
  if (select count(*) from public.request_photos
      where conversation_id = c.id and (status = 'stored' or expires_at > now())) >= 3 then
    raise exception 'photo_limit' using errcode = 'P0001';
  end if;
  perform private.hit('photo_upload', coalesce(c.client_hash, c.id::text), 12, interval '1 hour');
  perform private.hit('photo_upload_all', '*', 400, interval '1 hour');
  path := c.id::text || '/' || slot::text || '.jpg';
  insert into public.request_photos (id, conversation_id, object_path) values (slot, c.id, path);
  return path;
end;
$$;

create function public.concierge_photo_stored(
  p_key text, p_conversation uuid, p_token_hash text, p_path text, p_bytes integer, p_width integer, p_height integer, p_sha256 text
) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.conversations;
  pid uuid;
begin
  c := private.conversation_for(p_key, p_conversation, p_token_hash);
  if not exists (select 1 from storage.objects o where o.bucket_id = 'request-photos' and o.name = p_path) then
    raise exception 'photo_missing' using errcode = 'P0002';
  end if;
  update public.request_photos
  set status = 'stored', bytes = p_bytes, width = p_width, height = p_height, sha256 = p_sha256
  where conversation_id = c.id and object_path = p_path and status = 'pending'
  returning id into pid;
  if pid is null then raise exception 'photo_missing' using errcode = 'P0002'; end if;
  return pid;
end;
$$;

-- Starts an order-status check. Returns the email on file (to send the code to) or NULL; the
-- website answers the customer identically either way, so it never reveals whether an order exists.
create function public.concierge_order_challenge(p_key text, p_conversation uuid, p_token_hash text, p_order_ref text, p_code_hash text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.conversations;
  o public.orders;
begin
  c := private.conversation_for(p_key, p_conversation, p_token_hash);
  perform private.hit('order_challenge', c.id::text, 4, interval '1 hour');
  perform private.hit('order_challenge_client', coalesce(c.client_hash, c.id::text), 8, interval '1 hour');
  select * into o from public.orders
  where upper(reference) = upper(btrim(p_order_ref)) and status <> 'cancelled' and contact_email is not null;
  if not found then return null; end if;
  perform private.hit('order_challenge_order', o.id::text, 5, interval '1 hour');
  insert into public.order_access_challenges (order_id, conversation_id, code_hash) values (o.id, c.id, p_code_hash);
  return o.contact_email;
end;
$$;

create function public.concierge_order_verify(p_key text, p_conversation uuid, p_token_hash text, p_order_ref text, p_code_hash text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.conversations;
  ch public.order_access_challenges;
  o public.orders;
begin
  c := private.conversation_for(p_key, p_conversation, p_token_hash);
  select ch2.* into ch from public.order_access_challenges ch2
  join public.orders o2 on o2.id = ch2.order_id
  where ch2.conversation_id = c.id and upper(o2.reference) = upper(btrim(p_order_ref))
    and ch2.used_at is null and ch2.expires_at > now()
  order by ch2.created_at desc limit 1
  for update of ch2;
  if not found then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if ch.attempts >= 5 then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  if ch.code_hash <> p_code_hash then
    update public.order_access_challenges set attempts = attempts + 1 where id = ch.id;
    return jsonb_build_object('ok', false, 'reason', case when ch.attempts + 1 >= 5 then 'locked' else 'invalid' end, 'attempts_left', greatest(0, 4 - ch.attempts));
  end if;
  update public.order_access_challenges set used_at = now() where id = ch.id;
  select * into o from public.orders where id = ch.order_id;
  -- Only what the customer may see: no internal notes, no staff, no other customers.
  return jsonb_build_object('ok', true, 'order', jsonb_build_object(
    'reference', o.reference, 'status', o.status, 'currency', o.currency, 'total_amount', o.total_amount,
    'payment_status', o.payment_status, 'fulfilment_status', o.fulfilment_status, 'carrier', o.carrier,
    'tracking_number', o.tracking_number, 'tracking_url', o.tracking_url, 'customer_note', o.customer_note,
    'updated_at', o.updated_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'brand', i.brand, 'quantity', i.quantity) order by i.position, i.id)
                       from public.order_items i where i.order_id = o.id), '[]'::jsonb)
  ));
end;
$$;

-- Counts one AI call against the per-conversation and per-day caps; false when a cap is reached.
create function public.concierge_ai_allow(p_key text, p_conversation uuid, p_token_hash text, p_per_conversation integer, p_per_day integer)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.conversations;
  today integer;
begin
  c := private.conversation_for(p_key, p_conversation, p_token_hash);
  if c.ai_calls >= p_per_conversation then return false; end if;
  insert into private.ai_usage (day, calls) values (current_date, 0) on conflict (day) do nothing;
  select calls into today from private.ai_usage where day = current_date for update;
  if today >= p_per_day then return false; end if;
  update private.ai_usage set calls = calls + 1 where day = current_date;
  update public.conversations set ai_calls = ai_calls + 1 where id = c.id;
  return true;
end;
$$;

-- Server-side rate limit for other website endpoints (e.g. panel sign-in attempts).
create function public.concierge_rate_limit(p_key text, p_bucket text, p_subject text, p_max integer, p_window_seconds integer)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.assert_server_key(p_key);
  if p_bucket !~ '^[a-z_]{3,40}$' or p_max < 1 or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform private.hit('web_' || p_bucket, left(p_subject, 128), p_max, make_interval(secs => p_window_seconds));
end;
$$;

-- First-time panel setup is offered only to people the owner has added (no public sign-up).
create function public.concierge_staff_invited(p_key text, p_email text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.assert_server_key(p_key);
  return exists (select 1 from public.staff_members where email = lower(btrim(p_email)) and active and user_id is null);
end;
$$;

-- Claims notifications to send. Rows for channels that are not configured are marked as such;
-- they are picked up again once the channel is configured (within 7 days of the request).
create function public.concierge_claim_notifications(p_key text, p_configured text[], p_ids uuid[], p_limit integer)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare result jsonb;
begin
  perform private.assert_server_key(p_key);
  update public.notifications n set status = 'not_configured', last_error = null
  where n.status = 'pending' and not (n.channel = any (coalesce(p_configured, '{}')))
    and (p_ids is null or n.id = any (p_ids));

  with picked as (
    select n.id from public.notifications n
    where n.channel = any (coalesce(p_configured, '{}'))
      and (p_ids is null or n.id = any (p_ids))
      and n.created_at > now() - interval '7 days'
      and (
        n.status in ('pending', 'not_configured')
        or (n.status = 'failed' and n.attempts < 5 and n.claimed_at < now() - make_interval(mins => 2 * n.attempts))
        or (n.status = 'sending' and n.claimed_at < now() - interval '10 minutes')
      )
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 10), 1), 25)
    for update skip locked
  ), claimed as (
    update public.notifications n set status = 'sending', attempts = n.attempts + 1, claimed_at = now()
    from picked where n.id = picked.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cl.id, 'channel', cl.channel, 'attempts', cl.attempts,
    'request', jsonb_build_object('id', r.id, 'reference', r.reference, 'type', r.type, 'locale', r.locale,
      'needs_review', r.needs_review, 'destination_label', r.destination_label, 'created_at', r.created_at, 'is_test', r.is_test)
  )), '[]'::jsonb) into result
  from claimed cl join public.requests r on r.id = cl.request_id;
  return result;
end;
$$;

create function public.concierge_finish_notification(p_key text, p_id uuid, p_status text, p_error text, p_provider_id text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.assert_server_key(p_key);
  if p_status not in ('sent', 'failed', 'not_configured') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  update public.notifications set
    status = p_status,
    last_error = case when p_status = 'sent' then null else left(p_error, 500) end,
    provider_id = left(p_provider_id, 200),
    sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id and status = 'sending';
end;
$$;

-- ── Panel functions (signed-in team members; role checked inside) ─────────────────────

-- Links the signed-in account to its team row on first sign-in (verified email must match) and
-- returns the caller's role, or NULL when the account has no access.
create function public.admin_session() returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  u record;
  s public.staff_members;
begin
  if auth.uid() is null then return null; end if;
  select * into s from public.staff_members where user_id = auth.uid();
  if not found then
    select id, lower(email) as email, email_confirmed_at into u from auth.users where id = auth.uid();
    if u.id is null or u.email_confirmed_at is null then return null; end if;
    update public.staff_members set user_id = u.id
    where email = u.email and user_id is null and active
    returning * into s;
    if s.id is null then return null; end if;
    perform private.audit(s.id, 'staff.linked', 'staff', s.id::text, null, jsonb_build_object('email', s.email));
  end if;
  if not s.active then return null; end if;
  return jsonb_build_object('staff_id', s.id, 'role', s.role, 'display_name', s.display_name, 'email', s.email);
end;
$$;

create function public.admin_list_staff() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_owner();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'email', s.email, 'display_name', s.display_name,
    'role', s.role, 'active', s.active, 'linked', s.user_id is not null, 'created_at', s.created_at) order by s.created_at)
    from public.staff_members s), '[]'::jsonb);
end;
$$;

create function public.admin_add_staff(p_email text, p_display_name text, p_role public.staff_role) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  new_id uuid;
begin
  insert into public.staff_members (email, display_name, role, created_by)
  values (lower(btrim(p_email)), nullif(btrim(p_display_name), ''), p_role, me)
  returning id into new_id;
  perform private.audit(me, 'staff.added', 'staff', new_id::text, null,
    jsonb_build_object('email', lower(btrim(p_email)), 'role', p_role, 'display_name', nullif(btrim(p_display_name), '')));
  return new_id;
end;
$$;

create function public.admin_update_staff(p_id uuid, p_changes jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.staff_members;
  new public.staff_members;
  d record;
begin
  if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('role', 'active', 'display_name')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into old from public.staff_members where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.staff_members set
    role = coalesce((p_changes ->> 'role')::public.staff_role, role),
    active = coalesce((p_changes ->> 'active')::boolean, active),
    display_name = case when p_changes ? 'display_name' then nullif(btrim(p_changes ->> 'display_name'), '') else display_name end
  where id = p_id returning * into new;
  if not exists (select 1 from public.staff_members where role = 'owner' and active) then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;
  select * into d from private.diff(
    jsonb_build_object('role', old.role, 'active', old.active, 'display_name', old.display_name),
    jsonb_build_object('role', new.role, 'active', new.active, 'display_name', new.display_name));
  perform private.audit(me, 'staff.updated', 'staff', p_id::text, d.d_before, d.d_after);
end;
$$;

-- Status, assignment and follow-up fields. Staff may not mark a request converted (that happens
-- when the owner records an order).
create function public.admin_update_request(p_id uuid, p_changes jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  owner boolean := private.is_owner();
  old public.requests;
  new public.requests;
  d record;
begin
  if exists (select 1 from jsonb_object_keys(p_changes) k
             where k not in ('status', 'assigned_to', 'next_action', 'follow_up_at', 'needs_review')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not owner and (p_changes ->> 'status' = 'converted' or p_changes ? 'needs_review') then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if p_changes ? 'assigned_to' and p_changes ->> 'assigned_to' is not null and not exists (
    select 1 from public.staff_members where id = (p_changes ->> 'assigned_to')::uuid and active) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into old from public.requests where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.requests set
    status = coalesce((p_changes ->> 'status')::public.request_status, status),
    assigned_to = case when p_changes ? 'assigned_to' then (p_changes ->> 'assigned_to')::uuid else assigned_to end,
    next_action = case when p_changes ? 'next_action' then nullif(btrim(p_changes ->> 'next_action'), '') else next_action end,
    follow_up_at = case when p_changes ? 'follow_up_at' then (p_changes ->> 'follow_up_at')::timestamptz else follow_up_at end,
    needs_review = case when p_changes ? 'needs_review' then nullif(p_changes ->> 'needs_review', '') else needs_review end
  where id = p_id returning * into new;
  select * into d from private.diff(
    jsonb_build_object('status', old.status, 'assigned_to', old.assigned_to, 'next_action', old.next_action, 'follow_up_at', old.follow_up_at, 'needs_review', old.needs_review),
    jsonb_build_object('status', new.status, 'assigned_to', new.assigned_to, 'next_action', new.next_action, 'follow_up_at', new.follow_up_at, 'needs_review', new.needs_review));
  if d.d_after <> '{}'::jsonb then
    perform private.audit(me, 'request.updated', 'request', p_id::text, d.d_before, d.d_after);
  end if;
end;
$$;

create function public.admin_add_note(p_request uuid, p_kind text, p_outcome text, p_body text) returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  nid bigint;
begin
  insert into public.request_notes (request_id, author_id, kind, outcome, body)
  values (p_request, me, p_kind, nullif(p_outcome, ''), nullif(btrim(p_body), ''))
  returning id into nid;
  perform private.audit(me, case when p_kind = 'call' then 'request.call_logged' else 'request.note_added' end,
    'request', p_request::text, null, jsonb_build_object('note_id', nid, 'outcome', nullif(p_outcome, '')));
  return nid;
end;
$$;

create function public.admin_record_price(
  p_request uuid, p_item text, p_amount numeric, p_currency text, p_availability text, p_valid_until date, p_note text
) returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  aid bigint;
begin
  insert into public.price_approvals (request_id, item_description, amount, currency, availability, valid_until, note, approved_by)
  values (p_request, btrim(p_item), p_amount, upper(nullif(btrim(p_currency), '')), p_availability, p_valid_until, nullif(btrim(p_note), ''), me)
  returning id into aid;
  perform private.audit(me, 'price.approved', 'request', p_request::text, null,
    jsonb_build_object('approval_id', aid, 'item', btrim(p_item), 'amount', p_amount, 'currency', upper(nullif(btrim(p_currency), '')),
      'availability', p_availability, 'valid_until', p_valid_until));
  return aid;
end;
$$;

create function public.admin_create_order(
  p_customer uuid, p_request uuid, p_currency text, p_total numeric, p_items jsonb,
  p_contact_email text, p_shipping_destination text, p_customer_note text
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  o public.orders;
  it jsonb;
  pos smallint := 0;
  test boolean := coalesce((select is_test from public.customers where id = p_customer), false);
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  insert into public.orders (customer_id, request_id, currency, total_amount, amount_approved_by, contact_email,
    shipping_destination, customer_note, is_test, created_by)
  values (p_customer, p_request, upper(btrim(p_currency)), p_total, me, nullif(lower(btrim(p_contact_email)), ''),
    nullif(btrim(p_shipping_destination), ''), nullif(btrim(p_customer_note), ''), test, me)
  returning * into o;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.order_items (order_id, description, brand, product_ref, quantity, unit_amount, position)
    values (o.id, btrim(it ->> 'description'), nullif(btrim(it ->> 'brand'), ''), nullif(btrim(it ->> 'product_ref'), ''),
      coalesce((it ->> 'quantity')::integer, 1), (nullif(it ->> 'unit_amount', ''))::numeric, pos);
    pos := pos + 1;
  end loop;
  if p_request is not null then
    update public.requests set status = 'converted' where id = p_request;
  end if;
  perform private.audit(me, 'order.created', 'order', o.id::text, null,
    jsonb_build_object('reference', o.reference, 'currency', o.currency, 'total_amount', o.total_amount, 'request_id', p_request));
  return jsonb_build_object('id', o.id, 'reference', o.reference);
end;
$$;

create function public.admin_update_order(p_id uuid, p_changes jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  owner boolean := private.is_owner();
  old public.orders;
  new public.orders;
  d record;
  staff_keys constant text[] := array['fulfilment_status', 'carrier', 'tracking_number', 'tracking_url', 'shipping_destination'];
  owner_keys constant text[] := array['status', 'payment_status', 'currency', 'total_amount', 'contact_email', 'customer_note'];
begin
  if exists (select 1 from jsonb_object_keys(p_changes) k where not (k = any (staff_keys || owner_keys))) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not owner and exists (select 1 from jsonb_object_keys(p_changes) k where k = any (owner_keys)) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  select * into old from public.orders where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.orders set
    fulfilment_status = coalesce((p_changes ->> 'fulfilment_status')::public.fulfilment_status, fulfilment_status),
    carrier = case when p_changes ? 'carrier' then nullif(btrim(p_changes ->> 'carrier'), '') else carrier end,
    tracking_number = case when p_changes ? 'tracking_number' then nullif(btrim(p_changes ->> 'tracking_number'), '') else tracking_number end,
    tracking_url = case when p_changes ? 'tracking_url' then nullif(btrim(p_changes ->> 'tracking_url'), '') else tracking_url end,
    shipping_destination = case when p_changes ? 'shipping_destination' then nullif(btrim(p_changes ->> 'shipping_destination'), '') else shipping_destination end,
    status = coalesce((p_changes ->> 'status')::public.order_status, status),
    payment_status = coalesce((p_changes ->> 'payment_status')::public.payment_status, payment_status),
    currency = coalesce(upper(nullif(btrim(p_changes ->> 'currency'), '')), currency),
    total_amount = coalesce((p_changes ->> 'total_amount')::numeric, total_amount),
    amount_approved_by = case when p_changes ? 'total_amount' or p_changes ? 'currency' then me else amount_approved_by end,
    amount_approved_at = case when p_changes ? 'total_amount' or p_changes ? 'currency' then now() else amount_approved_at end,
    contact_email = case when p_changes ? 'contact_email' then nullif(lower(btrim(p_changes ->> 'contact_email')), '') else contact_email end,
    customer_note = case when p_changes ? 'customer_note' then nullif(btrim(p_changes ->> 'customer_note'), '') else customer_note end
  where id = p_id returning * into new;
  select * into d from private.diff(
    to_jsonb(old) - 'updated_at' - 'amount_approved_at' - 'amount_approved_by',
    to_jsonb(new) - 'updated_at' - 'amount_approved_at' - 'amount_approved_by');
  if d.d_after <> '{}'::jsonb then
    perform private.audit(me, 'order.updated', 'order', p_id::text, d.d_before, d.d_after);
  end if;
end;
$$;

create function public.admin_update_customer(p_id uuid, p_changes jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.customers;
  new public.customers;
  d record;
begin
  if exists (select 1 from jsonb_object_keys(p_changes) k
             where k not in ('name', 'email', 'preferred_language', 'preferred_contact', 'country_code')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into old from public.customers where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.customers set
    name = case when p_changes ? 'name' then nullif(btrim(p_changes ->> 'name'), '') else name end,
    email = case when p_changes ? 'email' then nullif(lower(btrim(p_changes ->> 'email')), '') else email end,
    preferred_language = coalesce(p_changes ->> 'preferred_language', preferred_language),
    preferred_contact = case when p_changes ? 'preferred_contact' then nullif(p_changes ->> 'preferred_contact', '') else preferred_contact end,
    country_code = case when p_changes ? 'country_code' then nullif(upper(btrim(p_changes ->> 'country_code')), '') else country_code end
  where id = p_id returning * into new;
  select * into d from private.diff(to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
  if d.d_after <> '{}'::jsonb then
    perform private.audit(me, 'customer.updated', 'customer', p_id::text, d.d_before, d.d_after);
  end if;
end;
$$;

create function public.admin_save_knowledge(p_id uuid, p_fields jsonb) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.knowledge_entries;
  new public.knowledge_entries;
  d record;
begin
  if exists (select 1 from jsonb_object_keys(p_fields) k
             where k not in ('topic', 'country_code', 'locale', 'title', 'body', 'source', 'source_url', 'review_by')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.knowledge_entries (topic, country_code, locale, title, body, source, source_url, review_by, created_by)
    values (p_fields ->> 'topic', nullif(upper(btrim(p_fields ->> 'country_code')), ''), p_fields ->> 'locale',
      btrim(p_fields ->> 'title'), btrim(p_fields ->> 'body'), btrim(p_fields ->> 'source'),
      nullif(btrim(p_fields ->> 'source_url'), ''), (nullif(p_fields ->> 'review_by', ''))::date, me)
    returning * into new;
    perform private.audit(me, 'knowledge.created', 'knowledge', new.id::text, null, to_jsonb(new) - 'created_at' - 'updated_at');
    return new.id;
  end if;
  select * into old from public.knowledge_entries where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- Any edit sends the entry back to draft: the owner approves the new wording explicitly.
  update public.knowledge_entries set
    topic = coalesce(p_fields ->> 'topic', topic),
    country_code = case when p_fields ? 'country_code' then nullif(upper(btrim(p_fields ->> 'country_code')), '') else country_code end,
    locale = coalesce(p_fields ->> 'locale', locale),
    title = coalesce(btrim(p_fields ->> 'title'), title),
    body = coalesce(btrim(p_fields ->> 'body'), body),
    source = coalesce(btrim(p_fields ->> 'source'), source),
    source_url = case when p_fields ? 'source_url' then nullif(btrim(p_fields ->> 'source_url'), '') else source_url end,
    review_by = case when p_fields ? 'review_by' then (nullif(p_fields ->> 'review_by', ''))::date else review_by end,
    status = 'draft', approved_by = null, approved_at = null, approval_note = null
  where id = p_id returning * into new;
  select * into d from private.diff(to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
  perform private.audit(me, 'knowledge.updated', 'knowledge', p_id::text, d.d_before, d.d_after);
  return p_id;
end;
$$;

create function public.admin_set_knowledge_status(p_id uuid, p_status public.knowledge_status, p_note text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.knowledge_entries;
begin
  select * into old from public.knowledge_entries where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.knowledge_entries set
    status = p_status,
    approved_by = case when p_status = 'approved' then me else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approval_note = case when p_status = 'approved' then nullif(btrim(p_note), '') else approval_note end
  where id = p_id;
  perform private.audit(me, 'knowledge.' || p_status::text, 'knowledge', p_id::text,
    jsonb_build_object('status', old.status), jsonb_build_object('status', p_status, 'note', nullif(btrim(p_note), '')));
end;
$$;

create function public.admin_retry_notification(p_id uuid) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  n public.notifications;
begin
  update public.notifications set status = 'pending', last_error = null
  where id = p_id and status in ('failed', 'not_configured')
  returning * into n;
  if n.id is null then raise exception 'not_retryable' using errcode = 'P0001'; end if;
  perform private.audit(me, 'notification.retried', 'request', n.request_id::text, null, jsonb_build_object('channel', n.channel));
end;
$$;

-- Permanent deletion (e.g. spam, test data or a customer's erasure request). Returns the photo
-- paths so the server can remove the files from Storage.
create function public.admin_delete_request(p_id uuid) returns text[]
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  r public.requests;
  paths text[];
begin
  select * into r from public.requests where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.orders where request_id = p_id) then
    raise exception 'has_order' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(object_path), '{}') into paths from public.request_photos
  where request_id = p_id or (r.conversation_id is not null and conversation_id = r.conversation_id);
  delete from public.request_photos where request_id = p_id or (r.conversation_id is not null and conversation_id = r.conversation_id);
  delete from public.requests where id = p_id;
  if r.conversation_id is not null then
    delete from public.conversations c where c.id = r.conversation_id
      and not exists (select 1 from public.requests x where x.conversation_id = c.id);
  end if;
  delete from public.customers c where c.id = r.customer_id
    and not exists (select 1 from public.requests x where x.customer_id = c.id)
    and not exists (select 1 from public.orders o where o.customer_id = c.id);
  perform private.audit(me, 'request.deleted', 'request', p_id::text,
    jsonb_build_object('reference', r.reference, 'type', r.type, 'is_test', r.is_test), null);
  return paths;
end;
$$;

-- Owner-only bulk export. Logged.
create function public.admin_export(p_kind text, p_include_test boolean) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  result jsonb;
begin
  if p_kind = 'requests' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]') into result from (
      select r.reference, r.created_at, r.type, r.status, r.locale, r.summary, r.needs_review, r.destination_label,
             r.contact_name, r.contact_phone, r.contact_email, r.contact_method, r.next_action, r.follow_up_at,
             (select coalesce(s.display_name, s.email) from public.staff_members s where s.id = r.assigned_to) as assigned_to,
             r.is_test
      from public.requests r where p_include_test or not r.is_test) x;
  elsif p_kind = 'customers' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]') into result from (
      select c.created_at, c.name, c.phone_e164, c.email, c.preferred_language, c.preferred_contact, c.country_code,
             (select count(*) from public.requests r where r.customer_id = c.id) as requests,
             (select count(*) from public.orders o where o.customer_id = c.id) as orders, c.is_test
      from public.customers c where p_include_test or not c.is_test) x;
  elsif p_kind = 'orders' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]') into result from (
      select o.reference, o.created_at, o.status, o.currency, o.total_amount, o.payment_status, o.fulfilment_status,
             o.carrier, o.tracking_number, c.name as customer_name, c.phone_e164 as customer_phone, o.is_test
      from public.orders o join public.customers c on c.id = o.customer_id where p_include_test or not o.is_test) x;
  else
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform private.audit(me, 'data.exported', 'export', p_kind, null, jsonb_build_object('rows', jsonb_array_length(result), 'include_test', p_include_test));
  return result;
end;
$$;

-- Dashboard counts from real data (test records excluded).
create function public.admin_dashboard() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return jsonb_build_object(
    'new', (select count(*) from public.requests where status = 'new' and not is_test),
    'awaiting_approval', (select count(*) from public.requests where status = 'awaiting_approval' and not is_test),
    'needs_review', (select count(*) from public.requests where needs_review is not null and status not in ('converted', 'closed') and not is_test),
    'follow_ups_due', (select count(*) from public.requests where follow_up_at <= now() and status not in ('converted', 'closed') and not is_test),
    'open_orders', (select count(*) from public.orders where status = 'open' and not is_test),
    'last_7_days', (select count(*) from public.requests where created_at > now() - interval '7 days' and not is_test),
    'notifications_failed', (select count(*) from public.notifications n join public.requests r on r.id = n.request_id
                              where n.status = 'failed' and not r.is_test),
    'test_records', (select count(*) from public.requests where is_test)
  );
end;
$$;

-- Search and filter (runs with the caller's rights, so row-level security applies).
create function public.admin_list_requests(
  p_q text, p_status text, p_type text, p_assignee uuid, p_locale text, p_destination text,
  p_review boolean, p_include_test boolean, p_limit integer, p_offset integer
) returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with filtered as (
    select r.*, c.name as customer_name
    from public.requests r join public.customers c on c.id = r.customer_id
    where (p_include_test or not r.is_test)
      and (p_status is null or r.status::text = p_status)
      and (p_type is null or r.type::text = p_type)
      and (p_assignee is null or r.assigned_to = p_assignee)
      and (p_locale is null or r.locale = p_locale)
      and (p_destination is null or r.destination_country = p_destination)
      and (not coalesce(p_review, false) or r.needs_review is not null)
      and (coalesce(btrim(p_q), '') = '' or (
        r.reference ilike '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or r.summary ilike '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or coalesce(r.contact_name, '') ilike '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or (btrim(p_q) ~ '^[+0-9 ()-]{4,}$' and replace(r.contact_phone, '+', '') like '%' || regexp_replace(p_q, '[^0-9]', '', 'g') || '%')
        or coalesce(r.contact_email, '') ilike '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or coalesce(r.details ->> 'brand', '') ilike '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      ))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'reference', f.reference, 'type', f.type, 'status', f.status, 'summary', left(f.summary, 160),
      'needs_review', f.needs_review, 'locale', f.locale, 'destination_label', f.destination_label,
      'contact_name', coalesce(f.contact_name, f.customer_name), 'contact_phone', f.contact_phone,
      'assigned_to', f.assigned_to, 'follow_up_at', f.follow_up_at, 'created_at', f.created_at, 'is_test', f.is_test
    ) order by f.created_at desc) from (
      select * from filtered order by created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
    ) f), '[]'::jsonb)
  )
$$;

-- ── Function privileges: nothing is callable unless granted here ──────────────────────

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.sha256_hex(text), private.photo_slot_open(text) to anon, authenticated;
-- Used inside row-level security policies, which are also evaluated for the public role.
grant execute on function private.staff_id(), private.staff_role(), private.is_staff(), private.is_owner() to anon, authenticated;

revoke execute on function
  public.concierge_start(text, text, text, text, text),
  public.concierge_load(text, uuid, text),
  public.concierge_save(text, uuid, text, integer, jsonb, text, jsonb, text, jsonb),
  public.concierge_submit(text, uuid, text, jsonb),
  public.concierge_photo_slot(text, uuid, text),
  public.concierge_photo_stored(text, uuid, text, text, integer, integer, integer, text),
  public.concierge_order_challenge(text, uuid, text, text, text),
  public.concierge_order_verify(text, uuid, text, text, text),
  public.concierge_ai_allow(text, uuid, text, integer, integer),
  public.concierge_rate_limit(text, text, text, integer, integer),
  public.concierge_staff_invited(text, text),
  public.concierge_claim_notifications(text, text[], uuid[], integer),
  public.concierge_finish_notification(text, uuid, text, text, text),
  public.admin_session(), public.admin_list_staff(), public.admin_add_staff(text, text, public.staff_role),
  public.admin_update_staff(uuid, jsonb), public.admin_update_request(uuid, jsonb),
  public.admin_add_note(uuid, text, text, text),
  public.admin_record_price(uuid, text, numeric, text, text, date, text),
  public.admin_create_order(uuid, uuid, text, numeric, jsonb, text, text, text),
  public.admin_update_order(uuid, jsonb), public.admin_update_customer(uuid, jsonb),
  public.admin_save_knowledge(uuid, jsonb), public.admin_set_knowledge_status(uuid, public.knowledge_status, text),
  public.admin_retry_notification(uuid), public.admin_delete_request(uuid), public.admin_export(text, boolean),
  public.admin_dashboard(),
  public.admin_list_requests(text, text, text, uuid, text, text, boolean, boolean, integer, integer)
from public, anon, authenticated;

-- The website server (anon key + server key checked inside each function).
grant execute on function
  public.concierge_start(text, text, text, text, text),
  public.concierge_load(text, uuid, text),
  public.concierge_save(text, uuid, text, integer, jsonb, text, jsonb, text, jsonb),
  public.concierge_submit(text, uuid, text, jsonb),
  public.concierge_photo_slot(text, uuid, text),
  public.concierge_photo_stored(text, uuid, text, text, integer, integer, integer, text),
  public.concierge_order_challenge(text, uuid, text, text, text),
  public.concierge_order_verify(text, uuid, text, text, text),
  public.concierge_ai_allow(text, uuid, text, integer, integer),
  public.concierge_rate_limit(text, text, text, integer, integer),
  public.concierge_staff_invited(text, text),
  public.concierge_claim_notifications(text, text[], uuid[], integer),
  public.concierge_finish_notification(text, uuid, text, text, text)
to anon;

-- Signed-in accounts (role checked inside each function).
grant execute on function
  public.admin_session(), public.admin_list_staff(), public.admin_add_staff(text, text, public.staff_role),
  public.admin_update_staff(uuid, jsonb), public.admin_update_request(uuid, jsonb),
  public.admin_add_note(uuid, text, text, text),
  public.admin_record_price(uuid, text, numeric, text, text, date, text),
  public.admin_create_order(uuid, uuid, text, numeric, jsonb, text, text, text),
  public.admin_update_order(uuid, jsonb), public.admin_update_customer(uuid, jsonb),
  public.admin_save_knowledge(uuid, jsonb), public.admin_set_knowledge_status(uuid, public.knowledge_status, text),
  public.admin_retry_notification(uuid), public.admin_delete_request(uuid), public.admin_export(text, boolean),
  public.admin_dashboard(),
  public.admin_list_requests(text, text, text, uuid, text, text, boolean, boolean, integer, integer)
to authenticated;

-- ── Seed: the website's currently published notices, quoted verbatim by the chat ─────
-- Source: src/content/policies.ts as published on https://www.sevnhevn.ae (interim notices).
-- English only: Arabic wording must be approved by the owner in the panel before the chat
-- quotes it in Arabic.
insert into public.knowledge_entries (topic, locale, title, body, source, source_url, status, approved_at, approval_note) values
  ('shipping', 'en', 'Shipping & delivery (interim notice)',
   'Our delivery policy is being finalised and will be published here. Until then, no online orders are taken. For any piece, delivery options, timing and any costs are confirmed with you personally — on WhatsApp, by phone or by email — before you agree to a purchase. We do not promise immediate or worldwide delivery for every piece.',
   'Website notice "Shipping & delivery" (interim), word for word', 'https://www.sevnhevn.ae/#shipping', 'approved', now(),
   'Published on the website as of 6 Oct 2026. Replace when the final policy is approved.'),
  ('returns', 'en', 'Returns & refunds (interim notice)',
   'Our returns and refunds policy is being finalised and will be published here before online purchases open. For any piece you are considering, please ask us about return eligibility before purchase — the terms that apply will be confirmed to you in writing.',
   'Website notice "Returns & refunds" (interim), word for word', 'https://www.sevnhevn.ae/#returns', 'approved', now(),
   'Published on the website as of 6 Oct 2026. Replace when the final policy is approved.'),
  ('authenticity', 'en', 'Independent reseller',
   'SEVN HEVN is an independent business. We are not affiliated with, authorised by or endorsed by any of the brands mentioned on this website. Brand names are used only to describe items and sourcing requests.',
   'Website reseller statement (footer), word for word', 'https://www.sevnhevn.ae/', 'approved', now(),
   'Published on the website as of 6 Oct 2026. Questions about a specific piece are passed to the team.'),
  ('general', 'en', 'Editorial images',
   'Images marked “Editorial preview” are AI-generated mood imagery. They are not items for sale and do not represent a specific piece, its condition or its availability.',
   'Website notice "Terms" (interim), word for word', 'https://www.sevnhevn.ae/#terms', 'approved', now(),
   'Published on the website as of 6 Oct 2026.');
