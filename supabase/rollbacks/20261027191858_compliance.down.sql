-- Rollback for 20261027191858_compliance.sql.
-- DELETES THE WHOLE COMPLIANCE LEDGER: every rule, source, monitor run and pending change.
-- Export the four compliance_* tables first (Supabase → Table editor → Export) and get the
-- owner's written approval. Also pause the "Seven Heaven compliance monitor" scheduled task,
-- or its next run will fail.

drop function if exists public.admin_compliance_decide(uuid, public.compliance_change_status, text);
drop function if exists private.compliance_decide(uuid, public.compliance_change_status, uuid, text);
drop table if exists public.compliance_changes;
drop table if exists public.compliance_runs;
drop table if exists public.compliance_rules;
drop table if exists public.compliance_sources;
drop type if exists public.compliance_change_status;
drop type if exists public.compliance_rule_status;
drop type if exists public.compliance_certainty;
drop type if exists public.compliance_area;
