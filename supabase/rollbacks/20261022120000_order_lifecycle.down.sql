-- Rollback of 20261022120000_order_lifecycle.sql.
--
-- Removes quotes, payments, refunds, stock holds, sourcing, checks, shipments, returns, evidence,
-- messages, customer links, settings, zones and policies, with their data. Export what you need
-- first (Orders → Export). Orders and their lines stay, and their status is mapped back to the
-- first panel version (open / completed / cancelled; the last known payment and delivery status).
-- Files in the "order-evidence" bucket are not deleted by SQL: remove them in Storage.

-- ── Functions ─────────────────────────────────────────────────────────────────────────

drop function if exists
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
  public.admin_create_order_link(uuid, text, integer), public.admin_revoke_order_link(uuid), public.admin_work_queues(boolean);

drop trigger if exists orders_guard on public.orders;
drop trigger if exists orders_history on public.orders;

-- ── Tables ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Team can see order evidence files" on storage.objects;
drop policy if exists "Team can upload order evidence" on storage.objects;

delete from public.notifications where request_id is null;
alter table public.notifications
  drop constraint if exists notifications_subject,
  drop constraint if exists notifications_customer_email,
  drop column if exists order_id, drop column if exists return_id, drop column if exists template,
  drop column if exists recipient, drop column if exists dedupe_key,
  alter column request_id set not null;

drop table if exists
  public.order_access_links, public.order_messages, public.order_evidence, public.return_items, public.refunds, public.returns,
  public.shipment_items, public.shipments, public.order_item_checks, public.sourcing_tasks, public.stock_reservations,
  public.payment_events, public.payments, public.order_policy_acceptances, public.order_events, public.policy_versions,
  public.shipping_zone_countries, public.shipping_zones, public.shop_settings;
drop type if exists public.return_status;

drop function if exists
  private.act(text, text), private.act_team(text), private.order_event(uuid, text, text, text, boolean, text, jsonb),
  private.orders_guard(), private.orders_history(), private.own_stock(bigint), private.free_stock(text, bigint, uuid),
  private.reserve_stock(uuid, integer), private.release_stock(uuid, text), private.consume_stock(uuid), private.restock(bigint, integer),
  private.notify_order(uuid, uuid, text, text, text), private.payments_history(), private.refunds_history(), private.shipments_history(),
  private.returns_guard(), private.returns_history(), private.recompute_totals(uuid), private.refresh_payment(uuid),
  private.confirm_order(uuid, text), private.refresh_fulfilment(uuid), private.price_bag(jsonb, text, text), private.required_policies(),
  private.customer_view(uuid), private.order_for_link(text), private.write_items(uuid, jsonb), private.order_fields_ok(jsonb, text[]);

-- ── Orders: back to the first panel version ──────────────────────────────────────────

alter table public.order_items
  drop column if exists sku, drop column if exists variant_id, drop column if exists options, drop column if exists availability,
  drop column if exists condition, drop column if exists condition_notes, drop column if exists included, drop column if exists stage;

-- Orders without a total (draft quotes) or an approver can't be kept in the old shape.
delete from public.orders where total_amount is null;
update public.orders set amount_approved_by = coalesce(amount_approved_by, created_by, (select id from public.staff_members where role = 'owner' order by created_at limit 1)),
  amount_approved_at = coalesce(amount_approved_at, created_at);

alter table public.orders
  drop constraint if exists orders_total_before_sending, drop constraint if exists orders_estimate_order,
  drop column if exists channel, drop column if exists amount_source, drop column if exists assigned_to, drop column if exists subtotal_amount,
  drop column if exists discount_amount, drop column if exists shipping_amount, drop column if exists vat_amount, drop column if exists vat_rate_percent,
  drop column if exists prices_include_vat, drop column if exists vat_treatment, drop column if exists duties_treatment, drop column if exists duties_note,
  drop column if exists delivery_mode, drop column if exists shipping_country, drop column if exists shipping_address, drop column if exists recipient_name,
  drop column if exists recipient_phone, drop column if exists sourcing_eta, drop column if exists transit_days_min, drop column if exists transit_days_max,
  drop column if exists delivery_estimate_from, drop column if exists delivery_estimate_to, drop column if exists delivery_estimate_note,
  drop column if exists quote_sent_at, drop column if exists quote_expires_at, drop column if exists accepted_at, drop column if exists cancellation_terms,
  drop column if exists amount_paid, drop column if exists amount_refunded, drop column if exists confirmed_at, drop column if exists completed_at,
  drop column if exists cancelled_at, drop column if exists cancel_reason, drop column if exists idempotency_key;
drop index if exists public.orders_status_idx;

alter table public.orders
  alter column total_amount set not null,
  alter column amount_approved_by set not null,
  alter column amount_approved_at set not null,
  alter column amount_approved_at set default now();

alter type public.order_status rename to order_status_v2;
alter type public.payment_status rename to payment_status_v2;
alter type public.fulfilment_status rename to fulfilment_status_v2;
create type public.order_status as enum ('open', 'completed', 'cancelled');
create type public.payment_status as enum ('unpaid', 'partially_paid', 'paid', 'refunded');
create type public.fulfilment_status as enum ('not_started', 'preparing', 'ready', 'shipped', 'delivered', 'collected', 'cancelled');

alter table public.orders
  alter column status drop default, alter column payment_status drop default, alter column fulfilment_status drop default;
alter table public.orders
  alter column status type public.order_status using (case status::text
    when 'completed' then 'completed' when 'cancelled' then 'cancelled' else 'open' end)::public.order_status,
  alter column payment_status type public.payment_status using (case payment_status::text
    when 'deposit_paid' then 'partially_paid' when 'paid' then 'paid' when 'partially_refunded' then 'paid' when 'refund_pending' then 'paid'
    when 'refund_failed' then 'paid' when 'refunded' then 'refunded' else 'unpaid' end)::public.payment_status,
  alter column fulfilment_status type public.fulfilment_status using (case fulfilment_status::text
    when 'awaiting_stock' then 'preparing' when 'sourcing' then 'preparing' when 'quality_check' then 'preparing' when 'packed' then 'ready'
    when 'ready_to_dispatch' then 'ready' when 'shipped' then 'shipped' when 'in_transit' then 'shipped' when 'out_for_delivery' then 'shipped'
    when 'delivery_exception' then 'shipped' when 'returned_to_sender' then 'shipped' when 'delivered' then 'delivered'
    when 'collected' then 'collected' else 'not_started' end)::public.fulfilment_status;
alter table public.orders
  alter column status set default 'open', alter column payment_status set default 'unpaid', alter column fulfilment_status set default 'not_started';
drop type public.order_status_v2;
drop type public.payment_status_v2;
drop type public.fulfilment_status_v2;

-- ── The first panel's order functions (from 20261006120000_concierge_crm.sql) ────────

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
    'open_orders', (select count(*) from public.orders where status = 'open' and not is_test),
    'last_7_days', (select count(*) from public.requests where created_at > now() - interval '7 days' and not is_test),
    'notifications_failed', (select count(*) from public.notifications n join public.requests r on r.id = n.request_id
                              where n.status = 'failed' and not r.is_test),
    'test_records', (select count(*) from public.requests where is_test)
  );
end;
$$;

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
  where upper(reference) = upper(btrim(p_order_ref)) and status <> 'cancelled' and contact_email is not null;
  if not found then return null; end if;
  perform private.hit('order_challenge_order', o.id::text, 5, interval '1 hour');
  insert into public.order_access_challenges (order_id, conversation_id, code_hash) values (o.id, c.id, p_code_hash);
  return o.contact_email;
end;
$$;

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
    'id', cl.id, 'channel', cl.channel, 'attempts', cl.attempts,
    'request', jsonb_build_object('id', r.id, 'reference', r.reference, 'type', r.type, 'locale', r.locale,
      'needs_review', r.needs_review, 'destination_label', r.destination_label, 'created_at', r.created_at, 'is_test', r.is_test)
  )), '[]'::jsonb) into result
  from claimed cl join public.requests r on r.id = cl.request_id;
  return result;
end;
$$;

create or replace function public.concierge_order_verify(p_key text, p_conversation uuid, p_token_hash text, p_order_ref text, p_code_hash text)
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

revoke execute on function
  public.admin_create_order(uuid, uuid, text, numeric, jsonb, text, text, text), public.admin_update_order(uuid, jsonb)
from public, anon, authenticated;
grant execute on function
  public.admin_create_order(uuid, uuid, text, numeric, jsonb, text, text, text), public.admin_update_order(uuid, jsonb)
to authenticated;

delete from supabase_migrations.schema_migrations where version = '20261022120000';
