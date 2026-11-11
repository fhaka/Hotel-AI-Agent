-- =============================================================================
-- HotelAI — Migration 8: Agent runtime (turn bookkeeping, rate limits, retention)
-- =============================================================================
-- All functions here are for TRUSTED SERVER CODE ONLY (service role). The
-- browser can never record messages or usage. The runtime calls:
--   begin_agent_turn()    -> final atomic entitlement check, usage reservation,
--                            conversation + customer message
--   complete_agent_turn() -> agent reply, tool events, token usage
--   fail_agent_turn()     -> releases the reservation when the model failed
-- =============================================================================

insert into public.platform_settings (key, value) values
  ('agent_runtime', jsonb_build_object(
    'playground_retention_days', 90,
    'conversation_retention_days', 730
  ))
on conflict (key) do nothing;

alter table public.agent_conversations
  add column escalated_at timestamptz,
  add column escalation jsonb;

create index agent_conversations_business_channel_idx
  on public.agent_conversations (business_id, channel, updated_at desc);

-- -----------------------------------------------------------------------------
-- Fixed-window rate limiter.
-- -----------------------------------------------------------------------------
create table public.rate_limits (
  key          text primary key check (char_length(key) <= 200),
  window_start timestamptz not null,
  count        integer not null
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end,
    window_start = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- begin_agent_turn
-- -----------------------------------------------------------------------------
create or replace function public.begin_agent_turn(
  p_business_id      uuid,
  p_agent_id         uuid,
  p_channel          public.conversation_channel,
  p_conversation_id  uuid,
  p_started_by       uuid,
  p_customer_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ent       jsonb;
  v_agent     public.agents;
  v_conv      public.agent_conversations;
  v_limits    jsonb;
  v_usage     jsonb;
  v_usage_id  bigint;
  v_msg_id    bigint;
begin
  if p_customer_message is null or char_length(trim(p_customer_message)) = 0 or char_length(p_customer_message) > 4000 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_message');
  end if;

  -- Serialize turns per business so usage limits are exact.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agent_turn:' || p_business_id::text, 0));

  select * into v_agent from public.agents where id = p_agent_id and business_id = p_business_id;
  if not found or v_agent.status in ('not_configured', 'disabled') then
    return jsonb_build_object('allowed', false, 'reason', 'agent_unavailable');
  end if;
  if not v_agent.enabled then
    return jsonb_build_object('allowed', false, 'reason', 'agent_disabled');
  end if;

  v_ent := private.compute_entitlements(p_business_id);
  if not coalesce((v_ent ->> 'access_active')::boolean, false) then
    return jsonb_build_object('allowed', false, 'reason', coalesce(v_ent ->> 'reason', 'no_active_plan'));
  end if;
  if not ((v_ent -> 'features') ? v_agent.agent_type::text) then
    return jsonb_build_object('allowed', false, 'reason', 'feature_not_in_plan');
  end if;

  v_limits := coalesce(v_ent -> 'limits', '{}'::jsonb);
  v_usage := coalesce(v_ent -> 'usage', '{}'::jsonb);
  if (v_limits ? 'ai_messages_per_month' and (v_usage ->> 'ai_messages')::numeric >= (v_limits ->> 'ai_messages_per_month')::numeric)
     or (v_limits ? 'ai_tokens_per_month' and (v_usage ->> 'ai_tokens')::numeric >= (v_limits ->> 'ai_tokens_per_month')::numeric)
     or (v_agent.usage_limit is not null and (
          select coalesce(sum(quantity), 0) from public.usage_events
          where business_id = p_business_id and agent_id = p_agent_id and event_type = 'ai_message'
            and created_at >= (v_ent ->> 'period_start')::timestamptz) >= v_agent.usage_limit) then
    return jsonb_build_object('allowed', false, 'reason', 'usage_limit_reached');
  end if;

  if p_conversation_id is not null then
    select * into v_conv from public.agent_conversations
    where id = p_conversation_id and business_id = p_business_id and agent_id = p_agent_id and channel = p_channel
    for update;
    -- Playground conversations belong to the staff member who started them.
    if not found or v_conv.status = 'closed'
       or (p_channel = 'playground' and v_conv.started_by is distinct from p_started_by) then
      return jsonb_build_object('allowed', false, 'reason', 'conversation_not_found');
    end if;
  else
    insert into public.agent_conversations (business_id, agent_id, started_by, channel)
    values (p_business_id, p_agent_id, p_started_by, p_channel)
    returning * into v_conv;
  end if;

  insert into public.agent_messages (business_id, conversation_id, sender_type, content)
  values (p_business_id, v_conv.id, 'customer', p_customer_message)
  returning id into v_msg_id;

  insert into public.usage_events (business_id, agent_id, event_type, quantity, unit, metadata)
  values (p_business_id, p_agent_id, 'ai_message', 1, 'message',
          jsonb_build_object('conversation_id', v_conv.id, 'channel', p_channel))
  returning id into v_usage_id;

  update public.agent_conversations set updated_at = now() where id = v_conv.id;

  return jsonb_build_object(
    'allowed', true,
    'conversation_id', v_conv.id,
    'conversation_status', v_conv.status,
    'customer_message_id', v_msg_id,
    'usage_event_id', v_usage_id,
    'messages_used', (v_usage ->> 'ai_messages')::numeric + 1,
    'messages_limit', v_limits -> 'ai_messages_per_month'
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- complete_agent_turn
--   p_tool_events: [{ "name": text, "summary": text, "ok": bool }]
-- -----------------------------------------------------------------------------
create or replace function public.complete_agent_turn(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_agent_id        uuid,
  p_reply           text,
  p_tool_events     jsonb,
  p_input_tokens    integer,
  p_output_tokens   integer,
  p_model           text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg_id bigint;
  v_event  jsonb;
begin
  if not exists (select 1 from public.agent_conversations
                 where id = p_conversation_id and business_id = p_business_id and agent_id = p_agent_id) then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;

  for v_event in select * from jsonb_array_elements(coalesce(p_tool_events, '[]'::jsonb))
  loop
    insert into public.agent_messages (business_id, conversation_id, sender_type, content, tool_name, metadata)
    values (p_business_id, p_conversation_id, 'tool',
            left(coalesce(v_event ->> 'summary', ''), 2000),
            left(v_event ->> 'name', 100),
            jsonb_build_object('ok', coalesce((v_event ->> 'ok')::boolean, false)));
  end loop;

  insert into public.agent_messages (business_id, conversation_id, sender_type, content, metadata)
  values (p_business_id, p_conversation_id, 'agent', left(p_reply, 20000), jsonb_build_object('model', left(p_model, 100)))
  returning id into v_msg_id;

  if coalesce(p_input_tokens, 0) > 0 then
    insert into public.usage_events (business_id, agent_id, event_type, quantity, unit, metadata)
    values (p_business_id, p_agent_id, 'ai_input_tokens', p_input_tokens, 'token', jsonb_build_object('model', left(p_model, 100)));
  end if;
  if coalesce(p_output_tokens, 0) > 0 then
    insert into public.usage_events (business_id, agent_id, event_type, quantity, unit, metadata)
    values (p_business_id, p_agent_id, 'ai_output_tokens', p_output_tokens, 'token', jsonb_build_object('model', left(p_model, 100)));
  end if;

  update public.agent_conversations set updated_at = now() where id = p_conversation_id;
  return v_msg_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- fail_agent_turn: the model call failed — release the message reservation
-- and leave a system note in the transcript.
-- -----------------------------------------------------------------------------
create or replace function public.fail_agent_turn(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_usage_event_id  bigint,
  p_error_code      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.usage_events
  where id = p_usage_event_id and business_id = p_business_id and event_type = 'ai_message';

  insert into public.agent_messages (business_id, conversation_id, sender_type, content, metadata)
  select p_business_id, p_conversation_id, 'system', 'The agent could not respond to this message.',
         jsonb_build_object('error', left(p_error_code, 100))
  where exists (select 1 from public.agent_conversations where id = p_conversation_id and business_id = p_business_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- escalate_conversation: called by the request_human_handoff tool.
-- -----------------------------------------------------------------------------
create or replace function public.escalate_conversation(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_details         jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  update public.agent_conversations
  set status = 'escalated',
      escalated_at = coalesce(escalated_at, now()),
      escalation = p_details
  where id = p_conversation_id and business_id = p_business_id
  returning true into v_found;
  if coalesce(v_found, false) then
    perform private.write_audit_log(p_business_id, 'conversation.escalated', 'agent_conversation', p_conversation_id::text, '{}'::jsonb);
  end if;
  return coalesce(v_found, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Retention: delete old conversations (scheduled job in Phase 8).
-- -----------------------------------------------------------------------------
create or replace function public.purge_expired_conversations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg     jsonb;
  v_deleted integer;
begin
  select value into v_cfg from public.platform_settings where key = 'agent_runtime';
  delete from public.agent_conversations
  where (channel = 'playground' and updated_at < now() - make_interval(days => coalesce((v_cfg ->> 'playground_retention_days')::int, 90)))
     or (channel <> 'playground' and updated_at < now() - make_interval(days => coalesce((v_cfg ->> 'conversation_retention_days')::int, 730)));
  get diagnostics v_deleted = row_count;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_deleted;
end;
$$;

-- Server-only.
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.begin_agent_turn(uuid, uuid, public.conversation_channel, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_agent_turn(uuid, uuid, uuid, text, jsonb, integer, integer, text) from public, anon, authenticated;
revoke all on function public.fail_agent_turn(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.escalate_conversation(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.purge_expired_conversations() from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.begin_agent_turn(uuid, uuid, public.conversation_channel, uuid, uuid, text) to service_role;
grant execute on function public.complete_agent_turn(uuid, uuid, uuid, text, jsonb, integer, integer, text) to service_role;
grant execute on function public.fail_agent_turn(uuid, uuid, bigint, text) to service_role;
grant execute on function public.escalate_conversation(uuid, uuid, jsonb) to service_role;
grant execute on function public.purge_expired_conversations() to service_role;
