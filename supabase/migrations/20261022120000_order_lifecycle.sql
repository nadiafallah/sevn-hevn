-- SEVN HEVN: the order lifecycle (Oct 2026). Quotes, payment, stock holds, sourcing, quality checks,
-- dispatch, delivery, cancellation, returns and refunds, all on one order record.
--
-- * One record per order (public.orders), from the first quote to completion. Order, payment,
--   delivery and return status are kept apart. Every change is written to public.order_events with
--   the time, who or what made it, and the reason.
-- * Payment status is never typed in. It is worked out from public.payments and public.refunds. A
--   hosted-checkout payment counts only after a verified provider event. A bank transfer or cash
--   payment counts only when the owner records that the funds are in the account (a receipt image
--   is not enough).
-- * Each provider event is stored once per event ID, so duplicates and retries change nothing. An
--   event that doesn't match what we expect is kept as a discrepancy for the team. It is never
--   applied silently.
-- * The last unit can't be sold twice: checkout holds stock under a row lock, and the hold expires.
--   A payment that arrives after the hold expired is still recorded. If the piece has gone in the
--   meantime, the order waits for the owner instead of confirming.
-- * Shipped means a carrier scan or a signed handover. Delivered means the carrier's proof of
--   delivery, or an exception the owner documents. A label alone is neither.
-- * Returns are decided by the owner, and nothing is restocked before inspection. A refund is a
--   financial transaction against the original payment. It counts only when the provider (or, for a
--   manual refund, the owner) confirms it, and it can never exceed what is left to refund.
-- * Owner only: prices and totals, payments, refunds, return decisions, cancellations, shop settings,
--   shipping zones and policies. Staff: sourcing, quality checks, packing, shipments, delivery
--   updates, return logistics and inspection, notes, customer messages and customer links.
-- * Customers see an order only through a private link (a random token whose hash is stored here).
--   An order number alone shows nothing.
--
-- Requires 20261013120000_shop_four_categories.sql.
-- Rollback: supabase/rollbacks/20261022120000_order_lifecycle.down.sql

-- ── Shop settings (one row, owner-set) ────────────────────────────────────────────────

create table public.shop_settings (
  id boolean primary key default true check (id),
  -- How long checkout (or a sent quote, at most) holds the last units while the customer pays.
  reservation_minutes integer not null default 30 check (reservation_minutes between 15 and 1440),
  -- How long a quote can be accepted, unless the owner sets another expiry on the quote.
  quote_valid_hours integer not null default 72 check (quote_valid_hours between 1 and 720),
  -- VAT. Left empty until the owner (with the accountant) confirms it. Online payment stays off
  -- until the rate and whether listed prices include VAT are set.
  vat_trn text check (vat_trn ~ '^[0-9]{15}$'),
  vat_rate_percent numeric(5, 2) check (vat_rate_percent between 0 and 100),
  prices_include_vat boolean,
  -- Change-of-mind returns of in-stock pieces: days after delivery. Empty: not offered yet. Returns
  -- for faulty, damaged, wrong, misdescribed or inauthentic pieces can always be requested.
  change_of_mind_days integer check (change_of_mind_days between 1 and 365),
  -- Internal alerts, never promises to customers.
  dispatch_alert_days integer not null default 2 check (dispatch_alert_days between 1 and 60),
  supplier_alert_days integer not null default 3 check (supplier_alert_days between 1 and 60),
  -- Customer e-mails about orders go out only once the owner has approved their wording.
  customer_emails_enabled boolean not null default false,
  updated_by uuid references public.staff_members (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.shop_settings is 'Owner-set rules for checkout, quotes, VAT, returns and alerts. One row.';
insert into public.shop_settings default values;

-- ── Shipping zones (owner-set) ─────────────────────────────────────────────────────────

create table public.shipping_zones (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- Flat fee in AED for one parcel. Empty: quoted per order (no online payment to this zone).
  fee_aed numeric(10, 2) check (fee_aed >= 0),
  transit_days_min smallint check (transit_days_min between 0 and 90),
  transit_days_max smallint check (transit_days_max between 0 and 90),
  vat_treatment text not null default 'unknown' check (vat_treatment in ('standard', 'zero_rated', 'unknown')),
  -- Who pays import duties and taxes at the destination.
  duties_treatment text not null default 'unknown' check (duties_treatment in ('recipient_pays', 'included', 'not_applicable', 'unknown')),
  -- Shown to the customer at checkout, e.g. how duties are charged.
  duties_note text check (length(duties_note) <= 400),
  -- Internal: what the carrier confirmed about cover for high-value parcels to this zone.
  carrier_note text check (length(carrier_note) <= 600),
  active boolean not null default true,
  position smallint not null default 0,
  updated_at timestamptz not null default now(),
  constraint shipping_zones_transit check (transit_days_min is null or transit_days_max is null or transit_days_max >= transit_days_min)
);
create table public.shipping_zone_countries (
  country text primary key check (country ~ '^[A-Z]{2}$'),
  zone_id bigint not null references public.shipping_zones (id) on delete cascade
);
create index shipping_zone_countries_zone_idx on public.shipping_zone_countries (zone_id);

-- ── Policies (owner-approved versions) ─────────────────────────────────────────────────

create table public.policy_versions (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('terms_of_sale', 'returns', 'shipping', 'privacy')),
  version text not null check (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null check (length(btrim(body)) between 1 and 40000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  approved_by uuid references public.staff_members (id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.staff_members (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, version),
  constraint policy_versions_approved check (status = 'draft' or approved_at is not null)
);
create unique index policy_versions_one_approved on public.policy_versions (kind) where status = 'approved';
comment on table public.policy_versions is 'Policy texts. Only approved versions are public, and an order records the versions the customer accepted.';

-- ── Orders: separate status for order, payment and delivery ──────────────────────────
-- The first panel version had open / completed / cancelled and a payment status the owner typed
-- in. Existing rows are mapped across; nothing is deleted.

alter type public.order_status rename to order_status_v1;
alter type public.payment_status rename to payment_status_v1;
alter type public.fulfilment_status rename to fulfilment_status_v1;

create type public.order_status as enum ('draft', 'awaiting_confirmation', 'confirmed', 'processing', 'completed', 'cancelled');
create type public.payment_status as enum (
  'unpaid', 'pending', 'deposit_paid', 'paid', 'failed', 'partially_refunded', 'refund_pending', 'refunded', 'refund_failed');
create type public.fulfilment_status as enum (
  'not_started', 'awaiting_stock', 'sourcing', 'quality_check', 'packed', 'ready_to_dispatch', 'shipped', 'in_transit',
  'out_for_delivery', 'delivered', 'collected', 'delivery_exception', 'returned_to_sender');

alter table public.orders
  alter column status drop default,
  alter column payment_status drop default,
  alter column fulfilment_status drop default;
alter table public.orders
  alter column status type public.order_status
    using (case status::text when 'open' then 'confirmed' else status::text end)::public.order_status,
  alter column payment_status type public.payment_status
    using (case payment_status::text when 'partially_paid' then 'deposit_paid' else payment_status::text end)::public.payment_status,
  alter column fulfilment_status type public.fulfilment_status
    using (case fulfilment_status::text when 'preparing' then 'quality_check' when 'ready' then 'ready_to_dispatch'
           when 'cancelled' then 'not_started' else fulfilment_status::text end)::public.fulfilment_status;
alter table public.orders
  alter column status set default 'draft',
  alter column payment_status set default 'unpaid',
  alter column fulfilment_status set default 'not_started';

drop type public.order_status_v1;
drop type public.payment_status_v1;
drop type public.fulfilment_status_v1;

-- A quote can start without a total; it needs one before it is sent. Website orders take their
-- amounts from the catalogue, so no team member approved them.
alter table public.orders
  alter column total_amount drop not null,
  alter column amount_approved_by drop not null,
  alter column amount_approved_at drop not null,
  alter column amount_approved_at drop default;

alter table public.orders
  add column channel text not null default 'panel'
    check (channel in ('website', 'chat', 'whatsapp', 'instagram', 'phone', 'email', 'in_person', 'panel')),
  add column amount_source text not null default 'owner' check (amount_source in ('owner', 'catalogue')),
  add column assigned_to uuid references public.staff_members (id) on delete set null,
  add column subtotal_amount numeric(14, 2) check (subtotal_amount >= 0),
  add column discount_amount numeric(14, 2) not null default 0 check (discount_amount >= 0),
  add column shipping_amount numeric(14, 2) check (shipping_amount >= 0),
  add column vat_amount numeric(14, 2) check (vat_amount >= 0),
  add column vat_rate_percent numeric(5, 2) check (vat_rate_percent between 0 and 100),
  add column prices_include_vat boolean,
  add column vat_treatment text not null default 'unknown'
    check (vat_treatment in ('standard', 'zero_rated', 'not_applicable', 'unknown')),
  add column duties_treatment text not null default 'unknown'
    check (duties_treatment in ('recipient_pays', 'included', 'not_applicable', 'unknown')),
  add column duties_note text check (length(duties_note) <= 400),
  add column delivery_mode text not null default 'deliver' check (delivery_mode in ('deliver', 'collect')),
  add column shipping_country text check (shipping_country ~ '^[A-Z]{2}$'),
  add column shipping_address text check (length(shipping_address) <= 400),
  add column recipient_name text check (length(recipient_name) <= 80),
  add column recipient_phone text check (recipient_phone ~ '^\+[1-9][0-9]{6,14}$'),
  -- Sourcing time and transit time are kept apart.
  add column sourcing_eta date,
  add column transit_days_min smallint check (transit_days_min between 0 and 90),
  add column transit_days_max smallint check (transit_days_max between 0 and 90),
  add column delivery_estimate_from date,
  add column delivery_estimate_to date,
  add column delivery_estimate_note text check (length(delivery_estimate_note) <= 300),
  add column quote_sent_at timestamptz,
  add column quote_expires_at timestamptz,
  add column accepted_at timestamptz,
  -- Shown to the customer with the quote (what happens if they cancel, or the supplier can't deliver).
  add column cancellation_terms text check (length(cancellation_terms) <= 1000),
  add column amount_paid numeric(14, 2) not null default 0 check (amount_paid >= 0),
  add column amount_refunded numeric(14, 2) not null default 0 check (amount_refunded >= 0),
  add column confirmed_at timestamptz,
  add column completed_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancel_reason text check (length(cancel_reason) <= 600),
  add column idempotency_key text unique check (length(idempotency_key) between 8 and 100),
  add constraint orders_total_before_sending check (status = 'draft' or status = 'cancelled' or total_amount is not null),
  add constraint orders_estimate_order check (delivery_estimate_from is null or delivery_estimate_to is null or delivery_estimate_to >= delivery_estimate_from);
create index orders_status_idx on public.orders (status, created_at desc);

alter table public.order_items
  add column sku text check (sku ~ '^[A-Za-z0-9-]{2,48}$'),
  add column variant_id bigint references public.product_variants (id) on delete set null,
  add column options text check (length(options) <= 200),
  -- In stock: sold from our stock. On request: sourced after the customer has paid.
  add column availability text not null default 'in_stock' check (availability in ('in_stock', 'on_request')),
  add column condition text check (length(condition) <= 40),
  add column condition_notes text check (length(condition_notes) <= 500),
  add column included text[] not null default '{}',
  add column stage text not null default 'pending'
    check (stage in ('pending', 'sourcing', 'in_hand', 'qc_passed', 'qc_failed', 'shipped', 'delivered', 'collected', 'cancelled'));

-- ── Order history ─────────────────────────────────────────────────────────────────────

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]+(\.[a-z_]+)?$' and length(kind) <= 60),
  from_value text check (length(from_value) <= 80),
  to_value text check (length(to_value) <= 80),
  -- Why (internal).
  reason text check (length(reason) <= 1000),
  -- What the customer is told, if anything.
  public_note text check (length(public_note) <= 600),
  customer_visible boolean not null default false,
  actor text not null check (actor in ('owner', 'staff', 'customer', 'provider', 'system')),
  actor_id uuid references public.staff_members (id) on delete set null,
  meta jsonb not null default '{}' check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 4000),
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, id);

-- Who is acting and why, for every event written in the same transaction (triggers included).
create function private.act(p_actor text, p_reason text) returns void
language plpgsql volatile
set search_path = ''
as $$
begin
  if p_actor is not null then perform set_config('sevn.actor', p_actor, true); end if;
  perform set_config('sevn.reason', coalesce(left(p_reason, 1000), ''), true);
end;
$$;

-- For panel functions: the signed-in person's role becomes the actor.
create function private.act_team(p_reason text) returns void
language sql volatile
set search_path = ''
as $$ select private.act(case when private.is_owner() then 'owner' else 'staff' end, p_reason) $$;

create function private.order_event(
  p_order uuid, p_kind text, p_from text, p_to text, p_visible boolean, p_public_note text default null, p_meta jsonb default '{}'
) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  who text := coalesce(nullif(current_setting('sevn.actor', true), ''), 'system');
begin
  insert into public.order_events (order_id, kind, from_value, to_value, reason, public_note, customer_visible, actor, actor_id, meta)
  values (p_order, p_kind, left(p_from, 80), left(p_to, 80), nullif(current_setting('sevn.reason', true), ''),
    nullif(btrim(p_public_note), ''), p_visible, who,
    case when who in ('owner', 'staff') then private.staff_id() end, coalesce(p_meta, '{}'));
end;
$$;

-- Allowed order transitions, plus the bookkeeping that goes with them.
create function private.orders_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('awaiting_confirmation', 'cancelled'))
      or (old.status = 'awaiting_confirmation' and new.status in ('draft', 'confirmed', 'cancelled'))
      or (old.status = 'confirmed' and new.status in ('processing', 'completed', 'cancelled'))
      or (old.status = 'processing' and new.status in ('completed', 'cancelled'))
    ) then
      raise exception 'invalid_transition' using errcode = '22023', hint = old.status || ' → ' || new.status;
    end if;
    if new.status = 'cancelled' then
      if nullif(btrim(new.cancel_reason), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
      if exists (select 1 from public.shipments s where s.order_id = new.id and s.direction = 'outbound'
                 and s.status in ('handed_over', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned_to_sender', 'lost')) then
        raise exception 'already_dispatched' using errcode = '22023';
      end if;
      new.cancelled_at := now();
    elsif new.status = 'confirmed' then
      new.confirmed_at := coalesce(new.confirmed_at, now());
    elsif new.status = 'completed' then
      if new.fulfilment_status not in ('delivered', 'collected') then raise exception 'not_delivered' using errcode = '22023'; end if;
      new.completed_at := now();
    end if;
  end if;
  return new;
end;
$$;
create trigger orders_guard before update on public.orders for each row execute function private.orders_guard();

create function private.orders_history() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.order_event(new.id, 'order.created', null, new.status::text, false, null,
      jsonb_build_object('channel', new.channel, 'reference', new.reference));
    return null;
  end if;
  if new.status is distinct from old.status then
    perform private.order_event(new.id, 'order.status', old.status::text, new.status::text,
      new.status in ('awaiting_confirmation', 'confirmed', 'processing', 'completed', 'cancelled'),
      case when new.status = 'cancelled' then null end);
  end if;
  if new.payment_status is distinct from old.payment_status then
    perform private.order_event(new.id, 'payment.status', old.payment_status::text, new.payment_status::text, true);
  end if;
  if new.fulfilment_status is distinct from old.fulfilment_status then
    perform private.order_event(new.id, 'fulfilment.status', old.fulfilment_status::text, new.fulfilment_status::text, true);
  end if;
  return null;
end;
$$;
create trigger orders_history after insert or update on public.orders for each row execute function private.orders_history();

-- The policy versions the customer accepted for this order.
create table public.order_policy_acceptances (
  order_id uuid not null references public.orders (id) on delete cascade,
  policy_version_id bigint not null references public.policy_versions (id) on delete restrict,
  accepted_at timestamptz not null default now(),
  via text not null check (via in ('checkout', 'quote_link', 'team')),
  primary key (order_id, policy_version_id)
);

-- ── Payments ──────────────────────────────────────────────────────────────────────────

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default private.new_reference('PAY'),
  order_id uuid not null references public.orders (id) on delete restrict,
  method text not null check (method in ('hosted_checkout', 'bank_transfer', 'cash', 'card_terminal', 'other')),
  provider text check (provider ~ '^[a-z0-9_]{2,30}$'),
  provider_session_id text check (length(provider_session_id) <= 200),
  provider_payment_id text check (length(provider_payment_id) <= 200),
  -- Where the customer pays (the provider's hosted page), so a retry reopens the same payment.
  redirect_url text check (length(redirect_url) <= 2000 and redirect_url ~ '^https?://[^\s]+$'),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'created' check (status in ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'expired')),
  session_expires_at timestamptz,
  succeeded_at timestamptz,
  failure_reason text check (length(failure_reason) <= 300),
  -- Manual payments: what the owner checked, e.g. "Seen in the bank account on 22 Oct, ref …".
  verified_by uuid references public.staff_members (id) on delete set null,
  verification_note text check (length(verification_note) <= 600),
  recorded_by uuid references public.staff_members (id) on delete set null,
  idempotency_key text unique check (length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_hosted_provider check (method <> 'hosted_checkout' or provider is not null),
  constraint payments_manual_verified check (
    method = 'hosted_checkout' or status <> 'succeeded' or (verified_by is not null and nullif(btrim(verification_note), '') is not null))
);
create unique index payments_session_key on public.payments (provider, provider_session_id) where provider_session_id is not null;
create unique index payments_provider_payment_key on public.payments (provider, provider_payment_id) where provider_payment_id is not null;
create index payments_order_idx on public.payments (order_id, created_at);
comment on table public.payments is 'Private. Payments against orders. No card data is ever stored here.';

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default private.new_reference('RFD'),
  order_id uuid not null references public.orders (id) on delete restrict,
  payment_id uuid not null references public.payments (id) on delete restrict,
  return_id uuid,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- What the amount is made of. A deduction needs the owner's reason (agreed and lawful only).
  items_amount numeric(14, 2) not null default 0 check (items_amount >= 0),
  shipping_amount numeric(14, 2) not null default 0 check (shipping_amount >= 0),
  vat_amount numeric(14, 2) not null default 0 check (vat_amount >= 0),
  deduction_amount numeric(14, 2) not null default 0 check (deduction_amount >= 0),
  deduction_reason text check (length(deduction_reason) <= 600),
  reason text not null check (length(btrim(reason)) between 1 and 600),
  -- original_payment: back through the payment it came from. Anything else is an exception the
  -- owner documents.
  route text not null default 'original_payment' check (route in ('original_payment', 'bank_transfer', 'other')),
  exception_reason text check (length(exception_reason) <= 600),
  status text not null default 'approved' check (status in ('approved', 'pending', 'succeeded', 'failed', 'cancelled')),
  provider_refund_id text check (length(provider_refund_id) <= 200),
  failure_reason text check (length(failure_reason) <= 300),
  approved_by uuid not null references public.staff_members (id),
  approved_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.staff_members (id) on delete set null,
  confirmation_note text check (length(confirmation_note) <= 600),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refunds_adds_up check (amount = items_amount + shipping_amount + vat_amount - deduction_amount),
  constraint refunds_deduction_reason check (deduction_amount = 0 or nullif(btrim(deduction_reason), '') is not null),
  constraint refunds_exception_reason check (route = 'original_payment' or nullif(btrim(exception_reason), '') is not null)
);
create unique index refunds_provider_key on public.refunds (provider_refund_id) where provider_refund_id is not null;
create index refunds_order_idx on public.refunds (order_id, created_at);
comment on table public.refunds is 'Private. Refunds: financial transactions against a captured payment.';

-- Provider events, once per event ID. Normalised fields only, never a card number.
create table public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null check (provider ~ '^[a-z0-9_]{2,30}$'),
  event_id text not null check (length(event_id) between 1 and 200),
  type text not null check (length(type) <= 80),
  session_id text check (length(session_id) <= 200),
  payment_id uuid references public.payments (id) on delete set null,
  refund_id uuid references public.refunds (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  amount numeric(14, 2),
  currency text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  outcome text not null default 'ignored' check (outcome in ('applied', 'ignored', 'discrepancy')),
  detail text check (length(detail) <= 500),
  resolved_by uuid references public.staff_members (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (length(resolution_note) <= 600),
  unique (provider, event_id)
);
create index payment_events_open_idx on public.payment_events (received_at desc) where outcome = 'discrepancy' and resolved_at is null;

-- ── Stock holds ───────────────────────────────────────────────────────────────────────

create table public.stock_reservations (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  order_item_id bigint not null references public.order_items (id) on delete cascade,
  product_ref text not null references public.products (ref) on update cascade on delete restrict,
  variant_id bigint references public.product_variants (id) on delete restrict,
  quantity integer not null check (quantity between 1 and 50),
  -- An active hold past expires_at no longer counts (no job needed for that).
  status text not null default 'active' check (status in ('active', 'consumed', 'released')),
  expires_at timestamptz not null,
  released_reason text check (length(released_reason) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stock_reservations_live_idx on public.stock_reservations (product_ref, expires_at) where status = 'active';
create index stock_reservations_order_idx on public.stock_reservations (order_id);

-- True when this version keeps its own stock count (otherwise it shares the piece's).
create function private.own_stock(p_variant bigint) returns boolean
language sql stable
set search_path = ''
as $$ select coalesce((select v.stock is not null from public.product_variants v where v.id = p_variant), false) $$;

-- Units that can still be sold: stock minus live holds of other orders, from the same pool (the
-- version's own count, or the piece's shared count). Call it with the product row locked
-- (select … for update) so two checkouts can't both take the last unit.
create function private.free_stock(p_ref text, p_variant bigint, p_except_order uuid) returns integer
language sql stable
set search_path = ''
as $$
  select greatest(0,
    coalesce(case when private.own_stock(p_variant)
                  then (select v.stock from public.product_variants v where v.id = p_variant)
                  else (select p.stock from public.products p where p.ref = p_ref) end, 0)
    - coalesce((select sum(r.quantity) from public.stock_reservations r
                where r.product_ref = p_ref and r.status = 'active' and r.expires_at > now()
                  and r.order_id is distinct from p_except_order
                  and (case when private.own_stock(p_variant) then r.variant_id = p_variant
                            else not private.own_stock(r.variant_id) end)), 0))::integer
$$;

-- Holds the in-stock catalogue lines of an order until now + p_minutes (renews earlier holds).
create function private.reserve_stock(p_order uuid, p_minutes integer) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  it record;
  until timestamptz;
begin
  for it in
    select i.id, i.product_ref, i.variant_id, i.quantity from public.order_items i
    where i.order_id = p_order and i.availability = 'in_stock' and i.product_ref is not null
      and not exists (select 1 from public.stock_reservations r where r.order_item_id = i.id and r.status = 'consumed')
    order by i.product_ref, i.id
  loop
    -- Same lock order everywhere (by reference), so two checkouts never deadlock.
    perform 1 from public.products p where p.ref = it.product_ref and p.status = 'available' for update;
    if not found then raise exception 'not_for_sale' using errcode = '22023', hint = it.product_ref; end if;
    if private.free_stock(it.product_ref, it.variant_id, p_order) < it.quantity then
      raise exception 'insufficient_stock' using errcode = '22023', hint = it.product_ref;
    end if;
    until := greatest(now() + make_interval(mins => p_minutes),
      coalesce((select max(r.expires_at) from public.stock_reservations r where r.order_item_id = it.id and r.status = 'active'), now()));
    update public.stock_reservations set status = 'released', released_reason = 'renewed'
    where order_item_id = it.id and status = 'active';
    insert into public.stock_reservations (order_id, order_item_id, product_ref, variant_id, quantity, expires_at)
    values (p_order, it.id, it.product_ref, it.variant_id, it.quantity, until);
  end loop;
end;
$$;

create function private.release_stock(p_order uuid, p_reason text) returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.stock_reservations set status = 'released', released_reason = left(p_reason, 120)
  where order_id = p_order and status = 'active'
$$;

-- Takes the sold units out of stock for every in-stock catalogue line, all or nothing. A hold that
-- expired still works if the units are free. Returns false (and changes nothing) when a unit is gone.
create function private.consume_stock(p_order uuid) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  it record;
  held boolean;
  have integer;
begin
  begin
    for it in
      select i.id, i.product_ref, i.variant_id, i.quantity from public.order_items i
      where i.order_id = p_order and i.availability = 'in_stock' and i.product_ref is not null
        and not exists (select 1 from public.stock_reservations r where r.order_item_id = i.id and r.status = 'consumed')
      order by i.product_ref, i.id
    loop
      perform 1 from public.products p where p.ref = it.product_ref for update;
      held := exists (select 1 from public.stock_reservations r where r.order_item_id = it.id and r.status = 'active' and r.expires_at > now());
      have := case when private.own_stock(it.variant_id)
                   then (select v.stock from public.product_variants v where v.id = it.variant_id)
                   else (select p.stock from public.products p where p.ref = it.product_ref) end;
      if coalesce(have, 0) < it.quantity or (not held and private.free_stock(it.product_ref, it.variant_id, p_order) < it.quantity) then
        raise exception 'insufficient_stock';
      end if;
      if private.own_stock(it.variant_id) then
        update public.product_variants set stock = stock - it.quantity where id = it.variant_id;
      else
        update public.products set
          stock = stock - it.quantity,
          status = case when stock - it.quantity <= 0 and status = 'available' then 'sold'::public.item_status else status end
        where ref = it.product_ref;
      end if;
      update public.stock_reservations set status = 'released', released_reason = 'replaced'
      where order_item_id = it.id and status = 'active';
      insert into public.stock_reservations (order_id, order_item_id, product_ref, variant_id, quantity, status, expires_at)
      values (p_order, it.id, it.product_ref, it.variant_id, it.quantity, 'consumed', now());
      -- A piece whose versions all ran out is sold.
      update public.products p set status = 'sold'
      where p.ref = it.product_ref and p.status = 'available'
        and exists (select 1 from public.product_variants v where v.product_ref = p.ref)
        and not exists (select 1 from public.product_variants v where v.product_ref = p.ref and coalesce(v.stock, p.stock, 0) > 0);
    end loop;
  exception when raise_exception then
    if sqlerrm <> 'insufficient_stock' then raise; end if;
    return false;
  end;
  return true;
end;
$$;

-- Puts inspected, returned units back into the count they came from. The listing itself (sold,
-- available) is left for the owner to change in Products.
create function private.restock(p_item bigint, p_quantity integer) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare it public.order_items;
begin
  select * into it from public.order_items where id = p_item;
  if it.product_ref is null or not exists (select 1 from public.products where ref = it.product_ref) then return; end if;
  perform 1 from public.products p where p.ref = it.product_ref for update;
  if private.own_stock(it.variant_id) then
    update public.product_variants set stock = stock + p_quantity where id = it.variant_id;
  else
    update public.products set stock = coalesce(stock, 0) + p_quantity where ref = it.product_ref;
  end if;
end;
$$;

-- ── Sourcing, quality checks, evidence ────────────────────────────────────────────────

create table public.sourcing_tasks (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  order_item_id bigint not null references public.order_items (id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'supplier_contacted', 'supplier_confirmed', 'on_the_way', 'received', 'failed', 'cancelled')),
  assigned_to uuid references public.staff_members (id) on delete set null,
  -- Internal only: never shown to customers.
  supplier text check (length(supplier) <= 160),
  supplier_reference text check (length(supplier_reference) <= 120),
  -- When the supplier must have confirmed availability (an alert after this).
  confirm_by timestamptz,
  expected_at date,
  notes text check (length(notes) <= 2000),
  failure_reason text check (length(failure_reason) <= 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sourcing_failed_reason check (status <> 'failed' or nullif(btrim(failure_reason), '') is not null)
);
create unique index sourcing_tasks_live_item on public.sourcing_tasks (order_item_id) where status not in ('failed', 'cancelled');
create index sourcing_tasks_order_idx on public.sourcing_tasks (order_id);

-- A person checks every piece before it is packed: the serial or reference, the condition, the
-- accessories and the authenticity evidence. Photos are in order_evidence.
create table public.order_item_checks (
  id bigint generated always as identity primary key,
  order_item_id bigint not null references public.order_items (id) on delete cascade,
  result text not null check (result in ('passed', 'failed')),
  serial_reference text check (length(serial_reference) <= 120),
  -- Matches the documents, and the piece that was offered.
  serial_matches boolean,
  condition_confirmed boolean not null,
  condition_notes text check (length(condition_notes) <= 1000),
  accessories text[] not null default '{}',
  authenticity_notes text check (length(authenticity_notes) <= 2000),
  failure_reason text check (length(failure_reason) <= 600),
  checked_by uuid not null references public.staff_members (id),
  checked_at timestamptz not null default now(),
  constraint checks_passed check (result <> 'passed' or (condition_confirmed and serial_matches is distinct from false)),
  constraint checks_failed_reason check (result <> 'failed' or nullif(btrim(failure_reason), '') is not null)
);
create index order_item_checks_item_idx on public.order_item_checks (order_item_id, checked_at desc);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default private.new_reference('SHP'),
  order_id uuid not null references public.orders (id) on delete restrict,
  direction text not null default 'outbound' check (direction in ('outbound', 'return')),
  status text not null default 'preparing' check (status in (
    'preparing', 'label_created', 'handed_over', 'in_transit', 'out_for_delivery', 'delivered', 'exception',
    'returned_to_sender', 'lost', 'cancelled')),
  carrier text check (length(carrier) <= 80),
  service text check (length(service) <= 80),
  tracking_number text check (length(tracking_number) <= 80),
  tracking_url text check (length(tracking_url) <= 500 and tracking_url ~ '^https://[^\s]+$'),
  declared_value numeric(14, 2) check (declared_value >= 0),
  declared_currency text check (declared_currency ~ '^[A-Z]{3}$'),
  insurance text not null default 'unknown' check (insurance in ('carrier', 'third_party', 'none', 'unknown')),
  insurance_reference text check (length(insurance_reference) <= 120),
  -- The carrier confirmed cover for this value and destination (not assumed from standard terms).
  coverage_confirmed boolean not null default false,
  coverage_note text check (length(coverage_note) <= 600),
  delivery_requirements text check (length(delivery_requirements) <= 300),
  packed_contents text check (length(packed_contents) <= 1000),
  packed_by uuid references public.staff_members (id) on delete set null,
  packed_at timestamptz,
  handed_over_at timestamptz,
  handover_evidence text check (handover_evidence in ('carrier_scan', 'signed_handover')),
  delivered_at timestamptz,
  delivery_evidence text check (delivery_evidence in ('carrier_proof', 'owner_exception')),
  delivery_note text check (length(delivery_note) <= 600),
  exception_kind text check (exception_kind in ('delay', 'failed_attempt', 'address_issue', 'customs', 'damaged', 'lost', 'other')),
  exception_note text check (length(exception_note) <= 600),
  created_by uuid references public.staff_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_handover check (
    status in ('preparing', 'label_created', 'cancelled')
    or (handed_over_at is not null and handover_evidence is not null and carrier is not null and tracking_number is not null)),
  constraint shipments_delivered check (
    status <> 'delivered'
    or (delivered_at is not null and delivery_evidence is not null and nullif(btrim(delivery_note), '') is not null)),
  constraint shipments_exception check (status not in ('exception', 'lost') or exception_kind is not null)
);
create index shipments_order_idx on public.shipments (order_id, created_at);

create table public.shipment_items (
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  order_item_id bigint not null references public.order_items (id) on delete cascade,
  quantity integer not null default 1 check (quantity between 1 and 50),
  primary key (shipment_id, order_item_id)
);

create type public.return_status as enum (
  'requested', 'under_review', 'approved', 'rejected', 'awaiting_collection', 'in_transit', 'received', 'inspected', 'resolved');

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default private.new_reference('RET'),
  order_id uuid not null references public.orders (id) on delete restrict,
  status public.return_status not null default 'requested',
  reason text not null check (reason in (
    'change_of_mind', 'defective', 'damaged_in_transit', 'not_authentic', 'wrong_item', 'not_as_described', 'other')),
  description text check (length(description) <= 2000),
  requested_by text not null check (requested_by in ('customer', 'team')),
  -- What the policy check found when the request came in. Advice for the owner, not a decision.
  eligibility jsonb not null default '{}' check (jsonb_typeof(eligibility) = 'object'),
  decided_by uuid references public.staff_members (id) on delete set null,
  decided_at timestamptz,
  -- Required for a rejection, with the way to escalate it. Both are shown to the customer.
  decision_reason text check (length(decision_reason) <= 1000),
  support_path text check (length(support_path) <= 600),
  collection_method text check (collection_method in ('courier_collection', 'prepaid_label', 'customer_drop_off', 'customer_sends')),
  return_shipment_id uuid references public.shipments (id) on delete set null,
  return_cost numeric(14, 2) check (return_cost >= 0),
  return_cost_paid_by text check (return_cost_paid_by in ('shop', 'customer')),
  received_at timestamptz,
  received_by uuid references public.staff_members (id) on delete set null,
  inspection_result text check (inspection_result in ('as_described', 'damaged', 'not_the_item_sold', 'incomplete', 'other')),
  -- The serial or reference matches the piece that was sold.
  identity_matches boolean,
  inspection_notes text check (length(inspection_notes) <= 2000),
  inspected_by uuid references public.staff_members (id) on delete set null,
  inspected_at timestamptz,
  resolution text check (resolution in ('refund', 'replacement', 'repair', 'returned_to_customer')),
  resolution_note text check (length(resolution_note) <= 1000),
  replacement_order_id uuid references public.orders (id) on delete set null,
  resolved_at timestamptz,
  restocked_at timestamptz,
  restocked_by uuid references public.staff_members (id) on delete set null,
  idempotency_key text unique check (length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint returns_rejection check (
    status <> 'rejected' or (nullif(btrim(decision_reason), '') is not null and nullif(btrim(support_path), '') is not null))
);
create index returns_order_idx on public.returns (order_id, created_at);
create index returns_status_idx on public.returns (status, created_at);

create table public.return_items (
  return_id uuid not null references public.returns (id) on delete cascade,
  order_item_id bigint not null references public.order_items (id) on delete restrict,
  quantity integer not null default 1 check (quantity between 1 and 50),
  primary key (return_id, order_item_id)
);

alter table public.refunds add constraint refunds_return_fk foreign key (return_id) references public.returns (id) on delete set null;

-- Photos and documents: product, serial, paperwork, condition, packing, handover, delivery, return,
-- inspection and payment proof. Files live in the private bucket "order-evidence" at
-- <order id>/<file id>.jpg (or .pdf). Team only; never public, never shown to other customers.
create table public.order_evidence (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  order_item_id bigint references public.order_items (id) on delete cascade,
  shipment_id uuid references public.shipments (id) on delete cascade,
  return_id uuid references public.returns (id) on delete cascade,
  kind text not null check (kind in (
    'product', 'serial', 'document', 'condition', 'packing', 'handover', 'delivery', 'return', 'inspection', 'payment')),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|pdf)$'),
  note text check (length(note) <= 300),
  uploaded_by uuid references public.staff_members (id) on delete set null,
  from_customer boolean not null default false,
  created_at timestamptz not null default now()
);
create index order_evidence_order_idx on public.order_evidence (order_id, created_at);

-- Messages between the customer (on their order page) and the team.
create table public.order_messages (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null default 'message' check (kind in ('message', 'cancellation_request')),
  from_customer boolean not null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  author_id uuid references public.staff_members (id) on delete set null,
  handled_by uuid references public.staff_members (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index order_messages_order_idx on public.order_messages (order_id, id);
create index order_messages_open_idx on public.order_messages (created_at) where from_customer and handled_at is null;

-- Private links that let a customer see one order. Only the SHA-256 hash of the token is stored.
create table public.order_access_links (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references public.staff_members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index order_access_links_order_idx on public.order_access_links (order_id);

-- ── Notifications: order and return messages as well as new requests ──────────────────

alter table public.notifications
  alter column request_id drop not null,
  add column order_id uuid references public.orders (id) on delete cascade,
  add column return_id uuid references public.returns (id) on delete cascade,
  add column template text not null default 'new_request' check (template ~ '^[a-z_]{3,40}$'),
  add column recipient text not null default 'team' check (recipient in ('team', 'customer')),
  add column dedupe_key text unique check (length(dedupe_key) <= 200),
  add constraint notifications_subject check (request_id is not null or order_id is not null),
  add constraint notifications_customer_email check (recipient = 'team' or channel = 'email');

-- Queues one message per channel, once per p_key (a retried call queues nothing new). Customer
-- messages are e-mail only, and only when the owner has switched them on and the order has an
-- e-mail address.
create function private.notify_order(p_order uuid, p_return uuid, p_template text, p_recipient text, p_key text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_recipient = 'customer' then
    if not coalesce((select customer_emails_enabled from public.shop_settings), false)
       or (select contact_email from public.orders where id = p_order) is null then
      return;
    end if;
    insert into public.notifications (order_id, return_id, channel, template, recipient, dedupe_key)
    values (p_order, p_return, 'email', p_template, 'customer', left(concat_ws(':', p_template, p_key, 'customer', 'email'), 200))
    on conflict (dedupe_key) do nothing;
  else
    insert into public.notifications (order_id, return_id, channel, template, recipient, dedupe_key)
    select p_order, p_return, ch, p_template, 'team', left(concat_ws(':', p_template, p_key, 'team', ch), 200)
    from unnest(array['email', 'whatsapp']) ch
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

-- ── History of payments, refunds, shipments and returns ──────────────────────────────

create function private.payments_history() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform private.order_event(new.order_id, 'payment.' || new.status, case when tg_op = 'UPDATE' then old.status end, new.status, false, null,
      jsonb_build_object('payment', new.reference, 'method', new.method, 'amount', new.amount, 'currency', new.currency));
  end if;
  return null;
end;
$$;
create trigger payments_history after insert or update on public.payments for each row execute function private.payments_history();

create function private.refunds_history() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform private.order_event(new.order_id, 'refund.' || new.status, case when tg_op = 'UPDATE' then old.status end, new.status,
      new.status in ('pending', 'succeeded'), null,
      jsonb_build_object('refund', new.reference, 'amount', new.amount, 'currency', new.currency));
  end if;
  return null;
end;
$$;
create trigger refunds_history after insert or update on public.refunds for each row execute function private.refunds_history();

create function private.shipments_history() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform private.order_event(new.order_id, 'shipment.' || new.status, case when tg_op = 'UPDATE' then old.status end, new.status,
      new.status in ('handed_over', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned_to_sender'), null,
      jsonb_build_object('shipment', new.reference, 'direction', new.direction, 'carrier', new.carrier));
  end if;
  return null;
end;
$$;
create trigger shipments_history after insert or update on public.shipments for each row execute function private.shipments_history();

-- Allowed return transitions.
create function private.returns_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'requested' and new.status in ('under_review', 'approved', 'rejected'))
    or (old.status = 'under_review' and new.status in ('approved', 'rejected'))
    or (old.status = 'rejected' and new.status = 'under_review')
    or (old.status = 'approved' and new.status in ('awaiting_collection', 'in_transit', 'received'))
    or (old.status = 'awaiting_collection' and new.status in ('in_transit', 'received'))
    or (old.status = 'in_transit' and new.status = 'received')
    or (old.status = 'received' and new.status = 'inspected')
    or (old.status = 'inspected' and new.status = 'resolved')
  ) then
    raise exception 'invalid_transition' using errcode = '22023', hint = old.status || ' → ' || new.status;
  end if;
  return new;
end;
$$;
create trigger returns_guard before update on public.returns for each row execute function private.returns_guard();

create function private.returns_history() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform private.order_event(new.order_id, 'return.' || new.status, case when tg_op = 'UPDATE' then old.status::text end, new.status::text,
      true, case when new.status = 'rejected' then new.decision_reason end,
      jsonb_build_object('return', new.reference, 'reason', new.reason));
  end if;
  return null;
end;
$$;
create trigger returns_history after insert or update on public.returns for each row execute function private.returns_history();

-- updated_at bookkeeping
create trigger shop_settings_set_updated_at before update on public.shop_settings for each row execute function public.set_updated_at();
create trigger shipping_zones_set_updated_at before update on public.shipping_zones for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger refunds_set_updated_at before update on public.refunds for each row execute function public.set_updated_at();
create trigger stock_reservations_set_updated_at before update on public.stock_reservations for each row execute function public.set_updated_at();
create trigger sourcing_tasks_set_updated_at before update on public.sourcing_tasks for each row execute function public.set_updated_at();
create trigger shipments_set_updated_at before update on public.shipments for each row execute function public.set_updated_at();
create trigger returns_set_updated_at before update on public.returns for each row execute function public.set_updated_at();

-- ── Money, delivery state, confirmation ──────────────────────────────────────────────

-- Totals from the lines, the discount, shipping and VAT. VAT is worked out from the order's rate,
-- never typed in: on top of the price, or contained in it when listed prices include VAT.
create function private.recompute_totals(p_order uuid) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  o public.orders;
  sub numeric;
  base numeric;
  vat numeric;
begin
  select * into o from public.orders where id = p_order for update;
  select case when count(*) = 0 or bool_or(unit_amount is null) then null else sum(quantity * unit_amount) end into sub
  from public.order_items where order_id = p_order and stage <> 'cancelled';
  base := sub - o.discount_amount + coalesce(o.shipping_amount, 0);
  if base is not null and base <= 0 then raise exception 'invalid_amounts' using errcode = '22023'; end if;
  vat := case
    when o.vat_treatment in ('zero_rated', 'not_applicable') then 0
    when o.vat_treatment = 'standard' and o.vat_rate_percent is not null and o.prices_include_vat is not null then
      case when o.prices_include_vat then round(base * o.vat_rate_percent / (100 + o.vat_rate_percent), 2)
           else round(base * o.vat_rate_percent / 100, 2) end
  end;
  update public.orders set
    subtotal_amount = sub,
    vat_amount = vat,
    total_amount = case when vat is null or o.prices_include_vat then base else base + vat end
  where id = p_order;
end;
$$;

-- Payment status from the payments and refunds themselves. A fully paid order that is waiting for
-- confirmation is confirmed here.
create function private.refresh_payment(p_order uuid) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  o public.orders;
  paid numeric;
  refunded numeric;
  next_status public.payment_status;
begin
  select * into o from public.orders where id = p_order for update;
  select coalesce(sum(amount), 0) into paid from public.payments where order_id = p_order and status = 'succeeded';
  select coalesce(sum(amount), 0) into refunded from public.refunds where order_id = p_order and status = 'succeeded';
  next_status := case
    when exists (select 1 from public.refunds where order_id = p_order and status in ('approved', 'pending')) then 'refund_pending'
    when (select status from public.refunds where order_id = p_order order by created_at desc limit 1) = 'failed' then 'refund_failed'
    when paid > 0 and refunded >= paid then 'refunded'
    when refunded > 0 then 'partially_refunded'
    when paid > 0 and paid >= coalesce(o.total_amount, 'infinity'::numeric) then 'paid'
    when paid > 0 then 'deposit_paid'
    when exists (select 1 from public.payments where order_id = p_order and status in ('created', 'pending')) then 'pending'
    when (select status from public.payments where order_id = p_order order by created_at desc limit 1) = 'failed' then 'failed'
    else 'unpaid'
  end::public.payment_status;
  update public.orders set amount_paid = paid, amount_refunded = refunded, payment_status = next_status where id = p_order;
  if o.status = 'awaiting_confirmation' and o.total_amount is not null and paid >= o.total_amount and refunded = 0 then
    perform private.confirm_order(p_order, 'Paid in full');
  end if;
end;
$$;

-- Confirms an order: takes in-stock units out of stock, opens sourcing for on-request pieces and
-- tells the customer and the team. When a unit has gone, nothing changes and the team is alerted.
create function private.confirm_order(p_order uuid, p_reason text) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  o public.orders;
  wait_days integer := (select supplier_alert_days from public.shop_settings);
begin
  select * into o from public.orders where id = p_order for update;
  if o.status <> 'awaiting_confirmation' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if not private.consume_stock(p_order) then
    perform private.order_event(p_order, 'stock.conflict', null, null, false, null,
      jsonb_build_object('note', 'A piece on this order is no longer in stock. Source it (change the line to on request) or cancel and refund.'));
    perform private.notify_order(p_order, null, 'stock_conflict', 'team', p_order::text);
    return false;
  end if;
  perform private.act(null, p_reason);
  update public.order_items set stage = case availability when 'on_request' then 'sourcing' else 'in_hand' end
  where order_id = p_order and stage = 'pending';
  insert into public.sourcing_tasks (order_id, order_item_id, confirm_by)
  select p_order, i.id, now() + make_interval(days => wait_days) from public.order_items i
  where i.order_id = p_order and i.availability = 'on_request' and i.stage = 'sourcing'
    and not exists (select 1 from public.sourcing_tasks t where t.order_item_id = i.id and t.status not in ('failed', 'cancelled'));
  update public.orders set
    status = 'confirmed',
    accepted_at = coalesce(accepted_at, now()),
    fulfilment_status = case when exists (select 1 from public.order_items i where i.order_id = p_order and i.stage = 'sourcing')
                             then 'sourcing'::public.fulfilment_status else 'quality_check'::public.fulfilment_status end
  where id = p_order;
  perform private.notify_order(p_order, null, 'order_confirmed', 'customer', p_order::text);
  perform private.notify_order(p_order, null, 'order_confirmed', 'team', p_order::text);
  return true;
end;
$$;

-- Delivery status from the shipments, once anything has left. Before that, the team sets the
-- stage (sourcing, quality check, packed, ready to dispatch).
create function private.refresh_fulfilment(p_order uuid) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  o public.orders;
  live integer;
  done integer;
  collected integer;
  next_status public.fulfilment_status;
begin
  select * into o from public.orders where id = p_order for update;
  select count(*), count(*) filter (where stage in ('delivered', 'collected')), count(*) filter (where stage = 'collected')
  into live, done, collected from public.order_items where order_id = p_order and stage <> 'cancelled';
  next_status := case
    when live > 0 and done = live and collected = live then 'collected'
    when live > 0 and done = live then 'delivered'
    when exists (select 1 from public.shipments s where s.order_id = p_order and s.direction = 'outbound' and s.status in ('exception', 'lost')) then 'delivery_exception'
    when exists (select 1 from public.shipments s where s.order_id = p_order and s.direction = 'outbound' and s.status = 'returned_to_sender') then 'returned_to_sender'
    when exists (select 1 from public.shipments s where s.order_id = p_order and s.direction = 'outbound' and s.status = 'out_for_delivery') then 'out_for_delivery'
    when exists (select 1 from public.shipments s where s.order_id = p_order and s.direction = 'outbound' and s.status = 'in_transit') then 'in_transit'
    when exists (select 1 from public.shipments s where s.order_id = p_order and s.direction = 'outbound' and s.status = 'handed_over') then 'shipped'
    else o.fulfilment_status
  end;
  update public.orders set fulfilment_status = next_status where id = p_order;
  if next_status in ('delivered', 'collected') and o.status in ('confirmed', 'processing') and o.payment_status = 'paid' then
    update public.orders set status = 'completed' where id = p_order;
  end if;
end;
$$;

-- The amounts a website bag costs, from the catalogue and the owner's settings (never from the
-- browser). Raises when online payment isn't possible yet, with the reason as the message.
create function private.price_bag(p_lines jsonb, p_mode text, p_country text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  s public.shop_settings;
  z public.shipping_zones;
  ln jsonb;
  p public.products;
  v public.product_variants;
  qty integer;
  unit numeric;
  lines jsonb := '[]';
  sub numeric := 0;
  ship numeric;
  base numeric;
  vat numeric;
  vat_mode text;
  duties text;
begin
  select * into s from public.shop_settings;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 20 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into p from public.products where upper(ref) = upper(ln ->> 'ref') and published and status = 'available';
    if not found then raise exception 'bag_changed' using errcode = '22023', hint = coalesce(ln ->> 'ref', ''); end if;
    v := null;
    if nullif(ln ->> 'sku', '') is not null then
      select * into v from public.product_variants where product_ref = p.ref and upper(sku) = upper(ln ->> 'sku');
      if not found then raise exception 'bag_changed' using errcode = '22023', hint = p.ref; end if;
    elsif exists (select 1 from public.product_variants where product_ref = p.ref) then
      raise exception 'bag_changed' using errcode = '22023', hint = p.ref;
    end if;
    qty := (ln ->> 'qty')::integer;
    unit := coalesce(v.price_aed, p.price_aed);
    if qty is null or qty < 1 or qty > p.max_per_order or unit is null then
      raise exception 'bag_changed' using errcode = '22023', hint = p.ref;
    end if;
    lines := lines || jsonb_build_object(
      'ref', p.ref, 'sku', v.sku, 'variant_id', v.id, 'brand', p.brand, 'name', p.name,
      'options', nullif(concat_ws(' · ', v.colour, v.size, v.hardware, v.material), ''),
      'condition', p.condition, 'included', to_jsonb(p.included), 'qty', qty, 'unit', unit, 'line', unit * qty);
    sub := sub + unit * qty;
  end loop;

  if p_mode = 'collect' then
    ship := 0; vat_mode := 'standard'; duties := 'not_applicable';
  else
    select z2.* into z from public.shipping_zones z2 join public.shipping_zone_countries c on c.zone_id = z2.id
    where c.country = p_country and z2.active;
    if not found then raise exception 'destination_unsupported' using errcode = '22023'; end if;
    if z.fee_aed is null then raise exception 'shipping_quote_needed' using errcode = '22023'; end if;
    if z.vat_treatment = 'unknown' then raise exception 'vat_unconfirmed' using errcode = '22023'; end if;
    if z.duties_treatment = 'unknown' then raise exception 'duties_unconfirmed' using errcode = '22023'; end if;
    ship := z.fee_aed; vat_mode := z.vat_treatment; duties := z.duties_treatment;
  end if;
  if vat_mode = 'standard' and (s.vat_rate_percent is null or s.prices_include_vat is null) then
    raise exception 'vat_unconfirmed' using errcode = '22023';
  end if;

  base := sub + ship;
  vat := case when vat_mode <> 'standard' then 0
              when s.prices_include_vat then round(base * s.vat_rate_percent / (100 + s.vat_rate_percent), 2)
              else round(base * s.vat_rate_percent / 100, 2) end;
  return jsonb_build_object(
    'lines', lines, 'currency', 'AED', 'subtotal', sub, 'shipping', ship, 'vat', vat,
    'vat_rate', case when vat_mode = 'standard' then s.vat_rate_percent end, 'vat_treatment', vat_mode,
    'prices_include_vat', s.prices_include_vat, 'duties_treatment', duties, 'duties_note', z.duties_note,
    'transit_days_min', z.transit_days_min, 'transit_days_max', z.transit_days_max,
    'total', case when vat_mode = 'standard' and not s.prices_include_vat then base + vat else base end);
end;
$$;

-- The approved policies a customer must accept before paying online.
create function private.required_policies() returns bigint[]
language sql stable
set search_path = ''
as $$ select array_agg(id order by kind) from public.policy_versions where status = 'approved' and kind in ('terms_of_sale', 'returns') $$;

-- ── The website (server key) ──────────────────────────────────────────────────────────

-- What the bag costs to pay online now, or why it can't be paid online yet.
create function public.shop_price_bag(p_key text, p_lines jsonb, p_mode text, p_country text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.assert_server_key(p_key);
  if coalesce(array_length(private.required_policies(), 1), 0) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'policies_unapproved');
  end if;
  return jsonb_build_object('ok', true, 'quote', private.price_bag(p_lines, p_mode, p_country));
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end;
$$;

-- Starts an online checkout: the customer, the order (waiting for payment), its lines, a stock hold,
-- the payment and the customer's private link, in one transaction. The same idempotency key
-- returns the same order. Only works once the owner has approved the terms and returns policy.
create function public.shop_start_checkout(p_key text, p_order jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  idem text := p_order ->> 'idempotency_key';
  phone text := p_order ->> 'contact_phone';
  hash text := nullif(p_order ->> 'client_hash', '');
  mode text := case when p_order ->> 'delivery_mode' = 'collect' then 'collect' else 'deliver' end;
  country text := upper(nullif(p_order ->> 'shipping_country', ''));
  minutes integer := (select reservation_minutes from public.shop_settings);
  q jsonb;
  ln jsonb;
  pos smallint := 0;
  cust uuid;
  o public.orders;
  pay public.payments;
  test boolean;
  policies bigint[] := private.required_policies();
begin
  perform private.assert_server_key(p_key);
  if idem is null or idem !~ '^checkout:[A-Za-z0-9-]{16,64}$' or coalesce(p_order ->> 'token_hash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_order ->> 'provider', '') !~ '^[a-z0-9_]{2,30}$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select * into o from public.orders where idempotency_key = idem;
  if found then
    select * into pay from public.payments where order_id = o.id order by created_at desc limit 1;
    return jsonb_build_object('order_id', o.id, 'reference', o.reference, 'created', false, 'status', o.status,
      'payment_id', pay.id, 'payment_status', pay.status, 'amount', pay.amount, 'currency', pay.currency,
      'session_id', pay.provider_session_id, 'redirect_url', pay.redirect_url, 'expires_at', pay.session_expires_at);
  end if;

  if coalesce(array_length(policies, 1), 0) < 2 then raise exception 'policies_unapproved' using errcode = '22023'; end if;
  perform private.hit('checkout_start', coalesce(hash, phone), 8, interval '1 hour');
  perform private.hit('checkout_start_all', '*', 300, interval '1 hour');
  q := private.price_bag(p_order -> 'lines', mode, country);

  test := phone ~ '^\+447700900[0-9]{3}$';
  insert into public.customers (name, phone_e164, email, preferred_language, preferred_contact, country_code, is_test)
  values (nullif(btrim(p_order ->> 'contact_name'), ''), phone, nullif(lower(btrim(p_order ->> 'contact_email')), ''),
    'en', p_order ->> 'contact_method', country, test)
  on conflict (phone_e164, is_test) do update set
    name = coalesce(public.customers.name, excluded.name),
    email = coalesce(public.customers.email, excluded.email),
    preferred_contact = excluded.preferred_contact,
    country_code = coalesce(excluded.country_code, public.customers.country_code)
  returning id into cust;

  perform private.act('customer', 'Website checkout');
  insert into public.orders (
    customer_id, channel, amount_source, status, currency, subtotal_amount, shipping_amount, vat_amount, vat_rate_percent,
    prices_include_vat, vat_treatment, duties_treatment, duties_note, total_amount, delivery_mode, shipping_country,
    shipping_address, shipping_destination, recipient_name, recipient_phone, transit_days_min, transit_days_max,
    contact_email, quote_sent_at, quote_expires_at, accepted_at, idempotency_key, is_test
  ) values (
    cust, 'website', 'catalogue', 'awaiting_confirmation', 'AED', (q ->> 'subtotal')::numeric, (q ->> 'shipping')::numeric,
    (q ->> 'vat')::numeric, (q ->> 'vat_rate')::numeric, (q ->> 'prices_include_vat')::boolean,
    case when mode = 'collect' then 'standard' else q ->> 'vat_treatment' end, q ->> 'duties_treatment', q ->> 'duties_note',
    (q ->> 'total')::numeric, mode, case when mode = 'deliver' then country end,
    case when mode = 'deliver' then left(nullif(btrim(p_order ->> 'shipping_address'), ''), 400) end,
    case when mode = 'deliver' then left(nullif(btrim(p_order ->> 'shipping_label'), ''), 160) else 'Collect in Dubai' end,
    nullif(btrim(p_order ->> 'contact_name'), ''), phone,
    (q ->> 'transit_days_min')::smallint, (q ->> 'transit_days_max')::smallint,
    nullif(lower(btrim(p_order ->> 'contact_email')), ''), now(), now() + make_interval(mins => minutes), now(), idem, test
  ) returning * into o;

  for ln in select * from jsonb_array_elements(q -> 'lines') loop
    insert into public.order_items (order_id, description, brand, product_ref, sku, variant_id, options, quantity, unit_amount,
      availability, condition, included, position)
    values (o.id, ln ->> 'name', ln ->> 'brand', ln ->> 'ref', ln ->> 'sku', (ln ->> 'variant_id')::bigint, ln ->> 'options',
      (ln ->> 'qty')::integer, (ln ->> 'unit')::numeric, 'in_stock', ln ->> 'condition',
      coalesce(array(select jsonb_array_elements_text(ln -> 'included')), '{}'), pos);
    pos := pos + 1;
  end loop;

  perform private.reserve_stock(o.id, minutes);
  insert into public.order_policy_acceptances (order_id, policy_version_id, via) select o.id, unnest(policies), 'checkout';
  insert into public.payments (order_id, method, provider, amount, currency, status, session_expires_at, idempotency_key)
  values (o.id, 'hosted_checkout', p_order ->> 'provider', o.total_amount, 'AED', 'created', o.quote_expires_at, idem)
  returning * into pay;
  insert into public.order_access_links (order_id, token_hash, expires_at) values (o.id, p_order ->> 'token_hash', now() + interval '400 days');
  perform private.refresh_payment(o.id);
  perform private.notify_order(o.id, null, 'checkout_started', 'team', o.id::text);

  return jsonb_build_object('order_id', o.id, 'reference', o.reference, 'created', true, 'status', 'awaiting_confirmation',
    'payment_id', pay.id, 'payment_status', pay.status, 'amount', pay.amount, 'currency', pay.currency,
    'session_id', null, 'expires_at', pay.session_expires_at, 'lines', q -> 'lines');
end;
$$;

-- The provider's hosted-checkout session for a payment (the browser is sent there next).
create function public.payments_session_created(p_key text, p_payment uuid, p_session text, p_redirect_url text, p_expires_at timestamptz) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.assert_server_key(p_key);
  perform private.act('system', 'Checkout session created');
  update public.payments set provider_session_id = p_session, redirect_url = p_redirect_url, status = 'pending',
    session_expires_at = least(coalesce(p_expires_at, session_expires_at), coalesce(session_expires_at, p_expires_at))
  where id = p_payment and status = 'created' and provider_session_id is null;
  if not found then raise exception 'invalid_request' using errcode = '22023'; end if;
end;
$$;

-- A verified provider event (the website checks the signature before calling this). Each event ID
-- is applied once. Returns what happened: applied, duplicate, ignored or discrepancy.
create function public.payments_apply_event(p_key text, p_event jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  ev public.payment_events;
  pay public.payments;
  rf public.refunds;
  o public.orders;
  kind text := p_event ->> 'type';
  amt numeric := (p_event ->> 'amount')::numeric;
  cur text := upper(p_event ->> 'currency');
  v_outcome text := 'applied';
  v_detail text;
  was text;
begin
  perform private.assert_server_key(p_key);
  if coalesce(p_event ->> 'provider', '') !~ '^[a-z0-9_]{2,30}$' or nullif(p_event ->> 'event_id', '') is null
     or kind not in ('payment_succeeded', 'payment_failed', 'session_expired', 'refund_succeeded', 'refund_failed') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  insert into public.payment_events (provider, event_id, type, session_id, amount, currency, occurred_at)
  values (p_event ->> 'provider', p_event ->> 'event_id', kind, p_event ->> 'session_id', amt, cur,
    coalesce((p_event ->> 'occurred_at')::timestamptz, now()))
  on conflict (provider, event_id) do nothing
  returning * into ev;
  if ev.id is null then return jsonb_build_object('outcome', 'duplicate'); end if;
  perform private.act('provider', left(p_event ->> 'provider' || ' ' || kind, 1000));

  if kind like 'payment_%' or kind = 'session_expired' then
    select * into pay from public.payments
    where provider = p_event ->> 'provider' and provider_session_id = p_event ->> 'session_id' for update;
    if not found then
      update public.payment_events set outcome = 'discrepancy', detail = 'No payment matches this checkout session.' where id = ev.id;
      return jsonb_build_object('outcome', 'discrepancy');
    end if;
    was := pay.status;
    if kind = 'payment_succeeded' then
      if pay.status = 'succeeded' then
        v_outcome := 'ignored'; v_detail := 'Already recorded as paid.';
      elsif amt is distinct from pay.amount or cur is distinct from pay.currency then
        v_outcome := 'discrepancy';
        v_detail := format('Paid %s %s, expected %s %s. Not applied: check the payment with the provider.', cur, amt, pay.currency, pay.amount);
      else
        update public.payments set status = 'succeeded', succeeded_at = ev.occurred_at,
          provider_payment_id = coalesce(nullif(p_event ->> 'payment_ref', ''), provider_payment_id), failure_reason = null
        where id = pay.id;
        perform private.refresh_payment(pay.order_id);
        select * into o from public.orders where id = pay.order_id;
        if was in ('expired', 'cancelled') then
          v_outcome := 'discrepancy'; v_detail := 'Paid after the checkout had expired. The payment is recorded.';
        end if;
        if o.status = 'awaiting_confirmation' then
          v_outcome := 'discrepancy';
          v_detail := concat_ws(' ', v_detail, 'The order could not be confirmed (a piece is no longer in stock, or the total is not covered).');
        end if;
      end if;
    elsif kind = 'payment_failed' then
      if pay.status in ('created', 'pending') then
        update public.payments set status = 'failed', failure_reason = left(p_event ->> 'failure_reason', 300) where id = pay.id;
        perform private.refresh_payment(pay.order_id);
      else
        v_outcome := 'ignored'; v_detail := 'Payment is ' || pay.status || '.';
      end if;
    else -- session_expired
      if pay.status in ('created', 'pending', 'failed') then
        update public.payments set status = 'expired' where id = pay.id;
        if coalesce((select quote_expires_at from public.orders where id = pay.order_id), now()) <= now() then
          perform private.release_stock(pay.order_id, 'payment_expired');
        end if;
        perform private.refresh_payment(pay.order_id);
      else
        v_outcome := 'ignored'; v_detail := 'Payment is ' || pay.status || '.';
      end if;
    end if;
    update public.payment_events set outcome = v_outcome, detail = v_detail, payment_id = pay.id, order_id = pay.order_id where id = ev.id;
    if v_outcome = 'discrepancy' then perform private.notify_order(pay.order_id, null, 'payment_discrepancy', 'team', ev.id::text); end if;
    return jsonb_build_object('outcome', v_outcome, 'order_id', pay.order_id);
  end if;

  -- Refund events
  select * into rf from public.refunds where provider_refund_id = p_event ->> 'refund_ref' for update;
  if not found then
    update public.payment_events set outcome = 'discrepancy', detail = 'No refund matches this provider refund.' where id = ev.id;
    return jsonb_build_object('outcome', 'discrepancy');
  end if;
  if kind = 'refund_succeeded' then
    if rf.status = 'succeeded' then
      v_outcome := 'ignored'; v_detail := 'Already recorded as refunded.';
    elsif amt is distinct from rf.amount or cur is distinct from rf.currency then
      v_outcome := 'discrepancy'; v_detail := format('Refunded %s %s, expected %s %s.', cur, amt, rf.currency, rf.amount);
    else
      update public.refunds set status = 'succeeded', confirmed_at = ev.occurred_at, failure_reason = null where id = rf.id;
      perform private.notify_order(rf.order_id, rf.return_id, 'refund_completed', 'customer', rf.id::text);
    end if;
  else -- refund_failed (can follow a success with some providers)
    if rf.status in ('approved', 'pending', 'succeeded') then
      if rf.status = 'succeeded' then v_outcome := 'discrepancy'; v_detail := 'The provider reported this refund as failed after it had succeeded.'; end if;
      update public.refunds set status = 'failed', failure_reason = left(p_event ->> 'failure_reason', 300) where id = rf.id;
      perform private.notify_order(rf.order_id, rf.return_id, 'refund_failed', 'team', rf.id::text || ':' || ev.id::text);
    else
      v_outcome := 'ignored'; v_detail := 'Refund is ' || rf.status || '.';
    end if;
  end if;
  perform private.refresh_payment(rf.order_id);
  update public.payment_events set outcome = v_outcome, detail = v_detail, refund_id = rf.id, payment_id = rf.payment_id, order_id = rf.order_id where id = ev.id;
  if v_outcome = 'discrepancy' then perform private.notify_order(rf.order_id, null, 'payment_discrepancy', 'team', ev.id::text); end if;
  return jsonb_build_object('outcome', v_outcome, 'order_id', rf.order_id);
end;
$$;

-- The website sent a refund to the provider: it stays pending until the provider confirms it.
create function public.payments_refund_submitted(p_key text, p_refund uuid, p_provider_refund_id text, p_error text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare rf public.refunds;
begin
  perform private.assert_server_key(p_key);
  select * into rf from public.refunds where id = p_refund for update;
  if not found or rf.status <> 'approved' then raise exception 'invalid_request' using errcode = '22023'; end if;
  perform private.act('system', 'Refund sent to the provider');
  if nullif(p_provider_refund_id, '') is not null then
    update public.refunds set status = 'pending', provider_refund_id = p_provider_refund_id, submitted_at = now() where id = rf.id;
  else
    update public.refunds set status = 'failed', failure_reason = left(coalesce(p_error, 'The provider refused the refund.'), 300) where id = rf.id;
    perform private.notify_order(rf.order_id, rf.return_id, 'refund_failed', 'team', rf.id::text || ':submit');
  end if;
  perform private.refresh_payment(rf.order_id);
end;
$$;

-- Refunds the owner approved that still have to go to the provider (the website sends them).
create function public.payments_refunds_to_submit(p_key text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.assert_server_key(p_key);
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reference', r.reference, 'amount', r.amount, 'currency', r.currency,
      'provider', p.provider, 'provider_payment_id', p.provider_payment_id, 'idempotency_key', r.idempotency_key))
    from public.refunds r join public.payments p on p.id = r.payment_id
    where r.status = 'approved' and r.route = 'original_payment' and p.method = 'hosted_checkout' and p.provider_payment_id is not null), '[]');
end;
$$;

-- An order seen through the customer's private link: only what the customer may see.
create function private.customer_view(p_order uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reference', o.reference, 'status', o.status, 'payment_status', o.payment_status, 'fulfilment_status', o.fulfilment_status,
    'currency', o.currency, 'subtotal', o.subtotal_amount, 'discount', o.discount_amount, 'shipping', o.shipping_amount,
    'vat', o.vat_amount, 'vat_rate', o.vat_rate_percent, 'vat_treatment', o.vat_treatment, 'prices_include_vat', o.prices_include_vat,
    'duties_treatment', o.duties_treatment, 'duties_note', o.duties_note, 'total', o.total_amount, 'paid', o.amount_paid,
    'refunded', o.amount_refunded, 'balance', greatest(coalesce(o.total_amount, 0) - o.amount_paid, 0),
    'delivery_mode', o.delivery_mode, 'shipping_country', o.shipping_country, 'shipping_destination', o.shipping_destination,
    'sourcing_eta', o.sourcing_eta, 'transit_days_min', o.transit_days_min, 'transit_days_max', o.transit_days_max,
    'delivery_estimate_from', o.delivery_estimate_from, 'delivery_estimate_to', o.delivery_estimate_to,
    'delivery_estimate_note', o.delivery_estimate_note, 'quote_expires_at', o.quote_expires_at, 'accepted_at', o.accepted_at,
    'cancellation_terms', o.cancellation_terms, 'customer_note', o.customer_note, 'created_at', o.created_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'description', i.description, 'brand', i.brand,
        'options', i.options, 'quantity', i.quantity, 'unit_amount', i.unit_amount, 'availability', i.availability, 'stage', i.stage)
      order by i.position, i.id) from public.order_items i where i.order_id = o.id), '[]'),
    'shipments', coalesce((select jsonb_agg(jsonb_build_object('reference', s.reference, 'carrier', s.carrier,
        'tracking_number', s.tracking_number, 'tracking_url', s.tracking_url, 'status', s.status,
        'handed_over_at', s.handed_over_at, 'delivered_at', s.delivered_at) order by s.created_at)
      from public.shipments s where s.order_id = o.id and s.direction = 'outbound' and s.status not in ('preparing', 'label_created', 'cancelled')), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'kind', e.kind, 'to', e.to_value, 'note', e.public_note) order by e.id)
      from public.order_events e where e.order_id = o.id and e.customer_visible), '[]'),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('at', m.created_at, 'from_customer', m.from_customer, 'kind', m.kind, 'body', m.body) order by m.id)
      from public.order_messages m where m.order_id = o.id), '[]'),
    'returns', coalesce((select jsonb_agg(jsonb_build_object('reference', r.reference, 'status', r.status, 'reason', r.reason,
        'created_at', r.created_at, 'decision_reason', case when r.status = 'rejected' then r.decision_reason end,
        'support_path', case when r.status = 'rejected' then r.support_path end, 'resolution', r.resolution,
        'item_ids', (select jsonb_agg(ri.order_item_id) from public.return_items ri where ri.return_id = r.id)) order by r.created_at)
      from public.returns r where r.order_id = o.id), '[]'),
    'policies', coalesce((select jsonb_agg(jsonb_build_object('kind', pv.kind, 'version', pv.version, 'title', pv.title) order by pv.kind)
      from public.order_policy_acceptances a join public.policy_versions pv on pv.id = a.policy_version_id where a.order_id = o.id), '[]'),
    'change_of_mind_days', (select change_of_mind_days from public.shop_settings),
    'delivered_at', (select max(s.delivered_at) from public.shipments s where s.order_id = o.id and s.direction = 'outbound' and s.status = 'delivered'),
    'open_payment', (select jsonb_build_object('id', p.id, 'status', p.status, 'amount', p.amount, 'expires_at', p.session_expires_at)
      from public.payments p where p.order_id = o.id and p.method = 'hosted_checkout' and p.status in ('created', 'pending')
      order by p.created_at desc limit 1)
  )
  from public.orders o where o.id = p_order
$$;

-- The order behind a customer's link, or null (unknown, revoked, expired, or still a draft).
create function private.order_for_link(p_token_hash text) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare l public.order_access_links;
begin
  select * into l from public.order_access_links
  where token_hash = p_token_hash and revoked_at is null and expires_at > now();
  if not found or (select status from public.orders where id = l.order_id) = 'draft' then return null; end if;
  update public.order_access_links set last_used_at = now() where id = l.id;
  return l.order_id;
end;
$$;

create function public.shop_order_view(p_key text, p_token_hash text, p_client_hash text) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare oid uuid;
begin
  perform private.assert_server_key(p_key);
  perform private.hit('order_view', coalesce(nullif(p_client_hash, ''), '-'), 120, interval '1 hour');
  oid := private.order_for_link(p_token_hash);
  if oid is null then return null; end if;
  return private.customer_view(oid);
end;
$$;

-- The customer accepts a sent quote (and the approved policies) from their link.
create function public.shop_order_accept_quote(p_key text, p_token_hash text) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  oid uuid;
  o public.orders;
begin
  perform private.assert_server_key(p_key);
  oid := private.order_for_link(p_token_hash);
  if oid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into o from public.orders where id = oid for update;
  if o.status <> 'awaiting_confirmation' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if o.quote_expires_at is not null and o.quote_expires_at < now() then raise exception 'quote_expired' using errcode = '22023'; end if;
  if o.accepted_at is null then
    perform private.act('customer', 'Quote accepted on the order page');
    update public.orders set accepted_at = now() where id = oid;
    insert into public.order_policy_acceptances (order_id, policy_version_id, via)
    select oid, unnest(private.required_policies()), 'quote_link' on conflict do nothing;
    perform private.order_event(oid, 'quote.accepted', null, null, true);
    perform private.notify_order(oid, null, 'quote_accepted', 'team', oid::text);
  end if;
  return private.customer_view(oid);
end;
$$;

-- A payment for what is left to pay on a sent quote, through the hosted checkout. Holds in-stock
-- pieces again for the payment window.
create function public.shop_order_payment(p_key text, p_token_hash text, p_provider text) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  oid uuid;
  o public.orders;
  pay public.payments;
  minutes integer := (select reservation_minutes from public.shop_settings);
begin
  perform private.assert_server_key(p_key);
  oid := private.order_for_link(p_token_hash);
  if oid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into o from public.orders where id = oid for update;
  if o.status <> 'awaiting_confirmation' or o.total_amount is null or o.amount_paid >= o.total_amount then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if o.quote_expires_at is not null and o.quote_expires_at < now() then raise exception 'quote_expired' using errcode = '22023'; end if;
  if o.accepted_at is null then raise exception 'quote_not_accepted' using errcode = '22023'; end if;
  if coalesce(array_length(private.required_policies(), 1), 0) < 2 then raise exception 'policies_unapproved' using errcode = '22023'; end if;
  select * into pay from public.payments
  where order_id = oid and method = 'hosted_checkout' and status in ('created', 'pending') and session_expires_at > now()
  order by created_at desc limit 1;
  if found then
    return jsonb_build_object('payment_id', pay.id, 'amount', pay.amount, 'currency', pay.currency, 'session_id', pay.provider_session_id,
      'redirect_url', pay.redirect_url, 'expires_at', pay.session_expires_at, 'reference', o.reference);
  end if;
  perform private.act('customer', 'Payment started from the order page');
  perform private.reserve_stock(oid, minutes);
  insert into public.payments (order_id, method, provider, amount, currency, session_expires_at)
  values (oid, 'hosted_checkout', p_provider, o.total_amount - o.amount_paid, o.currency, now() + make_interval(mins => minutes))
  returning * into pay;
  perform private.refresh_payment(oid);
  return jsonb_build_object('payment_id', pay.id, 'amount', pay.amount, 'currency', pay.currency, 'session_id', null,
    'expires_at', pay.session_expires_at, 'reference', o.reference);
end;
$$;

-- A return request from the customer's order page. The policy check is stored as advice; the owner decides.
create function public.shop_order_request_return(p_key text, p_token_hash text, p_request jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  oid uuid;
  r public.returns;
  it jsonb;
  item public.order_items;
  qty integer;
  delivered timestamptz;
  window_days integer := (select change_of_mind_days from public.shop_settings);
  v_reason text := p_request ->> 'reason';
  idem text := p_request ->> 'idempotency_key';
begin
  perform private.assert_server_key(p_key);
  oid := private.order_for_link(p_token_hash);
  if oid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if idem is null or idem !~ '^[A-Za-z0-9-]{16,64}$' or jsonb_typeof(p_request -> 'items') <> 'array'
     or jsonb_array_length(p_request -> 'items') not between 1 and 30 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into r from public.returns where idempotency_key = 'customer:' || idem;
  if found then return jsonb_build_object('reference', r.reference, 'created', false); end if;
  perform private.hit('return_request', p_token_hash, 5, interval '1 day');

  delivered := (select max(s.delivered_at) from public.shipments s where s.order_id = oid and s.direction = 'outbound' and s.status = 'delivered');
  perform private.act('customer', 'Return requested on the order page');
  insert into public.returns (order_id, reason, description, requested_by, idempotency_key, eligibility)
  values (oid, v_reason, left(nullif(btrim(p_request ->> 'description'), ''), 2000), 'customer', 'customer:' || idem,
    jsonb_build_object(
      'delivered_at', delivered,
      'days_since_delivery', case when delivered is not null then extract(day from now() - delivered)::integer end,
      'change_of_mind_days', window_days,
      'change_of_mind_in_window', case when v_reason = 'change_of_mind' and window_days is not null and delivered is not null
                                       then now() - delivered <= make_interval(days => window_days) end,
      'note', case when v_reason = 'change_of_mind' then 'Change of mind: in-stock pieces only, within the window set in Settings.'
                   else 'Faulty, damaged, wrong, misdescribed or inauthentic: the owner reviews every request. Statutory rights are not affected.' end))
  returning * into r;

  for it in select * from jsonb_array_elements(p_request -> 'items') loop
    select * into item from public.order_items where id = (it ->> 'order_item_id')::bigint and order_id = oid;
    qty := coalesce((it ->> 'quantity')::integer, 1);
    if not found or item.stage not in ('delivered', 'collected') or qty < 1
       or qty > item.quantity - coalesce((select sum(ri.quantity) from public.return_items ri join public.returns r2 on r2.id = ri.return_id
                                          where ri.order_item_id = item.id and r2.status <> 'rejected'), 0) then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    insert into public.return_items (return_id, order_item_id, quantity) values (r.id, item.id, qty);
  end loop;
  update public.returns set eligibility = eligibility || jsonb_build_object('items_on_request',
      exists (select 1 from public.return_items ri join public.order_items i on i.id = ri.order_item_id where ri.return_id = r.id and i.availability = 'on_request'))
  where id = r.id;
  perform private.notify_order(oid, r.id, 'return_requested', 'team', r.id::text);
  return jsonb_build_object('reference', r.reference, 'created', true);
end;
$$;

-- A message, or a cancellation request, from the customer's order page.
create function public.shop_order_message(p_key text, p_token_hash text, p_kind text, p_body text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  oid uuid;
  mid bigint;
begin
  perform private.assert_server_key(p_key);
  oid := private.order_for_link(p_token_hash);
  if oid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_kind not in ('message', 'cancellation_request') or length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform private.hit('order_message', p_token_hash, 10, interval '1 day');
  insert into public.order_messages (order_id, kind, from_customer, body) values (oid, p_kind, true, btrim(p_body)) returning id into mid;
  perform private.notify_order(oid, null, case when p_kind = 'cancellation_request' then 'cancellation_requested' else 'customer_message' end,
    'team', mid::text);
end;
$$;

-- Daily housekeeping: tidies expired holds (they already stopped counting) and returns what needs a
-- reminder. Nothing here changes an order's status.
create function public.shop_housekeeping(p_key text) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare released integer;
begin
  perform private.assert_server_key(p_key);
  update public.stock_reservations set status = 'released', released_reason = 'expired'
  where status = 'active' and expires_at <= now();
  get diagnostics released = row_count;
  return jsonb_build_object('released_holds', released);
end;
$$;

-- ── The panel (signed-in team; role checked inside) ──────────────────────────────────

create function public.admin_save_shop_settings(p_changes jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.shop_settings;
  new public.shop_settings;
  d record;
begin
  if jsonb_typeof(p_changes) <> 'object' or exists (select 1 from jsonb_object_keys(p_changes) k where k not in (
    'reservation_minutes', 'quote_valid_hours', 'vat_trn', 'vat_rate_percent', 'prices_include_vat', 'change_of_mind_days',
    'dispatch_alert_days', 'supplier_alert_days', 'customer_emails_enabled')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into old from public.shop_settings for update;
  begin
    update public.shop_settings set
      reservation_minutes = coalesce((p_changes ->> 'reservation_minutes')::integer, reservation_minutes),
      quote_valid_hours = coalesce((p_changes ->> 'quote_valid_hours')::integer, quote_valid_hours),
      vat_trn = case when p_changes ? 'vat_trn' then nullif(btrim(p_changes ->> 'vat_trn'), '') else vat_trn end,
      vat_rate_percent = case when p_changes ? 'vat_rate_percent' then nullif(p_changes ->> 'vat_rate_percent', '')::numeric else vat_rate_percent end,
      prices_include_vat = case when p_changes ? 'prices_include_vat' then nullif(p_changes ->> 'prices_include_vat', '')::boolean else prices_include_vat end,
      change_of_mind_days = case when p_changes ? 'change_of_mind_days' then nullif(p_changes ->> 'change_of_mind_days', '')::integer else change_of_mind_days end,
      dispatch_alert_days = coalesce((p_changes ->> 'dispatch_alert_days')::integer, dispatch_alert_days),
      supplier_alert_days = coalesce((p_changes ->> 'supplier_alert_days')::integer, supplier_alert_days),
      customer_emails_enabled = coalesce((p_changes ->> 'customer_emails_enabled')::boolean, customer_emails_enabled),
      updated_by = me
    returning * into new;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  select * into d from private.diff(to_jsonb(old) - 'updated_at' - 'updated_by', to_jsonb(new) - 'updated_at' - 'updated_by');
  if d.d_after <> '{}'::jsonb then perform private.audit(me, 'settings.updated', 'shop_settings', 'shop', d.d_before, d.d_after); end if;
end;
$$;

create function public.admin_save_shipping_zone(p_id bigint, p_fields jsonb, p_countries text[]) returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  zid bigint := p_id;
  f jsonb := coalesce(p_fields, '{}');
begin
  if exists (select 1 from unnest(coalesce(p_countries, '{}')) c where c !~ '^[A-Z]{2}$') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  begin
    if zid is null then
      insert into public.shipping_zones (name, fee_aed, transit_days_min, transit_days_max, vat_treatment, duties_treatment, duties_note, carrier_note, active, position)
      values (btrim(f ->> 'name'), nullif(f ->> 'fee_aed', '')::numeric, nullif(f ->> 'transit_days_min', '')::smallint,
        nullif(f ->> 'transit_days_max', '')::smallint, coalesce(f ->> 'vat_treatment', 'unknown'), coalesce(f ->> 'duties_treatment', 'unknown'),
        nullif(btrim(f ->> 'duties_note'), ''), nullif(btrim(f ->> 'carrier_note'), ''), coalesce((f ->> 'active')::boolean, true),
        coalesce((f ->> 'position')::smallint, 0))
      returning id into zid;
    else
      update public.shipping_zones set
        name = coalesce(btrim(f ->> 'name'), name),
        fee_aed = case when f ? 'fee_aed' then nullif(f ->> 'fee_aed', '')::numeric else fee_aed end,
        transit_days_min = case when f ? 'transit_days_min' then nullif(f ->> 'transit_days_min', '')::smallint else transit_days_min end,
        transit_days_max = case when f ? 'transit_days_max' then nullif(f ->> 'transit_days_max', '')::smallint else transit_days_max end,
        vat_treatment = coalesce(f ->> 'vat_treatment', vat_treatment),
        duties_treatment = coalesce(f ->> 'duties_treatment', duties_treatment),
        duties_note = case when f ? 'duties_note' then nullif(btrim(f ->> 'duties_note'), '') else duties_note end,
        carrier_note = case when f ? 'carrier_note' then nullif(btrim(f ->> 'carrier_note'), '') else carrier_note end,
        active = coalesce((f ->> 'active')::boolean, active),
        position = coalesce((f ->> 'position')::smallint, position)
      where id = zid;
      if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    end if;
    if p_countries is not null then
      delete from public.shipping_zone_countries where zone_id = zid;
      insert into public.shipping_zone_countries (country, zone_id) select distinct c, zid from unnest(p_countries) c;
    end if;
  exception
    when unique_violation then raise exception 'country_in_another_zone' using errcode = '22023';
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_request' using errcode = '22023';
  end;
  perform private.audit(me, 'shipping_zone.saved', 'shipping_zone', zid::text, null, f || jsonb_build_object('countries', to_jsonb(p_countries)));
  return zid;
end;
$$;

create function public.admin_save_policy(p_id bigint, p_fields jsonb) returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  pid bigint := p_id;
begin
  begin
    if pid is null then
      insert into public.policy_versions (kind, version, title, body, created_by)
      values (p_fields ->> 'kind', btrim(p_fields ->> 'version'), btrim(p_fields ->> 'title'), btrim(p_fields ->> 'body'), me)
      returning id into pid;
    else
      update public.policy_versions set
        version = coalesce(btrim(p_fields ->> 'version'), version),
        title = coalesce(btrim(p_fields ->> 'title'), title),
        body = coalesce(btrim(p_fields ->> 'body'), body)
      where id = pid and status = 'draft';
      if not found then raise exception 'not_editable' using errcode = '22023'; end if;
    end if;
  exception
    when unique_violation then raise exception 'version_exists' using errcode = '22023';
    when check_violation or not_null_violation then raise exception 'invalid_request' using errcode = '22023';
  end;
  perform private.audit(me, 'policy.saved', 'policy', pid::text, null, jsonb_build_object('kind', p_fields ->> 'kind', 'version', p_fields ->> 'version'));
  return pid;
end;
$$;

-- Approving a version retires the one it replaces. Approved texts are never edited; write a new version.
create function public.admin_set_policy_status(p_id bigint, p_status text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  pv public.policy_versions;
begin
  select * into pv from public.policy_versions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status = 'approved' and pv.status = 'draft' then
    update public.policy_versions set status = 'retired' where kind = pv.kind and status = 'approved';
    update public.policy_versions set status = 'approved', approved_by = me, approved_at = now() where id = p_id;
  elsif p_status = 'retired' and pv.status = 'approved' then
    update public.policy_versions set status = 'retired' where id = p_id;
  else
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  perform private.audit(me, 'policy.' || p_status, 'policy', p_id::text, jsonb_build_object('status', pv.status), jsonb_build_object('status', p_status));
end;
$$;

-- Validates and writes an order's lines (draft orders only).
create function private.write_items(p_order uuid, p_items jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  it jsonb;
  pos smallint := 0;
  v public.product_variants;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  delete from public.order_items where order_id = p_order;
  for it in select * from jsonb_array_elements(p_items) loop
    v := null;
    if nullif(btrim(it ->> 'sku'), '') is not null then
      select * into v from public.product_variants where upper(sku) = upper(btrim(it ->> 'sku'));
      if not found or (nullif(btrim(it ->> 'product_ref'), '') is not null and upper(v.product_ref) <> upper(btrim(it ->> 'product_ref'))) then
        raise exception 'unknown_version' using errcode = '22023';
      end if;
    end if;
    if nullif(btrim(it ->> 'product_ref'), '') is not null
       and not exists (select 1 from public.products where upper(ref) = upper(btrim(it ->> 'product_ref'))) then
      raise exception 'unknown_piece' using errcode = '22023';
    end if;
    insert into public.order_items (order_id, description, brand, product_ref, sku, variant_id, options, quantity, unit_amount,
      availability, condition, condition_notes, included, position)
    values (p_order, btrim(it ->> 'description'), nullif(btrim(it ->> 'brand'), ''),
      coalesce(v.product_ref, (select ref from public.products where upper(ref) = upper(nullif(btrim(it ->> 'product_ref'), '')))),
      v.sku, v.id, nullif(btrim(it ->> 'options'), ''), coalesce((it ->> 'quantity')::integer, 1),
      nullif(it ->> 'unit_amount', '')::numeric, coalesce(nullif(it ->> 'availability', ''), 'in_stock'),
      nullif(btrim(it ->> 'condition'), ''), nullif(btrim(it ->> 'condition_notes'), ''),
      coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(it -> 'included', '[]')) x where btrim(x) <> '' limit 12), '{}'), pos);
    pos := pos + 1;
  end loop;
end;
$$;

-- Creates an order as a draft quote (from a request, a WhatsApp conversation, the phone, …).
create or replace function private.order_fields_ok(p jsonb, p_keys text[]) returns boolean
language sql immutable
set search_path = ''
as $$ select jsonb_typeof(p) = 'object' and not exists (select 1 from jsonb_object_keys(p) k where not (k = any (p_keys))) $$;

drop function public.admin_create_order(uuid, uuid, text, numeric, jsonb, text, text, text);

create function public.admin_create_order(p_order jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  s public.shop_settings;
  o public.orders;
  test boolean;
  req uuid := nullif(p_order ->> 'request_id', '')::uuid;
begin
  if not private.order_fields_ok(p_order, array[
    'customer_id', 'request_id', 'channel', 'currency', 'items', 'discount_amount', 'shipping_amount', 'vat_treatment',
    'duties_treatment', 'duties_note', 'delivery_mode', 'shipping_country', 'shipping_address', 'shipping_destination',
    'recipient_name', 'recipient_phone', 'contact_email', 'customer_note', 'cancellation_terms', 'sourcing_eta',
    'transit_days_min', 'transit_days_max', 'delivery_estimate_from', 'delivery_estimate_to', 'delivery_estimate_note', 'assigned_to']) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into s from public.shop_settings;
  test := coalesce((select is_test from public.customers where id = (p_order ->> 'customer_id')::uuid), false);
  perform private.act_team('Order created in the panel');
  begin
    insert into public.orders (
      customer_id, request_id, channel, status, currency, discount_amount, shipping_amount, vat_treatment, vat_rate_percent,
      prices_include_vat, duties_treatment, duties_note, delivery_mode, shipping_country, shipping_address, shipping_destination,
      recipient_name, recipient_phone, contact_email, customer_note, cancellation_terms, sourcing_eta, transit_days_min,
      transit_days_max, delivery_estimate_from, delivery_estimate_to, delivery_estimate_note, assigned_to, amount_approved_by,
      amount_approved_at, is_test, created_by
    ) values (
      (p_order ->> 'customer_id')::uuid, req, coalesce(nullif(p_order ->> 'channel', ''), 'panel'), 'draft',
      upper(coalesce(nullif(btrim(p_order ->> 'currency'), ''), 'AED')), coalesce(nullif(p_order ->> 'discount_amount', '')::numeric, 0),
      nullif(p_order ->> 'shipping_amount', '')::numeric, coalesce(nullif(p_order ->> 'vat_treatment', ''), 'unknown'),
      s.vat_rate_percent, s.prices_include_vat, coalesce(nullif(p_order ->> 'duties_treatment', ''), 'unknown'),
      nullif(btrim(p_order ->> 'duties_note'), ''), coalesce(nullif(p_order ->> 'delivery_mode', ''), 'deliver'),
      upper(nullif(btrim(p_order ->> 'shipping_country'), '')), nullif(btrim(p_order ->> 'shipping_address'), ''),
      nullif(btrim(p_order ->> 'shipping_destination'), ''), nullif(btrim(p_order ->> 'recipient_name'), ''),
      nullif(btrim(p_order ->> 'recipient_phone'), ''), nullif(lower(btrim(p_order ->> 'contact_email')), ''),
      nullif(btrim(p_order ->> 'customer_note'), ''), nullif(btrim(p_order ->> 'cancellation_terms'), ''),
      nullif(p_order ->> 'sourcing_eta', '')::date, nullif(p_order ->> 'transit_days_min', '')::smallint,
      nullif(p_order ->> 'transit_days_max', '')::smallint, nullif(p_order ->> 'delivery_estimate_from', '')::date,
      nullif(p_order ->> 'delivery_estimate_to', '')::date, nullif(btrim(p_order ->> 'delivery_estimate_note'), ''),
      nullif(p_order ->> 'assigned_to', '')::uuid, me, now(), test, me
    ) returning * into o;
    perform private.write_items(o.id, p_order -> 'items');
    perform private.recompute_totals(o.id);
  exception
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or numeric_value_out_of_range or invalid_datetime_format then
      raise exception 'invalid_request' using errcode = '22023';
  end;
  if req is not null then update public.requests set status = 'converted' where id = req; end if;
  select * into o from public.orders where id = o.id;
  perform private.audit(me, 'order.created', 'order', o.id::text, null,
    jsonb_build_object('reference', o.reference, 'currency', o.currency, 'total_amount', o.total_amount, 'request_id', req));
  return jsonb_build_object('id', o.id, 'reference', o.reference);
end;
$$;

drop function public.admin_update_order(uuid, jsonb);

-- Staff: assignment, address, estimates and the note shown to the customer. Owner: amounts, VAT and
-- duties, terms and the contact e-mail (amounts only while the order is a draft quote).
create function public.admin_update_order(p_id uuid, p_changes jsonb, p_reason text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  owner boolean := private.is_owner();
  old public.orders;
  new public.orders;
  d record;
  staff_keys constant text[] := array['assigned_to', 'shipping_address', 'shipping_destination', 'recipient_name', 'recipient_phone',
    'sourcing_eta', 'delivery_estimate_from', 'delivery_estimate_to', 'delivery_estimate_note', 'customer_note'];
  owner_keys constant text[] := array['contact_email', 'cancellation_terms', 'quote_expires_at', 'channel', 'transit_days_min', 'transit_days_max'];
  draft_keys constant text[] := array['currency', 'discount_amount', 'shipping_amount', 'vat_treatment', 'duties_treatment', 'duties_note',
    'delivery_mode', 'shipping_country', 'items'];
begin
  if not private.order_fields_ok(p_changes, staff_keys || owner_keys || draft_keys) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not owner and exists (select 1 from jsonb_object_keys(p_changes) k where not (k = any (staff_keys))) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  select * into old from public.orders where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if old.status in ('completed', 'cancelled') then raise exception 'order_closed' using errcode = '22023'; end if;
  if old.status <> 'draft' and exists (select 1 from jsonb_object_keys(p_changes) k where k = any (draft_keys)) then
    raise exception 'quote_sent' using errcode = '22023', hint = 'Return the quote to draft to change amounts.';
  end if;
  perform private.act_team(p_reason);
  begin
    update public.orders set
      assigned_to = case when p_changes ? 'assigned_to' then nullif(p_changes ->> 'assigned_to', '')::uuid else assigned_to end,
      shipping_address = case when p_changes ? 'shipping_address' then nullif(btrim(p_changes ->> 'shipping_address'), '') else shipping_address end,
      shipping_destination = case when p_changes ? 'shipping_destination' then nullif(btrim(p_changes ->> 'shipping_destination'), '') else shipping_destination end,
      recipient_name = case when p_changes ? 'recipient_name' then nullif(btrim(p_changes ->> 'recipient_name'), '') else recipient_name end,
      recipient_phone = case when p_changes ? 'recipient_phone' then nullif(btrim(p_changes ->> 'recipient_phone'), '') else recipient_phone end,
      sourcing_eta = case when p_changes ? 'sourcing_eta' then nullif(p_changes ->> 'sourcing_eta', '')::date else sourcing_eta end,
      delivery_estimate_from = case when p_changes ? 'delivery_estimate_from' then nullif(p_changes ->> 'delivery_estimate_from', '')::date else delivery_estimate_from end,
      delivery_estimate_to = case when p_changes ? 'delivery_estimate_to' then nullif(p_changes ->> 'delivery_estimate_to', '')::date else delivery_estimate_to end,
      delivery_estimate_note = case when p_changes ? 'delivery_estimate_note' then nullif(btrim(p_changes ->> 'delivery_estimate_note'), '') else delivery_estimate_note end,
      customer_note = case when p_changes ? 'customer_note' then nullif(btrim(p_changes ->> 'customer_note'), '') else customer_note end,
      contact_email = case when p_changes ? 'contact_email' then nullif(lower(btrim(p_changes ->> 'contact_email')), '') else contact_email end,
      cancellation_terms = case when p_changes ? 'cancellation_terms' then nullif(btrim(p_changes ->> 'cancellation_terms'), '') else cancellation_terms end,
      quote_expires_at = case when p_changes ? 'quote_expires_at' then nullif(p_changes ->> 'quote_expires_at', '')::timestamptz else quote_expires_at end,
      channel = coalesce(nullif(p_changes ->> 'channel', ''), channel),
      transit_days_min = case when p_changes ? 'transit_days_min' then nullif(p_changes ->> 'transit_days_min', '')::smallint else transit_days_min end,
      transit_days_max = case when p_changes ? 'transit_days_max' then nullif(p_changes ->> 'transit_days_max', '')::smallint else transit_days_max end,
      currency = coalesce(upper(nullif(btrim(p_changes ->> 'currency'), '')), currency),
      discount_amount = case when p_changes ? 'discount_amount' then coalesce(nullif(p_changes ->> 'discount_amount', '')::numeric, 0) else discount_amount end,
      shipping_amount = case when p_changes ? 'shipping_amount' then nullif(p_changes ->> 'shipping_amount', '')::numeric else shipping_amount end,
      vat_treatment = coalesce(nullif(p_changes ->> 'vat_treatment', ''), vat_treatment),
      vat_rate_percent = case when p_changes ? 'vat_treatment' then (select vat_rate_percent from public.shop_settings) else vat_rate_percent end,
      prices_include_vat = case when p_changes ? 'vat_treatment' then (select prices_include_vat from public.shop_settings) else prices_include_vat end,
      duties_treatment = coalesce(nullif(p_changes ->> 'duties_treatment', ''), duties_treatment),
      duties_note = case when p_changes ? 'duties_note' then nullif(btrim(p_changes ->> 'duties_note'), '') else duties_note end,
      delivery_mode = coalesce(nullif(p_changes ->> 'delivery_mode', ''), delivery_mode),
      shipping_country = case when p_changes ? 'shipping_country' then upper(nullif(btrim(p_changes ->> 'shipping_country'), '')) else shipping_country end,
      amount_approved_by = case when exists (select 1 from jsonb_object_keys(p_changes) k where k = any (draft_keys)) then me else amount_approved_by end,
      amount_approved_at = case when exists (select 1 from jsonb_object_keys(p_changes) k where k = any (draft_keys)) then now() else amount_approved_at end
    where id = p_id;
    if p_changes ? 'items' then perform private.write_items(p_id, p_changes -> 'items'); end if;
    if exists (select 1 from jsonb_object_keys(p_changes) k where k = any (draft_keys)) then perform private.recompute_totals(p_id); end if;
  exception
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or numeric_value_out_of_range or invalid_datetime_format then
      raise exception 'invalid_request' using errcode = '22023';
  end;
  select * into new from public.orders where id = p_id;
  select * into d from private.diff(
    to_jsonb(old) - 'updated_at' - 'amount_approved_at' - 'amount_approved_by',
    to_jsonb(new) - 'updated_at' - 'amount_approved_at' - 'amount_approved_by');
  if d.d_after <> '{}'::jsonb or p_changes ? 'items' then
    perform private.audit(me, 'order.updated', 'order', p_id::text, d.d_before, d.d_after || case when p_changes ? 'items' then '{"items":"replaced"}'::jsonb else '{}' end);
    perform private.order_event(p_id, 'order.updated', null, null, false, null, jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p_changes) k)));
  end if;
end;
$$;

-- Sends a draft quote: the customer can accept and pay until it expires. In-stock catalogue pieces
-- are held for the customer until then.
create function public.admin_send_quote(p_id uuid, p_valid_hours integer) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  o public.orders;
  hours integer := coalesce(p_valid_hours, (select quote_valid_hours from public.shop_settings));
  sourced boolean;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.status <> 'draft' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if hours is null or hours not between 1 and 720 then raise exception 'invalid_request' using errcode = '22023'; end if;
  sourced := exists (select 1 from public.order_items where order_id = p_id and availability = 'on_request');
  -- A quote is binding only when everything the customer pays is known.
  if o.total_amount is null or o.subtotal_amount is null then raise exception 'quote_incomplete' using errcode = '22023', hint = 'prices'; end if;
  if o.delivery_mode = 'deliver' and (o.shipping_amount is null or o.shipping_country is null) then
    raise exception 'quote_incomplete' using errcode = '22023', hint = 'shipping';
  end if;
  if o.vat_treatment = 'unknown' or (o.vat_treatment = 'standard' and o.vat_amount is null) then
    raise exception 'quote_incomplete' using errcode = '22023', hint = 'vat';
  end if;
  if o.delivery_mode = 'deliver' and o.shipping_country <> 'AE' and o.duties_treatment = 'unknown' then
    raise exception 'quote_incomplete' using errcode = '22023', hint = 'duties';
  end if;
  if sourced and (o.cancellation_terms is null or (o.delivery_estimate_to is null and o.delivery_estimate_note is null)) then
    raise exception 'quote_incomplete' using errcode = '22023', hint = 'sourcing_terms';
  end if;
  perform private.act_team('Quote sent');
  begin
    perform private.reserve_stock(p_id, hours * 60);
  exception when sqlstate '22023' then
    raise exception 'insufficient_stock' using errcode = '22023';
  end;
  update public.orders set status = 'awaiting_confirmation', quote_sent_at = now(), quote_expires_at = now() + make_interval(hours => hours)
  where id = p_id;
  perform private.audit(me, 'order.quote_sent', 'order', p_id::text, null, jsonb_build_object('valid_hours', hours, 'total_amount', o.total_amount));
end;
$$;

-- Back to draft to change a quote (only while nothing has been paid). Holds are released.
create function public.admin_reopen_quote(p_id uuid, p_reason text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.status <> 'awaiting_confirmation' or o.amount_paid > 0
     or exists (select 1 from public.payments where order_id = p_id and status in ('pending', 'succeeded')) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  perform private.act_team(coalesce(nullif(btrim(p_reason), ''), 'Quote returned to draft'));
  perform private.release_stock(p_id, 'quote_reopened');
  update public.payments set status = 'cancelled' where order_id = p_id and status = 'created';
  update public.orders set status = 'draft', accepted_at = null, quote_sent_at = null, quote_expires_at = null where id = p_id;
  perform private.audit(me, 'order.quote_reopened', 'order', p_id::text, null, jsonb_build_object('reason', p_reason));
end;
$$;

-- Confirms an order that isn't (fully) paid online: needs the full payment recorded, or the owner's
-- documented reason for confirming before it.
create function public.admin_confirm_order(p_id uuid, p_reason text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.status <> 'awaiting_confirmation' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if o.amount_paid < o.total_amount and nullif(btrim(p_reason), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  perform private.act_team(coalesce(nullif(btrim(p_reason), ''), 'Confirmed by the owner'));
  if not private.confirm_order(p_id, coalesce(nullif(btrim(p_reason), ''), 'Confirmed by the owner')) then
    raise exception 'insufficient_stock' using errcode = '22023';
  end if;
  perform private.audit(me, 'order.confirmed', 'order', p_id::text, null, jsonb_build_object('reason', p_reason, 'paid', o.amount_paid));
end;
$$;

-- A line of a waiting order becomes on request (the piece will be sourced) or in stock.
create function public.admin_set_item_availability(p_item bigint, p_availability text, p_reason text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  it public.order_items;
  o public.orders;
begin
  select * into it from public.order_items where id = p_item;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into o from public.orders where id = it.order_id for update;
  if o.status not in ('draft', 'awaiting_confirmation') or p_availability not in ('in_stock', 'on_request') or nullif(btrim(p_reason), '') is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform private.act_team(p_reason);
  update public.order_items set availability = p_availability where id = p_item;
  if p_availability = 'on_request' then
    update public.stock_reservations set status = 'released', released_reason = 'now_on_request' where order_item_id = p_item and status = 'active';
  end if;
  perform private.order_event(o.id, 'item.availability', it.availability, p_availability, false, null, jsonb_build_object('item', it.description));
  perform private.audit(me, 'order.item_availability', 'order', o.id::text, jsonb_build_object('item', p_item, 'availability', it.availability),
    jsonb_build_object('item', p_item, 'availability', p_availability, 'reason', p_reason));
end;
$$;

-- Payments the website didn't take. The owner records a payment only after seeing the funds; staff
-- can note what a customer says they paid, which waits for the owner.
create function public.admin_record_payment(p_order uuid, p_fields jsonb) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  owner boolean := private.is_owner();
  o public.orders;
  pay public.payments;
  verified boolean := coalesce((p_fields ->> 'verified')::boolean, false);
begin
  if verified and not owner then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.status in ('draft', 'cancelled') then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if coalesce(p_fields ->> 'method', '') not in ('bank_transfer', 'cash', 'card_terminal', 'other')
     or upper(coalesce(p_fields ->> 'currency', o.currency)) <> o.currency then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into pay from public.payments where idempotency_key = p_fields ->> 'idempotency_key';
  if found then return pay.id; end if;
  perform private.act_team(case when verified then 'Payment received (checked by the owner)' else 'Payment reported by the customer' end);
  begin
    insert into public.payments (order_id, method, amount, currency, status, succeeded_at, verified_by, verification_note, recorded_by, idempotency_key)
    values (p_order, p_fields ->> 'method', (p_fields ->> 'amount')::numeric, o.currency,
      case when verified then 'succeeded' else 'pending' end, case when verified then now() end,
      case when verified then me end, nullif(btrim(p_fields ->> 'note'), ''), me, p_fields ->> 'idempotency_key')
    returning * into pay;
  exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  perform private.refresh_payment(p_order);
  perform private.audit(me, 'payment.recorded', 'order', p_order::text, null,
    jsonb_build_object('payment', pay.reference, 'amount', pay.amount, 'method', pay.method, 'status', pay.status));
  return pay.id;
end;
$$;

create function public.admin_verify_payment(p_payment uuid, p_accept boolean, p_note text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  pay public.payments;
begin
  select * into pay from public.payments where id = p_payment for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if pay.method = 'hosted_checkout' or pay.status <> 'pending' or nullif(btrim(p_note), '') is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform private.act_team(p_note);
  if p_accept then
    update public.payments set status = 'succeeded', succeeded_at = now(), verified_by = me, verification_note = btrim(p_note) where id = p_payment;
  else
    update public.payments set status = 'failed', failure_reason = left(btrim(p_note), 300) where id = p_payment;
  end if;
  perform private.refresh_payment(pay.order_id);
  perform private.audit(me, case when p_accept then 'payment.verified' else 'payment.rejected' end, 'order', pay.order_id::text, null,
    jsonb_build_object('payment', pay.reference, 'note', p_note));
end;
$$;

create function public.admin_resolve_payment_event(p_id bigint, p_note text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare me uuid := private.require_owner();
begin
  if nullif(btrim(p_note), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  update public.payment_events set resolved_by = me, resolved_at = now(), resolution_note = left(btrim(p_note), 600)
  where id = p_id and outcome = 'discrepancy' and resolved_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.audit(me, 'payment_event.resolved', 'payment_event', p_id::text, null, jsonb_build_object('note', p_note));
end;
$$;

-- Before dispatch only. Holds are released and sourcing stops. Money already paid is refunded
-- separately (Refunds), never assumed.
create function public.admin_cancel_order(p_id uuid, p_reason text, p_public_note text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.act_team(p_reason);
  update public.orders set status = 'cancelled', cancel_reason = nullif(btrim(p_reason), '') where id = p_id;
  perform private.release_stock(p_id, 'order_cancelled');
  -- Units already taken out of stock go back (nothing has left the shop).
  perform private.restock(r.order_item_id, r.quantity) from public.stock_reservations r where r.order_id = p_id and r.status = 'consumed';
  update public.stock_reservations set status = 'released', released_reason = 'order_cancelled' where order_id = p_id and status = 'consumed';
  update public.payments set status = 'cancelled' where order_id = p_id and status = 'created';
  update public.sourcing_tasks set status = 'cancelled' where order_id = p_id and status not in ('received', 'failed', 'cancelled');
  update public.order_items set stage = 'cancelled' where order_id = p_id;
  update public.shipments set status = 'cancelled' where order_id = p_id and status in ('preparing', 'label_created');
  if nullif(btrim(p_public_note), '') is not null then
    perform private.order_event(p_id, 'order.note', null, null, true, p_public_note);
  end if;
  perform private.notify_order(p_id, null, 'order_cancelled', 'customer', p_id::text);
  perform private.audit(me, 'order.cancelled', 'order', p_id::text, jsonb_build_object('status', o.status),
    jsonb_build_object('status', 'cancelled', 'reason', p_reason, 'paid', o.amount_paid - o.amount_refunded));
end;
$$;

-- The team's pre-dispatch stages. Shipped and later come from shipments.
create function public.admin_set_fulfilment_stage(p_id uuid, p_stage text, p_reason text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.status not in ('confirmed', 'processing') or p_stage not in ('awaiting_stock', 'sourcing', 'quality_check', 'packed', 'ready_to_dispatch') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if p_stage in ('packed', 'ready_to_dispatch') and exists (
    select 1 from public.order_items where order_id = p_id and stage not in ('qc_passed', 'shipped', 'delivered', 'collected', 'cancelled')) then
    raise exception 'checks_missing' using errcode = '22023';
  end if;
  if p_stage = 'ready_to_dispatch' and o.delivery_mode = 'deliver' and not exists (
    select 1 from public.shipments s where s.order_id = p_id and s.direction = 'outbound' and s.status in ('preparing', 'label_created')
      and s.packed_contents is not null) then
    raise exception 'shipment_missing' using errcode = '22023';
  end if;
  perform private.act_team(p_reason);
  update public.orders set fulfilment_status = p_stage::public.fulfilment_status,
    status = case when status = 'confirmed' then 'processing'::public.order_status else status end
  where id = p_id;
end;
$$;

create function public.admin_update_sourcing_task(p_id bigint, p_changes jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  t public.sourcing_tasks;
  n public.sourcing_tasks;
begin
  if not private.order_fields_ok(p_changes, array['status', 'assigned_to', 'supplier', 'supplier_reference', 'confirm_by', 'expected_at', 'notes', 'failure_reason']) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into t from public.sourcing_tasks where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.status in ('received', 'cancelled') then raise exception 'invalid_transition' using errcode = '22023'; end if;
  perform private.act_team(coalesce(p_changes ->> 'failure_reason', 'Sourcing updated'));
  begin
    update public.sourcing_tasks set
      status = coalesce(nullif(p_changes ->> 'status', ''), status),
      assigned_to = case when p_changes ? 'assigned_to' then nullif(p_changes ->> 'assigned_to', '')::uuid else assigned_to end,
      supplier = case when p_changes ? 'supplier' then nullif(btrim(p_changes ->> 'supplier'), '') else supplier end,
      supplier_reference = case when p_changes ? 'supplier_reference' then nullif(btrim(p_changes ->> 'supplier_reference'), '') else supplier_reference end,
      confirm_by = case when p_changes ? 'confirm_by' then nullif(p_changes ->> 'confirm_by', '')::timestamptz else confirm_by end,
      expected_at = case when p_changes ? 'expected_at' then nullif(p_changes ->> 'expected_at', '')::date else expected_at end,
      notes = case when p_changes ? 'notes' then nullif(btrim(p_changes ->> 'notes'), '') else notes end,
      failure_reason = case when p_changes ? 'failure_reason' then nullif(btrim(p_changes ->> 'failure_reason'), '') else failure_reason end
    where id = p_id returning * into n;
  exception when check_violation or foreign_key_violation or invalid_text_representation or invalid_datetime_format then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  if n.status is distinct from t.status then
    perform private.order_event(t.order_id, 'sourcing.' || n.status, t.status, n.status, false, null,
      jsonb_build_object('item', (select description from public.order_items where id = t.order_item_id)));
    if n.status = 'received' then
      update public.order_items set stage = 'in_hand' where id = t.order_item_id and stage = 'sourcing';
      if not exists (select 1 from public.order_items where order_id = t.order_id and stage in ('pending', 'sourcing')) then
        update public.orders set fulfilment_status = 'quality_check' where id = t.order_id and fulfilment_status in ('sourcing', 'awaiting_stock');
      end if;
    elsif n.status = 'failed' then
      perform private.notify_order(t.order_id, null, 'supplier_failed', 'team', p_id::text);
    end if;
  end if;
end;
$$;

-- A new sourcing attempt for a line whose supplier failed.
create function public.admin_add_sourcing_task(p_item bigint) returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  it public.order_items;
  tid bigint;
begin
  select * into it from public.order_items where id = p_item;
  if not found or it.stage <> 'sourcing' then raise exception 'invalid_request' using errcode = '22023'; end if;
  perform private.act_team('New sourcing attempt');
  begin
    insert into public.sourcing_tasks (order_id, order_item_id, confirm_by)
    values (it.order_id, it.id, now() + make_interval(days => (select supplier_alert_days from public.shop_settings)))
    returning id into tid;
  exception when unique_violation then raise exception 'task_exists' using errcode = '22023';
  end;
  perform private.order_event(it.order_id, 'sourcing.open', null, 'open', false);
  return tid;
end;
$$;

-- Registers a photo or document the panel has just uploaded to <order id>/<file id>.jpg|pdf.
create function public.admin_add_evidence(p_order uuid, p_fields jsonb) returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  eid bigint;
begin
  if coalesce(p_fields ->> 'path', '') !~ ('^' || p_order::text || '/[0-9a-f-]{36}\.(jpg|pdf)$') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if (select count(*) from public.order_evidence where order_id = p_order) >= 200 then raise exception 'photo_limit' using errcode = '22023'; end if;
  begin
    if (nullif(p_fields ->> 'order_item_id', '') is not null
          and not exists (select 1 from public.order_items where id = (p_fields ->> 'order_item_id')::bigint and order_id = p_order))
       or (nullif(p_fields ->> 'shipment_id', '') is not null
          and not exists (select 1 from public.shipments where id = (p_fields ->> 'shipment_id')::uuid and order_id = p_order))
       or (nullif(p_fields ->> 'return_id', '') is not null
          and not exists (select 1 from public.returns where id = (p_fields ->> 'return_id')::uuid and order_id = p_order)) then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    insert into public.order_evidence (order_id, order_item_id, shipment_id, return_id, kind, storage_path, note, uploaded_by)
    values (p_order, nullif(p_fields ->> 'order_item_id', '')::bigint, nullif(p_fields ->> 'shipment_id', '')::uuid,
      nullif(p_fields ->> 'return_id', '')::uuid, p_fields ->> 'kind', p_fields ->> 'path', nullif(btrim(p_fields ->> 'note'), ''), me)
    returning id into eid;
  exception when check_violation or unique_violation or invalid_text_representation or foreign_key_violation then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  perform private.act_team('Evidence added');
  perform private.order_event(p_order, 'evidence.added', null, p_fields ->> 'kind', false, null, jsonb_build_object('evidence', eid));
  return eid;
end;
$$;

-- A person's check of one piece. Passing needs at least one photo of the piece (product, serial,
-- document or condition) and a serial that doesn't contradict the documents.
create function public.admin_record_item_check(p_item bigint, p_fields jsonb) returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  it public.order_items;
  cid bigint;
  passed boolean := p_fields ->> 'result' = 'passed';
begin
  select * into it from public.order_items where id = p_item;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if it.stage not in ('in_hand', 'qc_failed', 'qc_passed') then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if passed and not exists (select 1 from public.order_evidence e where e.order_item_id = p_item and e.kind in ('product', 'serial', 'document', 'condition')) then
    raise exception 'photo_required' using errcode = '22023';
  end if;
  perform private.act_team(case when passed then 'Check passed' else p_fields ->> 'failure_reason' end);
  begin
    insert into public.order_item_checks (order_item_id, result, serial_reference, serial_matches, condition_confirmed, condition_notes,
      accessories, authenticity_notes, failure_reason, checked_by)
    values (p_item, p_fields ->> 'result', nullif(btrim(p_fields ->> 'serial_reference'), ''), (p_fields ->> 'serial_matches')::boolean,
      coalesce((p_fields ->> 'condition_confirmed')::boolean, false), nullif(btrim(p_fields ->> 'condition_notes'), ''),
      coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p_fields -> 'accessories', '[]')) x where btrim(x) <> '' limit 20), '{}'),
      nullif(btrim(p_fields ->> 'authenticity_notes'), ''), nullif(btrim(p_fields ->> 'failure_reason'), ''), me)
    returning id into cid;
  exception when check_violation or not_null_violation or invalid_text_representation then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  update public.order_items set stage = case when passed then 'qc_passed' else 'qc_failed' end where id = p_item;
  perform private.order_event(it.order_id, 'check.' || (p_fields ->> 'result'), it.stage, case when passed then 'qc_passed' else 'qc_failed' end,
    false, null, jsonb_build_object('item', it.description, 'check', cid));
  if not passed then perform private.notify_order(it.order_id, null, 'check_failed', 'team', cid::text); end if;
  return cid;
end;
$$;

-- Creates or updates a shipment that hasn't left yet (outbound, or the return of a return).
create function public.admin_save_shipment(p_id uuid, p_order uuid, p_fields jsonb, p_items jsonb) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  s public.shipments;
  sid uuid := p_id;
  it jsonb;
begin
  if not private.order_fields_ok(p_fields, array['direction', 'carrier', 'service', 'tracking_number', 'tracking_url', 'declared_value',
    'declared_currency', 'insurance', 'insurance_reference', 'coverage_confirmed', 'coverage_note', 'delivery_requirements', 'packed_contents', 'label_created']) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders where id = p_order and status in ('confirmed', 'processing', 'completed')) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  perform private.act_team('Shipment prepared');
  begin
    if sid is null then
      insert into public.shipments (order_id, direction, created_by) values (p_order, coalesce(nullif(p_fields ->> 'direction', ''), 'outbound'), me)
      returning id into sid;
    end if;
    select * into s from public.shipments where id = sid and order_id = p_order for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if s.status not in ('preparing', 'label_created') then raise exception 'already_dispatched' using errcode = '22023'; end if;
    update public.shipments set
      carrier = case when p_fields ? 'carrier' then nullif(btrim(p_fields ->> 'carrier'), '') else carrier end,
      service = case when p_fields ? 'service' then nullif(btrim(p_fields ->> 'service'), '') else service end,
      tracking_number = case when p_fields ? 'tracking_number' then nullif(btrim(p_fields ->> 'tracking_number'), '') else tracking_number end,
      tracking_url = case when p_fields ? 'tracking_url' then nullif(btrim(p_fields ->> 'tracking_url'), '') else tracking_url end,
      declared_value = case when p_fields ? 'declared_value' then nullif(p_fields ->> 'declared_value', '')::numeric else declared_value end,
      declared_currency = case when p_fields ? 'declared_currency' then upper(nullif(btrim(p_fields ->> 'declared_currency'), '')) else declared_currency end,
      insurance = coalesce(nullif(p_fields ->> 'insurance', ''), insurance),
      insurance_reference = case when p_fields ? 'insurance_reference' then nullif(btrim(p_fields ->> 'insurance_reference'), '') else insurance_reference end,
      coverage_confirmed = coalesce((p_fields ->> 'coverage_confirmed')::boolean, coverage_confirmed),
      coverage_note = case when p_fields ? 'coverage_note' then nullif(btrim(p_fields ->> 'coverage_note'), '') else coverage_note end,
      delivery_requirements = case when p_fields ? 'delivery_requirements' then nullif(btrim(p_fields ->> 'delivery_requirements'), '') else delivery_requirements end,
      packed_contents = case when p_fields ? 'packed_contents' then nullif(btrim(p_fields ->> 'packed_contents'), '') else packed_contents end,
      packed_by = case when p_fields ? 'packed_contents' then me else packed_by end,
      packed_at = case when p_fields ? 'packed_contents' then now() else packed_at end,
      status = case when coalesce((p_fields ->> 'label_created')::boolean, false) then 'label_created' else status end
    where id = sid;
    if p_items is not null then
      if jsonb_typeof(p_items) <> 'array' then raise exception 'invalid_request' using errcode = '22023'; end if;
      delete from public.shipment_items where shipment_id = sid;
      for it in select * from jsonb_array_elements(p_items) loop
        insert into public.shipment_items (shipment_id, order_item_id, quantity)
        select sid, i.id, coalesce((it ->> 'quantity')::integer, i.quantity) from public.order_items i
        where i.id = (it ->> 'order_item_id')::bigint and i.order_id = p_order;
        if not found then raise exception 'invalid_request' using errcode = '22023'; end if;
      end loop;
    end if;
  exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or unique_violation then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  return sid;
end;
$$;

-- The carrier has the parcel: a scan or a signed handover, with everything recorded first. Cover
-- not confirmed by the carrier needs the owner and a reason.
create function public.admin_shipment_handover(p_id uuid, p_evidence text, p_at timestamptz, p_note text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  s public.shipments;
  o public.orders;
begin
  select * into s from public.shipments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into o from public.orders where id = s.order_id for update;
  if s.status not in ('preparing', 'label_created') or p_evidence not in ('carrier_scan', 'signed_handover') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if s.carrier is null or s.tracking_number is null or s.packed_contents is null then
    raise exception 'shipment_incomplete' using errcode = '22023', hint = 'carrier, tracking and contents';
  end if;
  if not exists (select 1 from public.shipment_items where shipment_id = p_id) then
    raise exception 'shipment_incomplete' using errcode = '22023', hint = 'items';
  end if;
  if s.direction = 'outbound' then
    if s.declared_value is null or s.insurance = 'unknown' then
      raise exception 'shipment_incomplete' using errcode = '22023', hint = 'declared value and insurance';
    end if;
    if not exists (select 1 from public.order_evidence e where e.shipment_id = p_id and e.kind = 'packing') then
      raise exception 'photo_required' using errcode = '22023';
    end if;
    if exists (select 1 from public.shipment_items si join public.order_items i on i.id = si.order_item_id
               where si.shipment_id = p_id and i.stage <> 'qc_passed') then
      raise exception 'checks_missing' using errcode = '22023';
    end if;
    if not s.coverage_confirmed and (not private.is_owner() or nullif(btrim(p_note), '') is null) then
      raise exception 'coverage_unconfirmed' using errcode = '22023';
    end if;
  end if;
  perform private.act_team(coalesce(nullif(btrim(p_note), ''), 'Handed to the carrier'));
  update public.shipments set status = 'handed_over', handover_evidence = p_evidence, handed_over_at = coalesce(p_at, now()) where id = p_id;
  if s.direction = 'outbound' then
    update public.order_items set stage = 'shipped' where id in (select order_item_id from public.shipment_items where shipment_id = p_id);
    update public.orders set status = 'processing' where id = s.order_id and status = 'confirmed';
    perform private.refresh_fulfilment(s.order_id);
    perform private.notify_order(s.order_id, null, 'order_shipped', 'customer', p_id::text);
  else
    update public.returns set status = 'in_transit' where return_shipment_id = p_id and status in ('approved', 'awaiting_collection');
  end if;
end;
$$;

-- Carrier updates entered by the team (until a carrier integration sends them). Delivered needs the
-- carrier's proof (reference in the note) or, as an exception, the owner's documented reason.
create function public.admin_shipment_status(p_id uuid, p_status text, p_fields jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  s public.shipments;
  evidence text := p_fields ->> 'delivery_evidence';
begin
  select * into s from public.shipments where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if s.status in ('preparing', 'label_created', 'delivered', 'lost', 'cancelled')
     or p_status not in ('in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned_to_sender', 'lost') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if p_status = 'delivered' and (evidence not in ('carrier_proof', 'owner_exception') or nullif(btrim(p_fields ->> 'note'), '') is null) then
    raise exception 'evidence_required' using errcode = '22023';
  end if;
  if (p_status = 'lost' or evidence = 'owner_exception') and not private.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  perform private.act_team(coalesce(nullif(btrim(p_fields ->> 'note'), ''), 'Carrier update'));
  begin
    update public.shipments set
      status = p_status,
      delivered_at = case when p_status = 'delivered' then coalesce(nullif(p_fields ->> 'at', '')::timestamptz, now()) else delivered_at end,
      delivery_evidence = case when p_status = 'delivered' then evidence else delivery_evidence end,
      delivery_note = case when p_status = 'delivered' then btrim(p_fields ->> 'note') else delivery_note end,
      exception_kind = case when p_status in ('exception', 'lost') then coalesce(nullif(p_fields ->> 'exception_kind', ''), case when p_status = 'lost' then 'lost' end) else exception_kind end,
      exception_note = case when p_status in ('exception', 'lost', 'returned_to_sender') then nullif(btrim(p_fields ->> 'note'), '') else exception_note end
    where id = p_id;
  exception when check_violation or invalid_text_representation or invalid_datetime_format then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  if nullif(btrim(p_fields ->> 'public_note'), '') is not null then
    perform private.order_event(s.order_id, 'shipment.note', null, null, true, p_fields ->> 'public_note');
  end if;
  if s.direction = 'outbound' then
    if p_status = 'delivered' then
      update public.order_items set stage = 'delivered' where id in (select order_item_id from public.shipment_items where shipment_id = p_id);
      perform private.notify_order(s.order_id, null, 'order_delivered', 'customer', p_id::text);
    end if;
    if p_status in ('exception', 'lost', 'returned_to_sender') then
      perform private.notify_order(s.order_id, null, 'shipment_exception', 'team', p_id::text || ':' || p_status);
    end if;
    perform private.refresh_fulfilment(s.order_id);
  elsif p_status = 'delivered' then
    update public.returns set status = 'received', received_at = now(), received_by = me
    where return_shipment_id = p_id and status in ('approved', 'awaiting_collection', 'in_transit');
  end if;
end;
$$;

-- Collection in Dubai: the customer took the pieces, with what was checked recorded.
create function public.admin_record_collection(p_id uuid, p_note text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.status not in ('confirmed', 'processing') or o.delivery_mode <> 'collect' or nullif(btrim(p_note), '') is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if exists (select 1 from public.order_items where order_id = p_id and stage not in ('qc_passed', 'cancelled')) then
    raise exception 'checks_missing' using errcode = '22023';
  end if;
  perform private.act_team(p_note);
  update public.order_items set stage = 'collected' where order_id = p_id and stage = 'qc_passed';
  perform private.order_event(p_id, 'collection.done', null, null, true, null, jsonb_build_object('note', p_note));
  perform private.refresh_fulfilment(p_id);
end;
$$;

-- A refund the owner approves, against one captured payment, up to what is left of it.
create function public.admin_create_refund(p_order uuid, p_fields jsonb) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  pay public.payments;
  rf public.refunds;
  amt numeric;
  left_to_refund numeric;
begin
  select * into rf from public.refunds where idempotency_key = p_fields ->> 'idempotency_key';
  if found then return rf.id; end if;
  select * into pay from public.payments where id = (p_fields ->> 'payment_id')::uuid and order_id = p_order for update;
  if not found or pay.status <> 'succeeded' then raise exception 'invalid_request' using errcode = '22023', hint = 'payment'; end if;
  amt := coalesce(nullif(p_fields ->> 'items_amount', '')::numeric, 0) + coalesce(nullif(p_fields ->> 'shipping_amount', '')::numeric, 0)
       + coalesce(nullif(p_fields ->> 'vat_amount', '')::numeric, 0) - coalesce(nullif(p_fields ->> 'deduction_amount', '')::numeric, 0);
  left_to_refund := pay.amount - coalesce((select sum(amount) from public.refunds where payment_id = pay.id and status in ('approved', 'pending', 'succeeded')), 0);
  if amt > left_to_refund then raise exception 'refund_exceeds_payment' using errcode = '22023', hint = left_to_refund::text; end if;
  if nullif(p_fields ->> 'return_id', '') is not null and not exists (
    select 1 from public.returns where id = (p_fields ->> 'return_id')::uuid and order_id = p_order and status in ('received', 'inspected', 'approved', 'awaiting_collection', 'in_transit')) then
    raise exception 'invalid_request' using errcode = '22023', hint = 'return';
  end if;
  perform private.act_team(p_fields ->> 'reason');
  begin
    insert into public.refunds (order_id, payment_id, return_id, amount, currency, items_amount, shipping_amount, vat_amount,
      deduction_amount, deduction_reason, reason, route, exception_reason, approved_by, idempotency_key)
    values (p_order, pay.id, nullif(p_fields ->> 'return_id', '')::uuid, amt, pay.currency,
      coalesce(nullif(p_fields ->> 'items_amount', '')::numeric, 0), coalesce(nullif(p_fields ->> 'shipping_amount', '')::numeric, 0),
      coalesce(nullif(p_fields ->> 'vat_amount', '')::numeric, 0), coalesce(nullif(p_fields ->> 'deduction_amount', '')::numeric, 0),
      nullif(btrim(p_fields ->> 'deduction_reason'), ''), btrim(p_fields ->> 'reason'),
      coalesce(nullif(p_fields ->> 'route', ''), 'original_payment'), nullif(btrim(p_fields ->> 'exception_reason'), ''), me,
      p_fields ->> 'idempotency_key')
    returning * into rf;
  exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  perform private.refresh_payment(p_order);
  perform private.audit(me, 'refund.approved', 'order', p_order::text, null,
    jsonb_build_object('refund', rf.reference, 'amount', rf.amount, 'route', rf.route, 'reason', rf.reason));
  return rf.id;
end;
$$;

-- Refunds that don't go through the provider (bank transfer, cash, or a manual payment's refund):
-- the owner records the confirmed result, or that it failed, or cancels one not yet made.
create function public.admin_settle_refund(p_refund uuid, p_outcome text, p_note text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  rf public.refunds;
  manual boolean;
begin
  select * into rf from public.refunds where id = p_refund for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  manual := rf.route <> 'original_payment' or (select method from public.payments where id = rf.payment_id) <> 'hosted_checkout';
  if nullif(btrim(p_note), '') is null or p_outcome not in ('succeeded', 'failed', 'cancelled')
     or (p_outcome = 'cancelled' and rf.status <> 'approved')
     or (p_outcome in ('succeeded', 'failed') and (not manual or rf.status not in ('approved', 'pending'))) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform private.act_team(p_note);
  update public.refunds set status = p_outcome,
    confirmed_at = case when p_outcome = 'succeeded' then now() end,
    confirmed_by = case when p_outcome = 'succeeded' then me end,
    confirmation_note = btrim(p_note),
    failure_reason = case when p_outcome = 'failed' then left(btrim(p_note), 300) end
  where id = p_refund;
  perform private.refresh_payment(rf.order_id);
  if p_outcome = 'succeeded' then perform private.notify_order(rf.order_id, rf.return_id, 'refund_completed', 'customer', rf.id::text); end if;
  perform private.audit(me, 'refund.' || p_outcome, 'order', rf.order_id::text, null, jsonb_build_object('refund', rf.reference, 'note', p_note));
end;
$$;

-- A return opened by the team for the customer (WhatsApp, phone, in person).
create function public.admin_create_return(p_order uuid, p_fields jsonb) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  r public.returns;
  it jsonb;
  item public.order_items;
  qty integer;
begin
  if jsonb_typeof(p_fields -> 'items') <> 'array' or jsonb_array_length(p_fields -> 'items') not between 1 and 30 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform private.act_team('Return opened by the team');
  begin
    insert into public.returns (order_id, reason, description, requested_by)
    values (p_order, p_fields ->> 'reason', nullif(btrim(p_fields ->> 'description'), ''), 'team')
    returning * into r;
  exception when check_violation or not_null_violation or foreign_key_violation then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  for it in select * from jsonb_array_elements(p_fields -> 'items') loop
    select * into item from public.order_items where id = (it ->> 'order_item_id')::bigint and order_id = p_order;
    qty := coalesce((it ->> 'quantity')::integer, 1);
    if not found or item.stage not in ('delivered', 'collected') or qty < 1 or qty > item.quantity then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    insert into public.return_items (return_id, order_item_id, quantity) values (r.id, item.id, qty);
  end loop;
  return r.id;
end;
$$;

-- The owner's decision. A rejection gives the reason and how to escalate it.
create function public.admin_decide_return(p_id uuid, p_fields jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  r public.returns;
  approve boolean := (p_fields ->> 'approve')::boolean;
begin
  select * into r from public.returns where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if approve is null then raise exception 'invalid_request' using errcode = '22023'; end if;
  perform private.act_team(coalesce(nullif(btrim(p_fields ->> 'decision_reason'), ''), case when approve then 'Return approved' end));
  begin
    update public.returns set
      status = case when approve then 'approved'::public.return_status else 'rejected'::public.return_status end,
      decided_by = me, decided_at = now(),
      decision_reason = nullif(btrim(p_fields ->> 'decision_reason'), ''),
      support_path = nullif(btrim(p_fields ->> 'support_path'), ''),
      collection_method = case when approve then nullif(p_fields ->> 'collection_method', '') else collection_method end,
      return_cost = case when approve then nullif(p_fields ->> 'return_cost', '')::numeric else return_cost end,
      return_cost_paid_by = case when approve then nullif(p_fields ->> 'return_cost_paid_by', '') else return_cost_paid_by end
    where id = p_id;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  perform private.notify_order(r.order_id, p_id, case when approve then 'return_approved' else 'return_rejected' end, 'customer', p_id::text || ':' || now()::text);
  perform private.audit(me, case when approve then 'return.approved' else 'return.rejected' end, 'return', p_id::text, null, p_fields);
end;
$$;

-- Return logistics: under review, collection booked, on its way, received.
create function public.admin_return_status(p_id uuid, p_status text, p_fields jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  r public.returns;
begin
  select * into r from public.returns where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status not in ('under_review', 'awaiting_collection', 'in_transit', 'received') then raise exception 'invalid_transition' using errcode = '22023'; end if;
  perform private.act_team(coalesce(nullif(btrim(p_fields ->> 'note'), ''), 'Return updated'));
  update public.returns set
    status = p_status::public.return_status,
    return_shipment_id = coalesce(nullif(p_fields ->> 'return_shipment_id', '')::uuid, return_shipment_id),
    received_at = case when p_status = 'received' then now() else received_at end,
    received_by = case when p_status = 'received' then me else received_by end
  where id = p_id;
end;
$$;

-- Inspection of what came back: condition and identity (serial / reference against the piece sold).
create function public.admin_inspect_return(p_id uuid, p_fields jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  r public.returns;
begin
  select * into r from public.returns where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'received' or (p_fields ->> 'identity_matches') is null or nullif(p_fields ->> 'inspection_result', '') is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.order_evidence e where e.return_id = p_id and e.kind in ('inspection', 'return')) then
    raise exception 'photo_required' using errcode = '22023';
  end if;
  perform private.act_team('Return inspected');
  begin
    update public.returns set status = 'inspected', inspection_result = p_fields ->> 'inspection_result',
      identity_matches = (p_fields ->> 'identity_matches')::boolean, inspection_notes = nullif(btrim(p_fields ->> 'inspection_notes'), ''),
      inspected_by = me, inspected_at = now()
    where id = p_id;
  exception when check_violation or invalid_text_representation then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  perform private.notify_order(r.order_id, p_id, 'return_inspected', 'team', p_id::text);
end;
$$;

-- Back into stock: only after an inspection that found the piece as described and the same piece.
create function public.admin_restock_return(p_id uuid) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  r public.returns;
begin
  select * into r from public.returns where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status not in ('inspected', 'resolved') or r.inspection_result <> 'as_described' or not r.identity_matches or r.restocked_at is not null then
    raise exception 'not_restockable' using errcode = '22023';
  end if;
  perform private.act_team('Returned piece restocked');
  perform private.restock(ri.order_item_id, ri.quantity) from public.return_items ri where ri.return_id = p_id;
  update public.returns set restocked_at = now(), restocked_by = me where id = p_id;
  perform private.order_event(r.order_id, 'return.restocked', null, null, false, null, jsonb_build_object('return', r.reference));
  perform private.audit(me, 'return.restocked', 'return', p_id::text, null, jsonb_build_object('return', r.reference));
end;
$$;

-- Closes a return. A refund resolution needs the refund confirmed first.
create function public.admin_resolve_return(p_id uuid, p_fields jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  r public.returns;
  res text := p_fields ->> 'resolution';
begin
  select * into r from public.returns where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'inspected' or res not in ('refund', 'replacement', 'repair', 'returned_to_customer') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if res = 'refund' and not exists (select 1 from public.refunds where return_id = p_id and status = 'succeeded') then
    raise exception 'refund_not_confirmed' using errcode = '22023';
  end if;
  if res <> 'refund' and nullif(btrim(p_fields ->> 'resolution_note'), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  perform private.act_team(coalesce(nullif(btrim(p_fields ->> 'resolution_note'), ''), 'Return resolved'));
  update public.returns set status = 'resolved', resolution = res, resolution_note = nullif(btrim(p_fields ->> 'resolution_note'), ''),
    replacement_order_id = nullif(p_fields ->> 'replacement_order_id', '')::uuid, resolved_at = now()
  where id = p_id;
  perform private.notify_order(r.order_id, p_id, 'return_resolved', 'customer', p_id::text);
  perform private.audit(me, 'return.resolved', 'return', p_id::text, null, p_fields);
end;
$$;

-- An update the customer sees on their order page (e.g. why a delivery is late), and a reply to
-- their messages.
create function public.admin_post_order_update(p_order uuid, p_public_note text, p_reply boolean) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  mid bigint;
begin
  if nullif(btrim(p_public_note), '') is null or not exists (select 1 from public.orders where id = p_order) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform private.act_team('Update for the customer');
  if p_reply then
    insert into public.order_messages (order_id, from_customer, body, author_id) values (p_order, false, btrim(p_public_note), me) returning id into mid;
    update public.order_messages set handled_by = me, handled_at = now() where order_id = p_order and from_customer and handled_at is null;
  else
    perform private.order_event(p_order, 'order.note', null, null, true, p_public_note);
  end if;
  perform private.notify_order(p_order, null, 'order_update', 'customer', p_order::text || ':' || coalesce(mid::text, now()::text));
end;
$$;

create function public.admin_mark_messages_handled(p_order uuid) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare me uuid := private.require_staff();
begin
  update public.order_messages set handled_by = me, handled_at = now() where order_id = p_order and from_customer and handled_at is null;
end;
$$;

-- A private link for the customer. The panel makes the token and shows it once; only its hash is kept.
create function public.admin_create_order_link(p_order uuid, p_token_hash text, p_days integer) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  lid uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' or coalesce(p_days, 0) not between 1 and 400
     or not exists (select 1 from public.orders where id = p_order and status <> 'draft') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  insert into public.order_access_links (order_id, token_hash, expires_at, created_by)
  values (p_order, p_token_hash, now() + make_interval(days => p_days), me) returning id into lid;
  perform private.act_team('Customer link created');
  perform private.order_event(p_order, 'link.created', null, null, false, null, jsonb_build_object('link', lid, 'days', p_days));
  return lid;
end;
$$;

create function public.admin_revoke_order_link(p_id uuid) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_staff();
  l public.order_access_links;
begin
  update public.order_access_links set revoked_at = now() where id = p_id and revoked_at is null returning * into l;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.act_team('Customer link revoked');
  perform private.order_event(l.order_id, 'link.revoked', null, null, false, null, jsonb_build_object('link', p_id));
end;
$$;

-- What needs someone, by queue (test records only when asked for).
create function public.admin_work_queues(p_include_test boolean default false) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  s public.shop_settings;
begin
  perform private.require_staff();
  select * into s from public.shop_settings;
  return jsonb_build_object(
    'awaiting_payment', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'reference', o.reference, 'since', o.quote_sent_at,
        'expires_at', o.quote_expires_at, 'expired', o.quote_expires_at < now(), 'total', o.total_amount, 'currency', o.currency, 'paid', o.amount_paid) order by o.quote_expires_at), '[]')
      from public.orders o where o.status = 'awaiting_confirmation' and (p_include_test or not o.is_test)),
    'paid_not_confirmed', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'reference', o.reference)), '[]')
      from public.orders o where o.status = 'awaiting_confirmation' and o.amount_paid >= o.total_amount and (p_include_test or not o.is_test)),
    'payments_to_verify', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'order_id', p.order_id, 'reference', o.reference,
        'amount', p.amount, 'currency', p.currency, 'method', p.method, 'at', p.created_at)), '[]')
      from public.payments p join public.orders o on o.id = p.order_id
      where p.status = 'pending' and p.method <> 'hosted_checkout' and (p_include_test or not o.is_test)),
    'payment_discrepancies', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'order_id', e.order_id, 'type', e.type, 'detail', e.detail, 'at', e.received_at) order by e.received_at desc), '[]')
      from public.payment_events e where e.outcome = 'discrepancy' and e.resolved_at is null),
    'sourcing', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'order_id', t.order_id, 'reference', o.reference, 'item', i.description,
        'status', t.status, 'confirm_by', t.confirm_by, 'overdue', t.status in ('open', 'supplier_contacted') and t.confirm_by < now(),
        'expected_at', t.expected_at, 'late', t.expected_at < current_date) order by t.confirm_by), '[]')
      from public.sourcing_tasks t join public.orders o on o.id = t.order_id join public.order_items i on i.id = t.order_item_id
      where t.status in ('open', 'supplier_contacted', 'supplier_confirmed', 'on_the_way') and (p_include_test or not o.is_test)),
    'supplier_failed', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'order_id', t.order_id, 'reference', o.reference, 'item', i.description, 'reason', t.failure_reason)), '[]')
      from public.sourcing_tasks t join public.orders o on o.id = t.order_id join public.order_items i on i.id = t.order_item_id
      where t.status = 'failed' and i.stage = 'sourcing' and o.status not in ('cancelled', 'completed') and (p_include_test or not o.is_test)
        and not exists (select 1 from public.sourcing_tasks t2 where t2.order_item_id = t.order_item_id and t2.status not in ('failed', 'cancelled'))),
    'checks_to_do', (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'reference', o.reference, 'item', i.description, 'stage', i.stage)), '[]')
      from public.order_items i join public.orders o on o.id = i.order_id
      where i.stage in ('in_hand', 'qc_failed') and o.status in ('confirmed', 'processing') and (p_include_test or not o.is_test)),
    'overdue_dispatch', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'reference', o.reference, 'confirmed_at', o.confirmed_at, 'stage', o.fulfilment_status)), '[]')
      from public.orders o where o.status in ('confirmed', 'processing') and (p_include_test or not o.is_test)
        and o.fulfilment_status in ('quality_check', 'packed', 'ready_to_dispatch')
        and not exists (select 1 from public.order_items i where i.order_id = o.id and i.stage in ('pending', 'sourcing'))
        and coalesce((select max(t.updated_at) from public.sourcing_tasks t where t.order_id = o.id and t.status = 'received'), o.confirmed_at)
            < now() - make_interval(days => s.dispatch_alert_days)),
    'shipment_exceptions', (select coalesce(jsonb_agg(jsonb_build_object('id', sh.id, 'order_id', sh.order_id, 'reference', o.reference, 'status', sh.status,
        'kind', sh.exception_kind, 'note', sh.exception_note)), '[]')
      from public.shipments sh join public.orders o on o.id = sh.order_id
      where sh.status in ('exception', 'returned_to_sender', 'lost') and o.status not in ('cancelled') and (p_include_test or not o.is_test)
        and not (sh.status = 'lost' and o.status = 'completed')),
    'customer_messages', (select coalesce(jsonb_agg(jsonb_build_object('order_id', m.order_id, 'reference', o.reference, 'kind', m.kind, 'at', m.created_at, 'body', left(m.body, 160)) order by m.created_at), '[]')
      from public.order_messages m join public.orders o on o.id = m.order_id where m.from_customer and m.handled_at is null and (p_include_test or not o.is_test)),
    'return_reviews', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'order_id', r.order_id, 'reference', r.reference, 'reason', r.reason, 'at', r.created_at, 'status', r.status) order by r.created_at), '[]')
      from public.returns r join public.orders o on o.id = r.order_id where r.status in ('requested', 'under_review') and (p_include_test or not o.is_test)),
    'returns_in_progress', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'order_id', r.order_id, 'reference', r.reference, 'status', r.status) order by r.updated_at), '[]')
      from public.returns r join public.orders o on o.id = r.order_id where r.status in ('approved', 'awaiting_collection', 'in_transit', 'received', 'inspected') and (p_include_test or not o.is_test)),
    'refunds_owed', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'reference', o.reference, 'paid', o.amount_paid, 'refunded', o.amount_refunded, 'currency', o.currency)), '[]')
      from public.orders o where o.status = 'cancelled' and o.amount_paid > o.amount_refunded and (p_include_test or not o.is_test)
        and not exists (select 1 from public.refunds r where r.order_id = o.id and r.status in ('approved', 'pending'))),
    'refunds_open', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'order_id', r.order_id, 'reference', r.reference, 'status', r.status,
        'amount', r.amount, 'currency', r.currency, 'since', r.approved_at, 'reason', r.failure_reason) order by r.approved_at), '[]')
      from public.refunds r join public.orders o on o.id = r.order_id where r.status in ('approved', 'pending', 'failed') and (p_include_test or not o.is_test)
        and not (r.status = 'failed' and exists (select 1 from public.refunds r2 where r2.order_id = r.order_id and r2.created_at > r.created_at)))
  );
end;
$$;

create or replace function public.admin_dashboard() returns jsonb
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
    'open_orders', (select count(*) from public.orders where status in ('awaiting_confirmation', 'confirmed', 'processing') and not is_test),
    'last_7_days', (select count(*) from public.requests where created_at > now() - interval '7 days' and not is_test),
    'notifications_failed', (select count(*) from public.notifications n
                              left join public.requests r on r.id = n.request_id left join public.orders o on o.id = n.order_id
                              where n.status = 'failed' and not coalesce(r.is_test, o.is_test, false)),
    'test_records', (select count(*) from public.requests where is_test)
  );
end;
$$;

-- Order checks in the chat: drafts are not shown either.
create or replace function public.concierge_order_challenge(p_key text, p_conversation uuid, p_token_hash text, p_order_ref text, p_code_hash text)
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
  where upper(reference) = upper(btrim(p_order_ref)) and status not in ('draft', 'cancelled') and contact_email is not null;
  if not found then return null; end if;
  perform private.hit('order_challenge_order', o.id::text, 5, interval '1 hour');
  insert into public.order_access_challenges (order_id, conversation_id, code_hash) values (o.id, c.id, p_code_hash);
  return o.contact_email;
end;
$$;

-- The chat's order check: carrier and tracking come from the latest parcel that has left (the order's
-- own carrier fields are from the first panel version). Same keys as before.
create or replace function public.concierge_order_verify(p_key text, p_conversation uuid, p_token_hash text, p_order_ref text, p_code_hash text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.conversations;
  ch public.order_access_challenges;
  o public.orders;
  s public.shipments;
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
  select * into s from public.shipments where order_id = o.id and direction = 'outbound' and status not in ('preparing', 'label_created', 'cancelled')
  order by handed_over_at desc nulls last, created_at desc limit 1;
  -- Only what the customer may see: no internal notes, no staff, no other customers.
  return jsonb_build_object('ok', true, 'order', jsonb_build_object(
    'reference', o.reference, 'status', o.status, 'currency', o.currency, 'total_amount', o.total_amount,
    'payment_status', o.payment_status, 'fulfilment_status', o.fulfilment_status,
    'carrier', coalesce(s.carrier, o.carrier), 'tracking_number', coalesce(s.tracking_number, o.tracking_number),
    'tracking_url', coalesce(s.tracking_url, o.tracking_url), 'customer_note', o.customer_note,
    'updated_at', o.updated_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'brand', i.brand, 'quantity', i.quantity) order by i.position, i.id)
                       from public.order_items i where i.order_id = o.id), '[]'::jsonb)
  ));
end;
$$;

-- The outbox now carries order and return messages too (request alerts are unchanged).
create or replace function public.concierge_claim_notifications(p_key text, p_configured text[], p_ids uuid[], p_limit integer)
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
    'id', cl.id, 'channel', cl.channel, 'attempts', cl.attempts, 'template', cl.template, 'recipient', cl.recipient,
    'request', case when r.id is not null then jsonb_build_object('id', r.id, 'reference', r.reference, 'type', r.type, 'locale', r.locale,
      'needs_review', r.needs_review, 'destination_label', r.destination_label, 'created_at', r.created_at, 'is_test', r.is_test) end,
    'order', case when o.id is not null then jsonb_build_object('id', o.id, 'reference', o.reference, 'status', o.status,
      'payment_status', o.payment_status, 'fulfilment_status', o.fulfilment_status, 'total_amount', o.total_amount, 'currency', o.currency,
      'customer_name', c.name, 'is_test', o.is_test,
      -- Only a customer message carries the customer's address.
      'email', case when cl.recipient = 'customer' then o.contact_email end) end,
    'return', case when rt.id is not null then jsonb_build_object('reference', rt.reference, 'status', rt.status, 'reason', rt.reason,
      'decision_reason', case when rt.status = 'rejected' then rt.decision_reason end,
      'support_path', case when rt.status = 'rejected' then rt.support_path end) end
  )), '[]'::jsonb) into result
  from claimed cl
  left join public.requests r on r.id = cl.request_id
  left join public.orders o on o.id = cl.order_id
  left join public.customers c on c.id = o.customer_id
  left join public.returns rt on rt.id = cl.return_id;
  return result;
end;
$$;

-- A fresh private link for the customer e-mail being sent now (tokens are never stored, so an
-- e-mail can't reuse an earlier one). Works only for a customer notification that is being sent.
create function public.concierge_issue_customer_link(p_key text, p_notification uuid, p_token_hash text) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare n public.notifications;
begin
  perform private.assert_server_key(p_key);
  select * into n from public.notifications where id = p_notification and recipient = 'customer' and status = 'sending' and order_id is not null;
  if not found or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_request' using errcode = '22023'; end if;
  insert into public.order_access_links (order_id, token_hash, expires_at) values (n.order_id, p_token_hash, now() + interval '60 days');
end;
$$;

-- ── Storage: private bucket for order evidence ───────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-evidence', 'order-evidence', false, 8000000, array['image/jpeg', 'application/pdf'])
on conflict (id) do nothing;

create policy "Team can see order evidence files" on storage.objects for select to authenticated
  using (bucket_id = 'order-evidence' and private.is_staff());
create policy "Team can upload order evidence" on storage.objects for insert to authenticated
  with check (bucket_id = 'order-evidence' and private.is_staff());

-- ── Row-level security and grants ─────────────────────────────────────────────────────

alter table public.shop_settings enable row level security;
alter table public.shipping_zones enable row level security;
alter table public.shipping_zone_countries enable row level security;
alter table public.policy_versions enable row level security;
alter table public.order_events enable row level security;
alter table public.order_policy_acceptances enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.payment_events enable row level security;
alter table public.stock_reservations enable row level security;
alter table public.sourcing_tasks enable row level security;
alter table public.order_item_checks enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_items enable row level security;
alter table public.returns enable row level security;
alter table public.return_items enable row level security;
alter table public.order_evidence enable row level security;
alter table public.order_messages enable row level security;
alter table public.order_access_links enable row level security;

revoke all on
  public.shop_settings, public.shipping_zones, public.shipping_zone_countries, public.policy_versions, public.order_events,
  public.order_policy_acceptances, public.payments, public.refunds, public.payment_events, public.stock_reservations,
  public.sourcing_tasks, public.order_item_checks, public.shipments, public.shipment_items, public.returns, public.return_items,
  public.order_evidence, public.order_messages, public.order_access_links
from anon, authenticated;

grant select on
  public.shop_settings, public.shipping_zones, public.shipping_zone_countries, public.policy_versions, public.order_events,
  public.order_policy_acceptances, public.payments, public.refunds, public.payment_events, public.stock_reservations,
  public.sourcing_tasks, public.order_item_checks, public.shipments, public.shipment_items, public.returns, public.return_items,
  public.order_evidence, public.order_messages
to authenticated;
-- Tokens stay private: the team sees when a link was made and used, not its hash.
grant select (id, order_id, expires_at, revoked_at, last_used_at, created_by, created_at) on public.order_access_links to authenticated;
-- The website shows approved policy texts with the public key.
grant select on public.policy_versions to anon;

create policy "Team can read shop settings" on public.shop_settings for select to authenticated using (private.is_staff());
create policy "Team can read shipping zones" on public.shipping_zones for select to authenticated using (private.is_staff());
create policy "Team can read zone countries" on public.shipping_zone_countries for select to authenticated using (private.is_staff());
create policy "Approved policies are public; team sees all" on public.policy_versions for select to anon, authenticated
  using (status = 'approved' or private.is_staff());
create policy "Team can read order events" on public.order_events for select to authenticated using (private.is_staff());
create policy "Team can read policy acceptances" on public.order_policy_acceptances for select to authenticated using (private.is_staff());
create policy "Team can read payments" on public.payments for select to authenticated using (private.is_staff());
create policy "Team can read refunds" on public.refunds for select to authenticated using (private.is_staff());
create policy "Team can read payment events" on public.payment_events for select to authenticated using (private.is_staff());
create policy "Team can read stock holds" on public.stock_reservations for select to authenticated using (private.is_staff());
create policy "Team can read sourcing" on public.sourcing_tasks for select to authenticated using (private.is_staff());
create policy "Team can read checks" on public.order_item_checks for select to authenticated using (private.is_staff());
create policy "Team can read shipments" on public.shipments for select to authenticated using (private.is_staff());
create policy "Team can read shipment items" on public.shipment_items for select to authenticated using (private.is_staff());
create policy "Team can read returns" on public.returns for select to authenticated using (private.is_staff());
create policy "Team can read return items" on public.return_items for select to authenticated using (private.is_staff());
create policy "Team can read evidence" on public.order_evidence for select to authenticated using (private.is_staff());
create policy "Team can read order messages" on public.order_messages for select to authenticated using (private.is_staff());
create policy "Team can read customer links" on public.order_access_links for select to authenticated using (private.is_staff());

revoke execute on function
  private.act(text, text), private.act_team(text), private.order_event(uuid, text, text, text, boolean, text, jsonb),
  private.orders_guard(), private.orders_history(), private.own_stock(bigint), private.free_stock(text, bigint, uuid),
  private.reserve_stock(uuid, integer), private.release_stock(uuid, text), private.consume_stock(uuid), private.restock(bigint, integer),
  private.notify_order(uuid, uuid, text, text, text), private.payments_history(), private.refunds_history(), private.shipments_history(),
  private.returns_guard(), private.returns_history(), private.recompute_totals(uuid), private.refresh_payment(uuid),
  private.confirm_order(uuid, text), private.refresh_fulfilment(uuid), private.price_bag(jsonb, text, text), private.required_policies(),
  private.customer_view(uuid), private.order_for_link(text), private.write_items(uuid, jsonb), private.order_fields_ok(jsonb, text[])
from public, anon, authenticated;

revoke execute on function
  public.shop_price_bag(text, jsonb, text, text), public.shop_start_checkout(text, jsonb),
  public.payments_session_created(text, uuid, text, text, timestamptz), public.payments_apply_event(text, jsonb),
  public.payments_refund_submitted(text, uuid, text, text), public.payments_refunds_to_submit(text),
  public.shop_order_view(text, text, text), public.shop_order_accept_quote(text, text), public.shop_order_payment(text, text, text),
  public.shop_order_request_return(text, text, jsonb), public.shop_order_message(text, text, text, text), public.shop_housekeeping(text),
  public.concierge_issue_customer_link(text, uuid, text),
  public.admin_save_shop_settings(jsonb), public.admin_save_shipping_zone(bigint, jsonb, text[]), public.admin_save_policy(bigint, jsonb),
  public.admin_set_policy_status(bigint, text), public.admin_create_order(jsonb), public.admin_update_order(uuid, jsonb, text),
  public.admin_send_quote(uuid, integer), public.admin_reopen_quote(uuid, text), public.admin_confirm_order(uuid, text),
  public.admin_set_item_availability(bigint, text, text), public.admin_record_payment(uuid, jsonb), public.admin_verify_payment(uuid, boolean, text),
  public.admin_resolve_payment_event(bigint, text), public.admin_cancel_order(uuid, text, text), public.admin_set_fulfilment_stage(uuid, text, text),
  public.admin_update_sourcing_task(bigint, jsonb), public.admin_add_sourcing_task(bigint), public.admin_add_evidence(uuid, jsonb),
  public.admin_record_item_check(bigint, jsonb), public.admin_save_shipment(uuid, uuid, jsonb, jsonb),
  public.admin_shipment_handover(uuid, text, timestamptz, text), public.admin_shipment_status(uuid, text, jsonb),
  public.admin_record_collection(uuid, text), public.admin_create_refund(uuid, jsonb), public.admin_settle_refund(uuid, text, text),
  public.admin_create_return(uuid, jsonb), public.admin_decide_return(uuid, jsonb), public.admin_return_status(uuid, text, jsonb),
  public.admin_inspect_return(uuid, jsonb), public.admin_restock_return(uuid), public.admin_resolve_return(uuid, jsonb),
  public.admin_post_order_update(uuid, text, boolean), public.admin_mark_messages_handled(uuid),
  public.admin_create_order_link(uuid, text, integer), public.admin_revoke_order_link(uuid), public.admin_work_queues(boolean)
from public, anon, authenticated;

-- The website server (anon key + server key checked inside each function).
grant execute on function
  public.shop_price_bag(text, jsonb, text, text), public.shop_start_checkout(text, jsonb),
  public.payments_session_created(text, uuid, text, text, timestamptz), public.payments_apply_event(text, jsonb),
  public.payments_refund_submitted(text, uuid, text, text), public.payments_refunds_to_submit(text),
  public.shop_order_view(text, text, text), public.shop_order_accept_quote(text, text), public.shop_order_payment(text, text, text),
  public.shop_order_request_return(text, text, jsonb), public.shop_order_message(text, text, text, text), public.shop_housekeeping(text),
  public.concierge_issue_customer_link(text, uuid, text)
to anon;

-- Signed-in accounts (role checked inside each function).
grant execute on function
  public.admin_save_shop_settings(jsonb), public.admin_save_shipping_zone(bigint, jsonb, text[]), public.admin_save_policy(bigint, jsonb),
  public.admin_set_policy_status(bigint, text), public.admin_create_order(jsonb), public.admin_update_order(uuid, jsonb, text),
  public.admin_send_quote(uuid, integer), public.admin_reopen_quote(uuid, text), public.admin_confirm_order(uuid, text),
  public.admin_set_item_availability(bigint, text, text), public.admin_record_payment(uuid, jsonb), public.admin_verify_payment(uuid, boolean, text),
  public.admin_resolve_payment_event(bigint, text), public.admin_cancel_order(uuid, text, text), public.admin_set_fulfilment_stage(uuid, text, text),
  public.admin_update_sourcing_task(bigint, jsonb), public.admin_add_sourcing_task(bigint), public.admin_add_evidence(uuid, jsonb),
  public.admin_record_item_check(bigint, jsonb), public.admin_save_shipment(uuid, uuid, jsonb, jsonb),
  public.admin_shipment_handover(uuid, text, timestamptz, text), public.admin_shipment_status(uuid, text, jsonb),
  public.admin_record_collection(uuid, text), public.admin_create_refund(uuid, jsonb), public.admin_settle_refund(uuid, text, text),
  public.admin_create_return(uuid, jsonb), public.admin_decide_return(uuid, jsonb), public.admin_return_status(uuid, text, jsonb),
  public.admin_inspect_return(uuid, jsonb), public.admin_restock_return(uuid), public.admin_resolve_return(uuid, jsonb),
  public.admin_post_order_update(uuid, text, boolean), public.admin_mark_messages_handled(uuid),
  public.admin_create_order_link(uuid, text, integer), public.admin_revoke_order_link(uuid), public.admin_work_queues(boolean)
to authenticated;
