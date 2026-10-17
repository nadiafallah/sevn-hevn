-- Rollback for 20261017120000_journal.sql.
-- DELETES EVERY JOURNAL ARTICLE, RUN, STEP AND LESSON. Export the journal_posts table first
-- (Supabase → Table editor → journal_posts → Export) and get the owner's written approval.
-- Also remove the pipeline's key: delete from private.server_keys where name = 'journal';

drop function if exists public.admin_journal_delete_lesson(uuid);
drop function if exists public.admin_journal_delete(uuid);
drop function if exists public.admin_journal_update(uuid, jsonb);
drop function if exists public.admin_journal_set_status(uuid, public.journal_post_status);
drop function if exists public.journal_delete_lesson(text, uuid);
drop function if exists public.journal_apply_lessons(text, uuid, jsonb, uuid[]);
drop function if exists public.journal_finish_run(text, uuid, jsonb);
drop function if exists public.journal_save_post(text, uuid, jsonb);
drop function if exists public.journal_save_step(text, uuid, jsonb);
drop function if exists public.journal_start_run(text);
drop function if exists public.journal_context(text);
drop function if exists private.journal_open_run(uuid);
drop function if exists private.assert_journal_key(text);
drop table if exists public.journal_lessons;
drop table if exists public.journal_posts;
drop table if exists public.journal_steps;
drop table if exists public.journal_runs;
drop type if exists public.journal_post_status;
