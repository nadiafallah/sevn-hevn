-- SEVN HEVN journal: weekly articles written by the journal pipeline (src/journal, run by GitHub
-- Actions) and reviewed by people in the panel (/admin/journal).
--
-- Access model (deny by default):
-- * Visitors read published articles only, and only the columns a page shows.
-- * The pipeline calls the journal_* functions with the public key plus its own server key, whose
--   SHA-256 hash is stored in private.server_keys under the name 'journal'. Those functions can only
--   write the journal tables, validate what they write and are rate limited.
-- * The team reads everything journal-related in the panel. Only the owner publishes, unpublishes,
--   edits or deletes articles and deletes lessons (admin_journal_* functions, audited).
-- * The pipeline publishes only with an editor score of at least 75 (QUALITY_THRESHOLD in
--   src/journal/config.ts); the table enforces the same rule. A person may publish any draft.
-- Depends on 20261006120000_concierge_crm.sql (private schema, server keys, team, audit log).
--
-- Rollback: supabase/rollbacks/20261017120000_journal.down.sql

-- ── Tables ──────────────────────────────────────────────────────────────────────────────

create type public.journal_post_status as enum ('draft', 'published', 'archived');

create table public.journal_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'published', 'draft', 'failed')),
  score smallint check (score between 0 and 100),
  rewrites smallint check (rewrites between 0 and 10),
  cost_usd numeric(8, 4) check (cost_usd >= 0),
  error text check (length(error) <= 2000),
  post_id uuid,
  -- What went well and badly, from the critic.
  critic jsonb
);
comment on table public.journal_runs is 'Journal pipeline runs (one a week). Team read-only; written by the pipeline.';
create index journal_runs_started_idx on public.journal_runs (started_at desc);

-- Every step's input and output, for debugging a run.
create table public.journal_steps (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.journal_runs (id) on delete cascade,
  agent text not null check (agent in ('ideator', 'strategist', 'researcher', 'writer', 'editor', 'seo', 'critic', 'publisher', 'search', 'checks')),
  round smallint not null check (round between 1 and 99),
  input jsonb,
  output jsonb,
  usage jsonb,
  duration_ms integer check (duration_ms >= 0),
  error text check (length(error) <= 2000),
  created_at timestamptz not null default now(),
  check (octet_length(coalesce(input::text, '')) + octet_length(coalesce(output::text, '')) <= 2000000)
);
comment on table public.journal_steps is 'Input and output of each journal pipeline step. Team read-only.';
create index journal_steps_run_idx on public.journal_steps (run_id, id);

create table public.journal_posts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid unique references public.journal_runs (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 70),
  status public.journal_post_status not null default 'draft',
  title text not null check (length(btrim(title)) between 5 and 120),
  body_md text not null check (length(body_md) between 100 and 40000),
  meta_title text check (length(meta_title) <= 120),
  meta_description text check (length(meta_description) <= 300),
  summary text check (length(summary) <= 400),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 10),
  faq jsonb not null default '[]' check (jsonb_typeof(faq) = 'array' and jsonb_array_length(faq) <= 6),
  primary_keyword text check (length(primary_keyword) <= 80),
  -- The editor's review of the final draft, for whoever reviews it.
  score smallint not null default 0 check (score between 0 and 100),
  subscores jsonb not null default '{}',
  issues jsonb not null default '[]',
  reasons text[] not null default '{}',
  cta jsonb,
  sources jsonb not null default '[]',
  -- The shop's own photos and official house videos shown in the article (src/journal: Media).
  media jsonb not null default '[]' check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 8),
  published_at timestamptz,
  published_by uuid references public.staff_members (id) on delete set null,
  -- True when a person published it from the panel (any score); false when the pipeline did.
  published_manually boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_publish_gate check (status <> 'published' or (published_at is not null and (score >= 75 or published_manually))),
  constraint journal_published_meta check (status <> 'published' or (meta_title is not null and meta_description is not null and summary is not null))
);
comment on table public.journal_posts is 'Journal articles. Public: published rows, page columns only. Drafts wait for the owner in the panel.';
create index journal_posts_published_idx on public.journal_posts (status, published_at desc);
create trigger journal_posts_set_updated_at before update on public.journal_posts for each row execute function public.set_updated_at();

-- Lessons the critic writes for the agents; added to that agent's prompt on the next run.
create table public.journal_lessons (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('ideator', 'strategist', 'researcher', 'writer', 'editor', 'seo')),
  rule text not null check (length(btrim(rule)) between 10 and 240),
  evidence text not null default '' check (length(evidence) <= 400),
  run_id uuid references public.journal_runs (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'retired', 'deleted')),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.staff_members (id) on delete set null
);
comment on table public.journal_lessons is 'Lessons for the journal agents. Deleted lessons are kept so they are never proposed again.';
create index journal_lessons_agent_idx on public.journal_lessons (agent, status, created_at);

-- ── Row-level security ──────────────────────────────────────────────────────────────────

alter table public.journal_runs enable row level security;
alter table public.journal_steps enable row level security;
alter table public.journal_posts enable row level security;
alter table public.journal_lessons enable row level security;
revoke all on public.journal_runs, public.journal_steps, public.journal_posts, public.journal_lessons from public, anon, authenticated;

-- Visitors: published articles, page columns only (editor notes, scores and sources stay private).
grant select (id, slug, title, body_md, meta_title, meta_description, summary, keywords, faq, media, published_at, updated_at) on public.journal_posts to anon;
create policy "Published journal articles are public" on public.journal_posts for select to anon using (status = 'published');

-- The team: everything, read-only (changes go through the functions below).
grant select on public.journal_runs, public.journal_steps, public.journal_posts, public.journal_lessons to authenticated;
create policy "Published journal articles are public to signed-in visitors" on public.journal_posts for select to authenticated using (status = 'published' or private.is_staff());
create policy "Team can read journal runs" on public.journal_runs for select to authenticated using (private.is_staff());
create policy "Team can read journal steps" on public.journal_steps for select to authenticated using (private.is_staff());
create policy "Team can read journal lessons" on public.journal_lessons for select to authenticated using (private.is_staff());

-- ── The pipeline (public key + journal server key) ────────────────────────────────────

create function private.assert_journal_key(p_key text) returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_key is null or length(p_key) < 32 or not exists (
    select 1 from private.server_keys k where k.name = 'journal' and k.sha256_hex = private.sha256_hex(p_key)
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
end;
$$;

-- A run the pipeline may still write to: started by it, not finished, less than 3 hours old.
create function private.journal_open_run(p_run uuid) returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.journal_runs where id = p_run and status = 'running' and started_at > now() - interval '3 hours') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Past articles (so ideas and slugs don't repeat), when the last one was written (an article is
-- written only every N days, src/journal/config.ts) and lessons (active ones for the prompts,
-- deleted ones so the critic never proposes them again).
create function public.journal_context(p_key text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.assert_journal_key(p_key);
  return jsonb_build_object(
    'posts', coalesce((select jsonb_agg(jsonb_build_object('slug', p.slug, 'title', p.title, 'primary_keyword', coalesce(p.primary_keyword, ''),
      'status', p.status, 'published_at', p.published_at) order by p.created_at) from public.journal_posts p), '[]'::jsonb),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'agent', l.agent, 'rule', l.rule, 'evidence', l.evidence,
      'run_id', l.run_id, 'status', l.status, 'created_at', l.created_at) order by l.created_at) from public.journal_lessons l where l.status in ('active', 'deleted')), '[]'::jsonb),
    'last_post_at', (select max(p.created_at) from public.journal_posts p)
  );
end;
$$;

create function public.journal_start_run(p_key text) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare rid uuid;
begin
  perform private.assert_journal_key(p_key);
  perform private.hit('journal_run', 'all', 6, interval '1 day');
  -- Runs that never finished (a crashed job) are closed as failed.
  update public.journal_runs set status = 'failed', finished_at = now(), error = 'did not finish'
  where status = 'running' and started_at < now() - interval '3 hours';
  insert into public.journal_runs default values returning id into rid;
  return rid;
end;
$$;

create function public.journal_save_step(p_key text, p_run uuid, p_step jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.assert_journal_key(p_key);
  perform private.journal_open_run(p_run);
  if (select count(*) from public.journal_steps where run_id = p_run) >= 80 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'journal_steps';
  end if;
  insert into public.journal_steps (run_id, agent, round, input, output, usage, duration_ms, error)
  values (p_run, p_step ->> 'agent', (p_step ->> 'round')::smallint, p_step -> 'input', p_step -> 'output',
    nullif(p_step -> 'usage', 'null'::jsonb), (p_step ->> 'duration_ms')::integer, left(p_step ->> 'error', 2000));
end;
$$;

create function public.journal_save_post(p_key text, p_run uuid, p_post jsonb) returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  pid uuid;
  st public.journal_post_status := (p_post ->> 'status')::public.journal_post_status;
begin
  perform private.assert_journal_key(p_key);
  perform private.journal_open_run(p_run);
  if st not in ('draft', 'published') then raise exception 'invalid_request' using errcode = '22023'; end if;
  insert into public.journal_posts (
    run_id, slug, status, title, body_md, meta_title, meta_description, summary, keywords, faq, primary_keyword,
    score, subscores, issues, reasons, cta, sources, media, published_at
  ) values (
    p_run, p_post ->> 'slug', st, btrim(p_post ->> 'title'), p_post ->> 'body_md', p_post ->> 'meta_title', p_post ->> 'meta_description',
    p_post ->> 'summary', coalesce(array(select jsonb_array_elements_text(p_post -> 'keywords')), '{}'),
    coalesce(p_post -> 'faq', '[]'::jsonb), p_post ->> 'primary_keyword', (p_post ->> 'score')::smallint,
    coalesce(p_post -> 'subscores', '{}'::jsonb), coalesce(p_post -> 'issues', '[]'::jsonb),
    coalesce(array(select jsonb_array_elements_text(p_post -> 'reasons')), '{}'), p_post -> 'cta',
    coalesce(p_post -> 'sources', '[]'::jsonb), coalesce(p_post -> 'media', '[]'::jsonb), case when st = 'published' then now() end
  ) returning id into pid;
  return pid;
end;
$$;

create function public.journal_finish_run(p_key text, p_run uuid, p_result jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.assert_journal_key(p_key);
  perform private.journal_open_run(p_run);
  update public.journal_runs set
    finished_at = now(),
    status = p_result ->> 'status',
    score = (p_result ->> 'score')::smallint,
    rewrites = (p_result ->> 'rewrites')::smallint,
    cost_usd = (p_result ->> 'cost_usd')::numeric,
    error = left(p_result ->> 'error', 2000),
    post_id = (p_result ->> 'post_id')::uuid,
    critic = nullif(p_result -> 'critic', 'null'::jsonb)
  where id = p_run;
end;
$$;

-- At most 3 new lessons per run; the pipeline also says which old ones to retire (cap per agent).
create function public.journal_apply_lessons(p_key text, p_run uuid, p_add jsonb, p_retire uuid[]) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.assert_journal_key(p_key);
  perform private.journal_open_run(p_run);
  if jsonb_typeof(p_add) <> 'array' or jsonb_array_length(p_add) > 3 then raise exception 'invalid_request' using errcode = '22023'; end if;
  update public.journal_lessons set status = 'retired', retired_at = now() where id = any (coalesce(p_retire, '{}')) and status = 'active';
  insert into public.journal_lessons (agent, rule, evidence, run_id)
  select l ->> 'agent', btrim(l ->> 'rule'), left(coalesce(l ->> 'evidence', ''), 400), p_run from jsonb_array_elements(p_add) l;
end;
$$;

-- For the command line (`npm run journal -- lessons delete <id>`); the panel uses admin_journal_delete_lesson.
create function public.journal_delete_lesson(p_key text, p_id uuid) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.assert_journal_key(p_key);
  update public.journal_lessons set status = 'deleted', deleted_at = now() where id = p_id and status <> 'deleted';
  return found;
end;
$$;

-- ── The panel (owner only, audited) ─────────────────────────────────────────────────────

-- Publish, unpublish (back to draft) or archive. Publishing from the panel is a person's decision,
-- so it is allowed at any score; it needs the metadata (checked by the table).
create function public.admin_journal_set_status(p_id uuid, p_status public.journal_post_status) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.journal_posts;
begin
  select * into old from public.journal_posts where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.journal_posts set
    status = p_status,
    published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
    published_by = case when p_status = 'published' and old.status <> 'published' then me else published_by end,
    published_manually = case when p_status = 'published' and old.status <> 'published' then true else published_manually end
  where id = p_id;
  perform private.audit(me, 'journal.' || p_status::text, 'journal_post', p_id::text,
    jsonb_build_object('status', old.status), jsonb_build_object('status', p_status, 'slug', old.slug));
end;
$$;

-- Edit an article's text and metadata (drafts and published). Unknown fields are refused.
create function public.admin_journal_update(p_id uuid, p_fields jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.journal_posts;
  new public.journal_posts;
  d record;
begin
  if exists (select 1 from jsonb_object_keys(p_fields) k where k not in ('title', 'slug', 'body_md', 'meta_title', 'meta_description', 'summary')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into old from public.journal_posts where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.journal_posts set
    title = coalesce(nullif(btrim(p_fields ->> 'title'), ''), title),
    slug = coalesce(nullif(btrim(p_fields ->> 'slug'), ''), slug),
    body_md = coalesce(nullif(p_fields ->> 'body_md', ''), body_md),
    meta_title = case when p_fields ? 'meta_title' then nullif(btrim(p_fields ->> 'meta_title'), '') else meta_title end,
    meta_description = case when p_fields ? 'meta_description' then nullif(btrim(p_fields ->> 'meta_description'), '') else meta_description end,
    summary = case when p_fields ? 'summary' then nullif(btrim(p_fields ->> 'summary'), '') else summary end
  where id = p_id returning * into new;
  select * into d from private.diff(to_jsonb(old) - 'updated_at' - 'body_md', to_jsonb(new) - 'updated_at' - 'body_md');
  perform private.audit(me, 'journal.updated', 'journal_post', p_id::text, d.d_before,
    d.d_after || case when old.body_md is distinct from new.body_md then '{"body_md": "changed"}'::jsonb else '{}'::jsonb end);
end;
$$;

create function public.admin_journal_delete(p_id uuid) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.journal_posts;
begin
  delete from public.journal_posts where id = p_id returning * into old;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.audit(me, 'journal.deleted', 'journal_post', p_id::text, jsonb_build_object('slug', old.slug, 'title', old.title, 'status', old.status), null);
end;
$$;

-- A person removes a wrong lesson: it leaves the prompts and is never proposed again.
create function public.admin_journal_delete_lesson(p_id uuid) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  old public.journal_lessons;
begin
  update public.journal_lessons set status = 'deleted', deleted_at = now(), deleted_by = me where id = p_id and status <> 'deleted'
  returning * into old;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.audit(me, 'journal.lesson_deleted', 'journal_lesson', p_id::text, jsonb_build_object('agent', old.agent, 'rule', old.rule), null);
end;
$$;

-- ── Function privileges ─────────────────────────────────────────────────────────────────

revoke execute on function private.assert_journal_key(text), private.journal_open_run(uuid) from public, anon, authenticated;

revoke execute on function
  public.journal_context(text), public.journal_start_run(text), public.journal_save_step(text, uuid, jsonb),
  public.journal_save_post(text, uuid, jsonb), public.journal_finish_run(text, uuid, jsonb),
  public.journal_apply_lessons(text, uuid, jsonb, uuid[]), public.journal_delete_lesson(text, uuid),
  public.admin_journal_set_status(uuid, public.journal_post_status), public.admin_journal_update(uuid, jsonb),
  public.admin_journal_delete(uuid), public.admin_journal_delete_lesson(uuid)
from public, anon, authenticated;

-- The pipeline (public key + journal server key checked inside each function).
grant execute on function
  public.journal_context(text), public.journal_start_run(text), public.journal_save_step(text, uuid, jsonb),
  public.journal_save_post(text, uuid, jsonb), public.journal_finish_run(text, uuid, jsonb),
  public.journal_apply_lessons(text, uuid, jsonb, uuid[]), public.journal_delete_lesson(text, uuid)
to anon;

-- Signed-in accounts (owner checked inside each function).
grant execute on function
  public.admin_journal_set_status(uuid, public.journal_post_status), public.admin_journal_update(uuid, jsonb),
  public.admin_journal_delete(uuid), public.admin_journal_delete_lesson(uuid)
to authenticated;
