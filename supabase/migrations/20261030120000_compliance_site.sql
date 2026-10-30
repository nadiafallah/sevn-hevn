-- Compliance, step 6: the website reads the approved rules (docs/COMPLIANCE.md).
--
-- * compliance_site_settings(): the numbers and switches of the active rules (rule code → its
--   site_params), for the public website: the returns notice, product pages and checkout. Only the
--   code, site_params, certainty and whether the rule was checked against the official text are
--   exposed. Requirements, notes, sources, monitor runs and proposed changes stay team-only.
-- * Products: country of origin and an Arabic statement of materials (Cabinet Resolution 66/2023,
--   Art. 40(1)). Saved by the owner with admin_save_product_compliance(); shown on the product page
--   when filled in.
-- * A pre-owned piece graded excellent, very good, good or fair can be published only with
--   condition notes (Cabinet Resolution 66/2023, Art. 7). Enforced here, so a dashboard edit or an
--   import can't publish it either.
-- * Fixes in compliance_decide(): a new rule approved with a certainty other than "confirmed" is no
--   longer marked as checked against the official text (it was, for VAT-SUPPLIER-VERIFY; that row
--   is corrected below), and a new rule proposed without applies_to applies to all sales.
--
-- Requires 20261013120000_shop_four_categories.sql and 20261027191858_compliance.sql.
-- Rollback: supabase/rollbacks/20261030120000_compliance_site.down.sql

-- ── Rule settings for the public website ──────────────────────────────────────────────

create function public.compliance_site_settings() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(r.code, jsonb_build_object(
    'params', r.site_params,
    'certainty', r.certainty,
    'verified', r.last_verified_at is not null
  )), '{}'::jsonb)
  from public.compliance_rules r
  where r.status = 'active'
$$;
comment on function public.compliance_site_settings() is 'Public: rule code → site_params of the active compliance rules, read by the website. Nothing else from the ledger.';
revoke all on function public.compliance_site_settings() from public;
grant execute on function public.compliance_site_settings() to anon, authenticated, service_role;

-- ── Products: origin and Arabic composition ───────────────────────────────────────────

alter table public.products
  add column country_of_origin text check (length(country_of_origin) <= 80),
  add column composition_ar text check (length(composition_ar) <= 500);

comment on column public.products.country_of_origin is 'Country where the piece was made, as documented (e.g. France). Shown on the product page.';
comment on column public.products.composition_ar is 'Materials and composition in Arabic (Cabinet Resolution 66/2023, Art. 40(1)(c)). Shown on the product page.';

-- Only the keys present change; an empty string clears a field.
create function public.admin_save_product_compliance(p_ref text, p_fields jsonb) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := private.require_owner();
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  old public.products;
  new public.products;
  d record;
begin
  if jsonb_typeof(f) <> 'object' or exists (
    select 1 from jsonb_object_keys(f) k where k not in ('country_of_origin', 'composition_ar')
  ) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into old from public.products where ref = p_ref for update;
  if not found or old.status = 'editorial_preview' then raise exception 'not_found' using errcode = 'P0002'; end if;

  update public.products set
    country_of_origin = case when f ? 'country_of_origin' then private.product_text(f, 'country_of_origin', 80) else country_of_origin end,
    composition_ar = case when f ? 'composition_ar' then private.product_text(f, 'composition_ar', 500) else composition_ar end
  where ref = p_ref returning * into new;

  select * into d from private.diff(to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
  if d.d_after is not null and d.d_after <> '{}'::jsonb then
    perform private.audit(me, 'product.updated', 'product', p_ref, d.d_before, d.d_after);
  end if;
end;
$$;
revoke all on function public.admin_save_product_compliance(text, jsonb) from public, anon;
grant execute on function public.admin_save_product_compliance(text, jsonb) to authenticated;

-- ── Pre-owned pieces: condition notes before publishing ───────────────────────────────

create function private.products_condition_disclosure() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.published
     and new.condition in ('excellent', 'very_good', 'good', 'fair')
     and nullif(btrim(coalesce(new.condition_notes, '')), '') is null then
    raise exception 'condition_notes_needed' using errcode = '22023',
      hint = 'A pre-owned piece needs condition notes (what wear it shows) before it can be published.';
  end if;
  return new;
end;
$$;
revoke execute on function private.products_condition_disclosure() from public, anon, authenticated;

create trigger products_condition_disclosure before insert or update on public.products
  for each row execute function private.products_condition_disclosure();

-- ── Fix: unconfirmed new rules are not "checked against the official text" ────────────

create or replace function private.compliance_decide(p_id uuid, p_decision public.compliance_change_status, p_actor uuid, p_note text)
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
  v_certainty public.compliance_certainty;
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
      v_certainty := coalesce((p->>'certainty')::public.compliance_certainty, 'confirmed');
      insert into public.compliance_rules (
        code, area, title_en, title_fa, requirement_en, requirement_fa, applies_to,
        site_action, site_params, law_reference, source_url, certainty, effective_from,
        last_verified_at, notes
      ) values (
        p->>'code', (p->>'area')::public.compliance_area, p->>'title_en', p->>'title_fa',
        p->>'requirement_en', p->>'requirement_fa',
        case when jsonb_typeof(p->'applies_to') = 'array' and jsonb_array_length(p->'applies_to') > 0
          then array(select jsonb_array_elements_text(p->'applies_to')) else '{all}' end,
        p->>'site_action', coalesce(p->'site_params', '{}'::jsonb), p->>'law_reference',
        coalesce(p->>'source_url', c.evidence_url),
        v_certainty,
        (p->>'effective_from')::date,
        case when v_certainty = 'confirmed' then now() end,
        p->>'notes'
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

-- The one rule added unconfirmed before this fix (VAT-SUPPLIER-VERIFY on 27 Oct 2026).
update public.compliance_rules set last_verified_at = null
where certainty = 'unverified' and last_verified_at is not null;
