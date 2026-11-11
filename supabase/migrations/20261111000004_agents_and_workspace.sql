-- =============================================================================
-- HotelAI — Migration 4: AI agents, knowledge, conversations, usage,
--                         and atomic workspace creation
-- =============================================================================

create type public.agent_type as enum (
  'website_receptionist', 'reservation_assistant', 'voice_receptionist'
);
create type public.agent_status as enum ('draft', 'ready', 'not_configured', 'disabled');
create type public.conversation_channel as enum ('playground', 'website', 'voice', 'whatsapp', 'email');
create type public.conversation_status as enum ('open', 'escalated', 'closed');
create type public.message_sender as enum ('customer', 'agent', 'staff', 'system', 'tool');

-- -----------------------------------------------------------------------------
-- agents
-- -----------------------------------------------------------------------------
create table public.agents (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  agent_type           public.agent_type not null,
  name                 text not null check (char_length(trim(name)) between 1 and 120),
  description          text check (char_length(description) <= 2000),
  enabled              boolean not null default false,
  status               public.agent_status not null default 'draft',
  -- Business-editable behaviour (tone, greeting, escalation contact...).
  -- Never contains secrets. The platform's base system prompt lives in code.
  system_configuration jsonb not null default '{}'::jsonb,
  model_configuration  jsonb not null default '{}'::jsonb,
  usage_limit          integer check (usage_limit is null or usage_limit >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, agent_type)
);

create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- agent_knowledge: structured knowledge base (MVP: no vectors)
-- -----------------------------------------------------------------------------
create type public.knowledge_category as enum (
  'faq', 'company', 'services', 'pricing', 'policies', 'hours', 'hotel', 'other'
);

create table public.agent_knowledge (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title       text not null check (char_length(trim(title)) between 1 and 200),
  content     text not null check (char_length(content) between 1 and 20000),
  category    public.knowledge_category not null default 'other',
  source_type text not null default 'manual' check (source_type in ('manual', 'onboarding', 'document')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index agent_knowledge_business_category_idx on public.agent_knowledge (business_id, category);

create trigger agent_knowledge_set_updated_at
  before update on public.agent_knowledge
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- agent_conversations / agent_messages
-- -----------------------------------------------------------------------------
create table public.agent_conversations (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  agent_id    uuid not null,
  customer_id uuid,
  started_by  uuid references auth.users (id) on delete set null, -- staff user in playground
  channel     public.conversation_channel not null,
  status      public.conversation_status not null default 'open',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, agent_id)
    references public.agents (business_id, id) on delete cascade,
  foreign key (business_id, customer_id)
    references public.guests (business_id, id) on delete set null (customer_id)
);

create index agent_conversations_business_created_idx
  on public.agent_conversations (business_id, created_at desc);

create trigger agent_conversations_set_updated_at
  before update on public.agent_conversations
  for each row execute function private.set_updated_at();

create table public.agent_messages (
  id              bigint generated always as identity primary key,
  business_id     uuid not null,
  conversation_id uuid not null,
  sender_type     public.message_sender not null,
  content         text not null check (char_length(content) <= 20000),
  tool_name       text check (char_length(tool_name) <= 100),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  foreign key (business_id, conversation_id)
    references public.agent_conversations (business_id, id) on delete cascade
);

create index agent_messages_conversation_idx on public.agent_messages (conversation_id, id);
create index agent_messages_business_created_idx on public.agent_messages (business_id, created_at);

-- -----------------------------------------------------------------------------
-- usage_events: metered resource usage (AI messages, tokens, voice minutes)
-- -----------------------------------------------------------------------------
create table public.usage_events (
  id            bigint generated always as identity primary key,
  business_id   uuid not null references public.businesses (id) on delete cascade,
  agent_id      uuid,
  event_type    text not null check (event_type in (
                  'ai_message', 'ai_input_tokens', 'ai_output_tokens',
                  'voice_minutes', 'email_sent', 'tool_call')),
  quantity      numeric(14, 4) not null check (quantity >= 0),
  unit          text not null check (char_length(unit) <= 40),
  provider_cost numeric(14, 6),
  provider_cost_currency char(3),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  foreign key (business_id, agent_id)
    references public.agents (business_id, id) on delete set null (agent_id)
);

create index usage_events_business_type_created_idx
  on public.usage_events (business_id, event_type, created_at);

-- -----------------------------------------------------------------------------
-- RLS & privileges
-- -----------------------------------------------------------------------------
alter table public.agents              enable row level security;
alter table public.agent_knowledge     enable row level security;
alter table public.agent_conversations enable row level security;
alter table public.agent_messages      enable row level security;
alter table public.usage_events        enable row level security;

revoke all on public.agents, public.agent_knowledge, public.agent_conversations,
  public.agent_messages, public.usage_events from anon, authenticated;

grant select on public.agents to authenticated;
grant update (name, description, enabled, system_configuration) on public.agents to authenticated;
grant select, insert, update, delete on public.agent_knowledge to authenticated;
grant select on public.agent_conversations, public.agent_messages, public.usage_events to authenticated;

grant all on public.agents, public.agent_knowledge, public.agent_conversations,
  public.agent_messages, public.usage_events to service_role;

-- agents: all members read; owner/admin configure. Creation happens in
-- create_business_workspace(); model_configuration/status are server-managed.
create policy agents_select on public.agents for select to authenticated
  using (private.is_business_member(business_id));
create policy agents_update on public.agents for update to authenticated
  using (private.has_business_role(business_id, array['owner','admin']::public.business_role[]))
  with check (private.has_business_role(business_id, array['owner','admin']::public.business_role[]));

-- knowledge: all members read; owner/admin/manager edit.
create policy agent_knowledge_select on public.agent_knowledge for select to authenticated
  using (private.is_business_member(business_id));
create policy agent_knowledge_insert on public.agent_knowledge for insert to authenticated
  with check (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]));
create policy agent_knowledge_update on public.agent_knowledge for update to authenticated
  using (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]))
  with check (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]));
create policy agent_knowledge_delete on public.agent_knowledge for delete to authenticated
  using (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]));

-- conversations/messages: read-only for members; written by the agent
-- runtime on the server after entitlement checks.
create policy agent_conversations_select on public.agent_conversations for select to authenticated
  using (private.is_business_member(business_id));
create policy agent_messages_select on public.agent_messages for select to authenticated
  using (private.is_business_member(business_id));

-- usage: owner/admin can see metering details.
create policy usage_events_select on public.usage_events for select to authenticated
  using (private.has_business_role(business_id, array['owner','admin']::public.business_role[]));

-- -----------------------------------------------------------------------------
-- create_business_workspace(): the ONLY way to create a tenant.
-- Atomically creates business + owner membership + settings + subscription
-- (trial if eligible) + default agents + audit entry.
-- Trial eligibility is decided here, server-side, from trial_grants — the
-- caller cannot influence trial dates or status.
-- -----------------------------------------------------------------------------
create or replace function public.create_business_workspace(
  p_name                text,
  p_industry            public.industry,
  p_timezone            text default 'UTC',
  p_default_language    text default 'en',
  p_supported_languages text[] default null,
  p_country             text default null,
  p_city                text default null,
  p_contact_email       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id       uuid := auth.uid();
  v_business_id   uuid;
  v_trial         jsonb;
  v_limits        jsonb;
  v_trial_days    integer;
  v_max_trials    integer;
  v_max_created   integer;
  v_trials_used   integer;
  v_now           timestamptz := now();
  v_status        public.subscription_status;
  v_plan_id       text;
  v_languages     text[];
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_name is null or char_length(trim(p_name)) not between 2 and 120 then
    raise exception 'invalid business name' using errcode = '22023';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid timezone' using errcode = '22023';
  end if;

  if p_country is not null and p_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid country code' using errcode = '22023';
  end if;

  v_languages := coalesce(p_supported_languages, array[p_default_language]);
  if not (p_default_language = any (v_languages)) then
    v_languages := array_prepend(p_default_language, v_languages);
  end if;

  -- Serialize workspace creation per user so concurrent requests cannot
  -- race past the trial / workspace-count checks.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create_workspace:' || v_user_id::text, 0));

  select (value ->> 'max_created_per_user')::int into v_max_created
  from public.platform_settings where key = 'workspaces';

  if v_max_created is not null and (
    select count(*) from public.businesses where created_by = v_user_id
  ) >= v_max_created then
    raise exception 'workspace limit reached' using errcode = '54000';
  end if;

  select value into v_trial from public.platform_settings where key = 'trial';
  v_trial_days := coalesce((v_trial ->> 'days')::int, 7);
  v_max_trials := coalesce((v_trial ->> 'max_trials_per_user')::int, 1);
  v_plan_id    := coalesce(v_trial ->> 'plan_id', 'growth');
  v_limits     := coalesce(v_trial -> 'usage_limits', '{}'::jsonb);

  select count(*) into v_trials_used from public.trial_grants where user_id = v_user_id;

  insert into public.businesses (
    name, industry, timezone, default_language, supported_languages,
    country, city, contact_email, created_by
  ) values (
    trim(p_name), p_industry, p_timezone, p_default_language, v_languages,
    p_country, nullif(trim(p_city), ''), nullif(trim(p_contact_email), ''), v_user_id
  )
  returning id into v_business_id;

  insert into public.business_members (business_id, user_id, role, invitation_status)
  values (v_business_id, v_user_id, 'owner', 'active');

  insert into public.business_settings (business_id) values (v_business_id);

  if v_trials_used < v_max_trials then
    v_status := 'trialing';
    insert into public.subscriptions (business_id, plan_id, status, trial_started_at, trial_ends_at)
    values (v_business_id, v_plan_id, v_status, v_now, v_now + make_interval(days => v_trial_days));
    insert into public.trial_grants (user_id, business_id) values (v_user_id, v_business_id);
  else
    v_status := 'incomplete';
    insert into public.subscriptions (business_id, plan_id, status)
    values (v_business_id, v_plan_id, v_status);
  end if;

  insert into public.agents (business_id, agent_type, name, description, enabled, status) values
    (v_business_id, 'website_receptionist', 'Website Receptionist',
     'Answers visitor questions using your business knowledge.', true, 'draft'),
    (v_business_id, 'reservation_assistant', 'Reservation Assistant',
     'Checks real availability and creates bookings after guest confirmation.',
     p_industry = 'hotel', case when p_industry = 'hotel' then 'draft' else 'disabled' end::public.agent_status),
    (v_business_id, 'voice_receptionist', 'Voice Receptionist',
     'Phone agent. Requires a voice provider integration (not yet available).', false, 'not_configured');

  perform private.write_audit_log(
    v_business_id, 'business.created', 'business', v_business_id::text,
    jsonb_build_object('industry', p_industry, 'subscription_status', v_status, 'trial_days',
      case when v_status = 'trialing' then v_trial_days end, 'trial_usage_limits',
      case when v_status = 'trialing' then v_limits end)
  );

  return v_business_id;
end;
$$;

revoke all on function public.create_business_workspace(text, public.industry, text, text, text[], text, text, text) from public, anon;
grant execute on function public.create_business_workspace(text, public.industry, text, text, text[], text, text, text) to authenticated;
