-- =============================================================================
-- HotelAI — Migration 7: Knowledge base
-- =============================================================================

insert into public.platform_settings (key, value) values
  ('knowledge', jsonb_build_object('max_entries', 500, 'max_total_chars', 300000))
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Size limits per business. Knowledge is injected into AI prompts, so it must
-- stay bounded. Serialized per business so concurrent inserts can't overshoot.
-- -----------------------------------------------------------------------------
create or replace function private.enforce_knowledge_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings  jsonb;
  v_max       integer;
  v_max_chars bigint;
  v_count     integer;
  v_chars     bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('knowledge:' || new.business_id::text, 0));
  select value into v_settings from public.platform_settings where key = 'knowledge';
  v_max := coalesce((v_settings ->> 'max_entries')::int, 500);
  v_max_chars := coalesce((v_settings ->> 'max_total_chars')::bigint, 300000);

  select count(*), coalesce(sum(char_length(title) + char_length(content)), 0)
  into v_count, v_chars
  from public.agent_knowledge
  where business_id = new.business_id and id <> new.id;

  if tg_op = 'INSERT' and v_count + 1 > v_max then
    raise exception 'knowledge entry limit reached (%)', v_max using errcode = '54000';
  end if;
  if v_chars + char_length(new.title) + char_length(new.content) > v_max_chars then
    raise exception 'knowledge size limit reached' using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger agent_knowledge_limits
  before insert or update of title, content on public.agent_knowledge
  for each row execute function private.enforce_knowledge_limits();

-- created_by cannot be spoofed on insert, and direct client inserts are
-- always 'manual' (only server-side functions may create 'onboarding' or
-- 'document' entries). Not SECURITY DEFINER: current_user is the caller.
create or replace function private.set_knowledge_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  if current_user in ('authenticated', 'anon') then
    new.source_type := 'manual';
  end if;
  return new;
end;
$$;

create trigger agent_knowledge_author
  before insert on public.agent_knowledge
  for each row execute function private.set_knowledge_author();

-- Clients may not relabel an entry's source (onboarding/document provenance).
revoke update on public.agent_knowledge from authenticated;
grant update (title, content, category) on public.agent_knowledge to authenticated;

-- -----------------------------------------------------------------------------
-- Audit: create/update/delete of knowledge (titles and column names only).
-- -----------------------------------------------------------------------------
create or replace function private.audit_knowledge_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.agent_knowledge;
  v_changed text[];
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from unnest(array['title', 'content', 'category']) k
    where (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k);
    if v_changed is null then
      return new;
    end if;
  end if;
  perform private.write_audit_log(
    v_row.business_id,
    'knowledge.' || lower(tg_op),
    'agent_knowledge',
    v_row.id::text,
    jsonb_strip_nulls(jsonb_build_object('category', v_row.category, 'changed', to_jsonb(v_changed)))
  );
  return v_row;
end;
$$;

create trigger agent_knowledge_audit
  after insert or update or delete on public.agent_knowledge
  for each row execute function private.audit_knowledge_change();

-- -----------------------------------------------------------------------------
-- search_agent_knowledge(): paginated, filtered listing. SECURITY INVOKER, so
-- RLS applies exactly as for a direct select. Implemented in SQL (rather than
-- PostgREST filter strings) so user search text is never parsed as filter
-- syntax; matching uses position(), so % and _ have no special meaning.
-- -----------------------------------------------------------------------------
create or replace function public.search_agent_knowledge(
  p_business_id uuid,
  p_query       text default null,
  p_category    public.knowledge_category default null,
  p_limit       integer default 20,
  p_offset      integer default 0
)
returns table (
  id          uuid,
  title       text,
  content     text,
  category    public.knowledge_category,
  source_type text,
  updated_at  timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select nullif(lower(trim(left(coalesce(p_query, ''), 200))), '') as term
  )
  select k.id, k.title, k.content, k.category, k.source_type, k.updated_at,
         count(*) over () as total_count
  from public.agent_knowledge k, q
  where k.business_id = p_business_id
    and (p_category is null or k.category = p_category)
    and (q.term is null
         or position(q.term in lower(k.title)) > 0
         or position(q.term in lower(k.content)) > 0)
  order by k.category, lower(k.title), k.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_agent_knowledge(uuid, text, public.knowledge_category, integer, integer) from public, anon;
grant execute on function public.search_agent_knowledge(uuid, text, public.knowledge_category, integer, integer) to authenticated, service_role;

create index if not exists agent_knowledge_business_title_idx on public.agent_knowledge (business_id, category, lower(title));
