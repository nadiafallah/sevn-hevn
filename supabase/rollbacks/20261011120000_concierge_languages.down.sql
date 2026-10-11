-- Rollback for 20261011120000_concierge_languages.sql (concierge chat in Russian and French).
-- Russian and French rows are kept but relabelled English, so the narrower checks can return.
begin;
update public.customers set preferred_language = 'en' where preferred_language in ('ru', 'fr');
update public.conversations set locale = 'en' where locale in ('ru', 'fr');
update public.conversation_messages set locale = 'en' where locale in ('ru', 'fr');
update public.requests set locale = 'en' where locale in ('ru', 'fr');
update public.knowledge_entries set status = 'retired' where locale in ('ru', 'fr') and status <> 'retired';
update public.knowledge_entries set locale = 'en' where locale in ('ru', 'fr');

alter table public.customers
  drop constraint customers_preferred_language_check,
  add constraint customers_preferred_language_check check (preferred_language in ('en', 'ar'));
alter table public.conversations
  drop constraint conversations_locale_check,
  add constraint conversations_locale_check check (locale in ('en', 'ar'));
alter table public.conversation_messages
  drop constraint conversation_messages_locale_check,
  add constraint conversation_messages_locale_check check (locale in ('en', 'ar'));
alter table public.requests
  drop constraint requests_locale_check,
  add constraint requests_locale_check check (locale in ('en', 'ar'));
alter table public.knowledge_entries
  drop constraint knowledge_entries_locale_check,
  add constraint knowledge_entries_locale_check check (locale in ('en', 'ar'));

create or replace function public.concierge_start(p_key text, p_token_hash text, p_locale text, p_source text, p_client_hash text)
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

create or replace function public.concierge_save(
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
commit;
