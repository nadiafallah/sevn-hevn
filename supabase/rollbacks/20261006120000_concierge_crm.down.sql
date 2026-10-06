-- Rolls back 20261006120000_concierge_crm.sql.
--
-- WARNING: this permanently deletes every concierge request, customer, conversation, order,
-- note, knowledge entry and audit row. Export first (panel → Settings → Export, owner only) and
-- empty the "request-photos" bucket in Storage (Supabase blocks deleting a non-empty bucket).
-- Never run it against production without the owner's written approval.
--
-- Run in the Supabase SQL editor, then delete the migration row:
--   delete from supabase_migrations.schema_migrations where version = '20261006120000';
-- and deploy a website version without the concierge code (or the site will show the chat as
-- unavailable, which is safe).

begin;

drop policy if exists "Website uploads into an open photo slot" on storage.objects;
drop policy if exists "Team can view request photos" on storage.objects;
drop policy if exists "Owner can delete request photos" on storage.objects;
delete from storage.buckets where id = 'request-photos';

drop function if exists
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
  public.admin_list_requests(text, text, text, uuid, text, text, boolean, boolean, integer, integer);

drop table if exists
  public.audit_log, public.notifications, public.knowledge_entries, public.order_access_challenges,
  public.order_items, public.orders, public.price_approvals, public.request_notes, public.request_photos,
  public.requests, public.conversation_messages, public.conversations, public.customers, public.staff_members
cascade;

drop type if exists public.knowledge_status, public.fulfilment_status, public.payment_status, public.order_status,
  public.request_status, public.request_type, public.staff_role;

drop schema if exists private cascade;

commit;
