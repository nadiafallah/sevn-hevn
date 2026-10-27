-- UAE compliance ledger: the rules the website must follow, the official
-- sources a weekly monitor checks, each monitor run, and the changes it
-- proposes. Nothing changes a rule without the owner's decision.
-- Applied in production on 27 Oct 2026. Seed rows: supabase/seeds/compliance_rules.sql.
-- How it works and how to approve changes: docs/COMPLIANCE.md.

create type public.compliance_area as enum (
  'licensing', 'disclosure', 'returns', 'pricing', 'vat', 'e_invoicing',
  'insurance', 'aml', 'privacy', 'security', 'enforcement'
);
create type public.compliance_certainty as enum ('confirmed', 'disputed', 'needs_lawyer', 'unverified');
create type public.compliance_rule_status as enum ('active', 'superseded', 'retired');
create type public.compliance_change_status as enum ('pending_review', 'approved', 'rejected', 'applied');

create table public.compliance_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  authority text not null,
  url text not null,
  watch_for text not null,
  active boolean not null default true,
  last_checked_at timestamptz,
  last_snapshot text,
  last_result text check (last_result in ('no_change', 'change_found', 'unreachable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.compliance_sources is 'Official UAE sources the weekly compliance monitor checks. Team read-only; written by the monitor.';

create table public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  area public.compliance_area not null,
  title_en text not null,
  title_fa text not null,
  requirement_en text not null,
  requirement_fa text not null,
  applies_to text[] not null default '{all}',
  site_action text not null,
  site_params jsonb not null default '{}'::jsonb,
  law_reference text not null,
  source_url text not null,
  certainty public.compliance_certainty not null default 'unverified',
  status public.compliance_rule_status not null default 'active',
  effective_from date,
  last_verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compliance_rules_applies_to_valid check (
    applies_to <@ array['all', 'pre_owned', 'new_goods', 'precious_metals_stones', 'b2b', 'free_zone']
  )
);
comment on table public.compliance_rules is 'The rules the website must follow, with the official source for each. site_params holds the numbers the website reads (return windows, thresholds). Team read-only; changed only through an approved compliance change.';
create index compliance_rules_area_idx on public.compliance_rules (area);

create table public.compliance_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  sources_checked integer not null default 0,
  changes_found integer not null default 0,
  report text,
  report_thread_id text,
  report_message_id text,
  error text
);
comment on table public.compliance_runs is 'One row per weekly monitor run, with the report sent to the owner. Team read-only.';
create index compliance_runs_started_idx on public.compliance_runs (started_at desc);

create table public.compliance_changes (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default private.new_reference('CHG'),
  run_id uuid references public.compliance_runs (id) on delete set null,
  source_id uuid references public.compliance_sources (id) on delete set null,
  rule_id uuid references public.compliance_rules (id) on delete set null,
  change_type text not null check (change_type in ('new_rule', 'amended', 'repealed', 'verified', 'deadline')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  summary_en text not null,
  summary_fa text not null,
  evidence_url text not null,
  proposed jsonb not null default '{}'::jsonb,
  status public.compliance_change_status not null default 'pending_review',
  review_note text,
  reviewed_by uuid references public.staff_members (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.compliance_changes is 'Changes the monitor found, waiting for the owner. Approving one applies its proposed values to compliance_rules. Team read-only.';
create index compliance_changes_status_idx on public.compliance_changes (status, created_at desc);
create index compliance_changes_run_idx on public.compliance_changes (run_id);
create index compliance_changes_source_idx on public.compliance_changes (source_id);
create index compliance_changes_rule_idx on public.compliance_changes (rule_id);
create index compliance_changes_reviewer_idx on public.compliance_changes (reviewed_by);

create trigger compliance_sources_updated_at before update on public.compliance_sources
  for each row execute function public.set_updated_at();
create trigger compliance_rules_updated_at before update on public.compliance_rules
  for each row execute function public.set_updated_at();

-- Access: team reads; nobody writes through the API.
alter table public.compliance_sources enable row level security;
alter table public.compliance_rules enable row level security;
alter table public.compliance_runs enable row level security;
alter table public.compliance_changes enable row level security;

revoke all on public.compliance_sources, public.compliance_rules, public.compliance_runs, public.compliance_changes from anon, authenticated;
grant select on public.compliance_sources, public.compliance_rules, public.compliance_runs, public.compliance_changes to authenticated;

create policy "Team can read compliance sources" on public.compliance_sources
  for select to authenticated using (private.is_staff());
create policy "Team can read compliance rules" on public.compliance_rules
  for select to authenticated using (private.is_staff());
create policy "Team can read compliance runs" on public.compliance_runs
  for select to authenticated using (private.is_staff());
create policy "Team can read compliance changes" on public.compliance_changes
  for select to authenticated using (private.is_staff());

-- Decide on a pending change. Approving applies the proposed values:
-- an amendment updates the linked rule, a new rule is inserted, a repeal
-- retires the rule, a verification refreshes last_verified_at.
-- Called by the owner RPC below, or by the monitor after the owner replies
-- to the weekly report email.
create function private.compliance_decide(p_id uuid, p_decision public.compliance_change_status, p_actor uuid, p_note text)
returns public.compliance_change_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.compliance_changes;
  p jsonb;
  new_rule_id uuid;
  final_status public.compliance_change_status;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into c from public.compliance_changes where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status <> 'pending_review' then raise exception 'already_decided' using errcode = '22023'; end if;

  final_status := p_decision;
  p := c.proposed;

  if p_decision = 'approved' then
    if c.change_type = 'new_rule' then
      insert into public.compliance_rules (
        code, area, title_en, title_fa, requirement_en, requirement_fa, applies_to,
        site_action, site_params, law_reference, source_url, certainty, effective_from,
        last_verified_at, notes
      ) values (
        p->>'code', (p->>'area')::public.compliance_area, p->>'title_en', p->>'title_fa',
        p->>'requirement_en', p->>'requirement_fa',
        coalesce(array(select jsonb_array_elements_text(p->'applies_to')), '{all}'),
        p->>'site_action', coalesce(p->'site_params', '{}'::jsonb), p->>'law_reference',
        coalesce(p->>'source_url', c.evidence_url),
        coalesce((p->>'certainty')::public.compliance_certainty, 'confirmed'),
        (p->>'effective_from')::date, now(), p->>'notes'
      ) returning id into new_rule_id;
      update public.compliance_changes set rule_id = new_rule_id where id = c.id;
      final_status := 'applied';

    elsif c.rule_id is not null and c.change_type = 'repealed' then
      update public.compliance_rules set status = 'retired', last_verified_at = now(),
        notes = coalesce(p->>'notes', notes)
      where id = c.rule_id;
      final_status := 'applied';

    elsif c.rule_id is not null then
      update public.compliance_rules set
        area = coalesce((p->>'area')::public.compliance_area, area),
        title_en = coalesce(p->>'title_en', title_en),
        title_fa = coalesce(p->>'title_fa', title_fa),
        requirement_en = coalesce(p->>'requirement_en', requirement_en),
        requirement_fa = coalesce(p->>'requirement_fa', requirement_fa),
        applies_to = coalesce(case when p ? 'applies_to' then array(select jsonb_array_elements_text(p->'applies_to')) end, applies_to),
        site_action = coalesce(p->>'site_action', site_action),
        site_params = coalesce(p->'site_params', site_params),
        law_reference = coalesce(p->>'law_reference', law_reference),
        source_url = coalesce(p->>'source_url', source_url),
        certainty = coalesce((p->>'certainty')::public.compliance_certainty, certainty),
        status = coalesce((p->>'status')::public.compliance_rule_status, status),
        effective_from = coalesce((p->>'effective_from')::date, effective_from),
        notes = coalesce(p->>'notes', notes),
        last_verified_at = now()
      where id = c.rule_id;
      final_status := 'applied';
    end if;
  end if;

  update public.compliance_changes set
    status = final_status,
    review_note = nullif(btrim(p_note), ''),
    reviewed_by = p_actor,
    reviewed_at = now()
  where id = c.id;

  perform private.audit(p_actor, 'compliance.' || final_status::text, 'compliance_change', c.ref,
    jsonb_build_object('status', c.status),
    jsonb_build_object('status', final_status, 'note', nullif(btrim(p_note), '')));

  return final_status;
end;
$$;
revoke all on function private.compliance_decide(uuid, public.compliance_change_status, uuid, text) from public, anon, authenticated;

-- Owner decision from the private panel.
create function public.admin_compliance_decide(p_id uuid, p_decision public.compliance_change_status, p_note text)
returns public.compliance_change_status
language plpgsql
security definer
set search_path = ''
as $$
declare me uuid := private.require_owner();
begin
  return private.compliance_decide(p_id, p_decision, me, p_note);
end;
$$;
revoke all on function public.admin_compliance_decide(uuid, public.compliance_change_status, text) from public, anon;
grant execute on function public.admin_compliance_decide(uuid, public.compliance_change_status, text) to authenticated;
