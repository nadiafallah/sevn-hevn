-- Rollback for 20261014120000_newsletter.sql.
-- DELETES THE NEWSLETTER LIST. Export it first (Supabase → Table editor → newsletter_subscribers →
-- Export) and get the owner's written approval before running this.

drop trigger if exists newsletter_rate_limit on public.newsletter_subscribers;
drop function if exists public.newsletter_rate_limit();
drop table if exists public.newsletter_subscribers;
