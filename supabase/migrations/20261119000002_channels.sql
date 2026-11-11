-- =============================================================================
-- HotelAI — Migration 13: Customer channels (website widget, voice, WhatsApp)
-- =============================================================================
-- Routing rules:
--   * website widget: public widget key -> business (key is not a secret; the
--     limits are rate limits, plan usage limits and the allowed-origins list,
--     enforced by the browser via CSP frame-ancestors).
--   * voice / WhatsApp: the Twilio "To" number -> business. Numbers are
--     assigned ONLY by the platform operator (service role), so a business
--     can never claim another business's number.
-- Every turn still goes through begin_agent_turn() (entitlements, limits).
-- =============================================================================

create type public.channel_kind as enum ('website_widget', 'voice', 'whatsapp');

create table public.business_channels (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind        public.channel_kind not null,
  enabled     boolean not null default false,
  public_key  text unique check (public_key ~ '^wk_[0-9a-f]{32}$'),
  address     text check (address ~ '^\+[1-9][0-9]{6,14}$'),
  config      jsonb not null default '{}'::jsonb check (octet_length(config::text) <= 8000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, kind),
  unique (kind, address),
  constraint business_channels_key_for_widget check ((kind = 'website_widget') = (public_key is not null))
);

create trigger business_channels_set_updated_at
  before update on public.business_channels
  for each row execute function private.set_updated_at();

alter table public.business_channels enable row level security;
revoke all on public.business_channels from anon, authenticated;
grant select on public.business_channels to authenticated;
grant all on public.business_channels to service_role;
create policy business_channels_select on public.business_channels for select to authenticated
  using (private.has_business_role(business_id, array['owner', 'admin']::public.business_role[]));

alter table public.agent_conversations add column external_ref text check (char_length(external_ref) <= 200);
create index agent_conversations_external_ref_idx
  on public.agent_conversations (business_id, channel, external_ref) where external_ref is not null;

-- One voice usage record per call (idempotent status callbacks).
create unique index usage_events_voice_call_unique
  on public.usage_events ((metadata ->> 'call_sid')) where event_type = 'voice_minutes';

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'guest_pre_arrival', 'owner_trial_ending', 'owner_trial_ended', 'owner_payment_failed',
  'staff_escalation', 'staff_unanswered_inquiry', 'owner_daily_report', 'owner_welcome',
  'staff_call_summary'));

-- -----------------------------------------------------------------------------
-- Owner/admin configuration
-- -----------------------------------------------------------------------------
create or replace function public.configure_channel(
  p_business_id uuid, p_kind public.channel_kind, p_enabled boolean, p_config jsonb
)
returns public.business_channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.business_channels;
begin
  if not private.has_business_role(p_business_id, array['owner', 'admin']::public.business_role[]) then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_config, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid configuration' using errcode = '22023';
  end if;

  if p_kind = 'website_widget' then
    insert into public.business_channels (business_id, kind, enabled, public_key, config)
    values (p_business_id, p_kind, p_enabled, 'wk_' || encode(extensions.gen_random_bytes(16), 'hex'), coalesce(p_config, '{}'::jsonb))
    on conflict (business_id, kind) do update set enabled = excluded.enabled, config = excluded.config
    returning * into v_row;
  else
    update public.business_channels set enabled = p_enabled, config = coalesce(p_config, '{}'::jsonb)
    where business_id = p_business_id and kind = p_kind and address is not null
    returning * into v_row;
    if v_row.id is null then
      raise exception 'no phone number has been assigned to this business yet' using errcode = '55000';
    end if;
  end if;

  perform private.write_audit_log(p_business_id, 'channel.configured', 'business_channel', v_row.id::text,
    jsonb_build_object('kind', p_kind, 'enabled', p_enabled));
  return v_row;
end;
$$;

create or replace function public.regenerate_widget_key(p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'wk_' || encode(extensions.gen_random_bytes(16), 'hex');
begin
  if not private.has_business_role(p_business_id, array['owner', 'admin']::public.business_role[]) then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;
  update public.business_channels set public_key = v_key where business_id = p_business_id and kind = 'website_widget';
  if not found then
    raise exception 'widget not set up' using errcode = 'P0002';
  end if;
  perform private.write_audit_log(p_business_id, 'channel.widget_key_regenerated', 'business_channel', p_business_id::text, '{}'::jsonb);
  return v_key;
end;
$$;

-- -----------------------------------------------------------------------------
-- Operator: assign a phone number (service role only).
-- -----------------------------------------------------------------------------
create or replace function public.assign_channel_address(p_business_id uuid, p_kind public.channel_kind, p_address text)
returns public.business_channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.business_channels;
begin
  if p_kind = 'website_widget' then
    raise exception 'widgets have no address' using errcode = '22023';
  end if;
  insert into public.business_channels (business_id, kind, address)
  values (p_business_id, p_kind, p_address)
  on conflict (business_id, kind) do update set address = excluded.address
  returning * into v_row;
  if p_kind = 'voice' then
    update public.agents set status = 'draft'
    where business_id = p_business_id and agent_type = 'voice_receptionist' and status = 'not_configured';
  end if;
  perform private.write_audit_log(p_business_id, 'channel.address_assigned', 'business_channel', v_row.id::text,
    jsonb_build_object('kind', p_kind));
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public widget configuration: only what the embed needs, only if live.
-- -----------------------------------------------------------------------------
create or replace function public.widget_public_config(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'enabled', true,
      'business_name', b.name,
      'agent_name', a.name,
      'greeting', nullif(a.system_configuration ->> 'greeting', ''),
      'allowed_origins', coalesce(c.config -> 'allowed_origins', '[]'::jsonb),
      'accent_color', c.config ->> 'accent_color',
      'default_language', b.default_language)
    from public.business_channels c
    join public.businesses b on b.id = c.business_id
    join public.agents a on a.business_id = c.business_id and a.agent_type = 'website_receptionist'
    where c.public_key = p_key and c.kind = 'website_widget' and c.enabled and a.enabled
  ), jsonb_build_object('enabled', false));
$$;

-- -----------------------------------------------------------------------------
-- Voice call finished: record minutes once, close the conversation unless a
-- person still needs to follow up, queue call summaries for staff.
-- -----------------------------------------------------------------------------
create or replace function public.record_voice_call(
  p_business_id uuid, p_conversation_id uuid, p_agent_id uuid, p_call_sid text, p_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes integer := greatest(1, ceil(greatest(coalesce(p_duration_seconds, 0), 0) / 60.0)::int);
  v_new     integer;
  v_prefs   jsonb;
begin
  insert into public.usage_events (business_id, agent_id, event_type, quantity, unit, metadata)
  values (p_business_id, p_agent_id, 'voice_minutes', v_minutes, 'minute',
          jsonb_build_object('call_sid', p_call_sid, 'conversation_id', p_conversation_id, 'seconds', p_duration_seconds))
  on conflict ((metadata ->> 'call_sid')) where event_type = 'voice_minutes' do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then
    return jsonb_build_object('recorded', false, 'duplicate', true);
  end if;

  if p_conversation_id is not null then
    update public.agent_conversations set status = 'closed'
    where id = p_conversation_id and business_id = p_business_id and status = 'open';

    select notification_preferences into v_prefs from public.business_settings where business_id = p_business_id;
    if private.pref_bool(v_prefs, 'staff_alerts', 'call_summaries', true) then
      insert into public.notifications (business_id, kind, recipient_email, recipient_type, subject_id, dedupe_key)
      select p_business_id, 'staff_call_summary', e.email, 'staff', p_conversation_id::text,
             'call_summary:' || p_call_sid || ':' || e.email
      from private.staff_alert_emails(p_business_id, v_prefs) e
      where exists (select 1 from public.agent_messages m where m.conversation_id = p_conversation_id and m.sender_type = 'customer')
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return jsonb_build_object('recorded', true, 'minutes', v_minutes);
end;
$$;

-- -----------------------------------------------------------------------------
-- begin_agent_turn v2: external reference binding + voice minute limits.
-- (p_external_ref is last with a default, so existing 6-argument calls keep working.)
-- -----------------------------------------------------------------------------
drop function public.begin_agent_turn(uuid, uuid, public.conversation_channel, uuid, uuid, text);

create or replace function public.begin_agent_turn(
  p_business_id      uuid,
  p_agent_id         uuid,
  p_channel          public.conversation_channel,
  p_conversation_id  uuid,
  p_started_by       uuid,
  p_customer_message text,
  p_external_ref     text default null
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
     or (p_channel = 'voice' and v_limits ? 'voice_minutes_per_month'
         and (v_usage ->> 'voice_minutes')::numeric >= (v_limits ->> 'voice_minutes_per_month')::numeric)
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
       or (p_channel = 'playground' and v_conv.started_by is distinct from p_started_by)
       -- Public channels: only the holder of the conversation's external
       -- reference (widget token hash, call id, hashed phone) may continue it.
       or (p_channel <> 'playground' and v_conv.external_ref is distinct from p_external_ref) then
      return jsonb_build_object('allowed', false, 'reason', 'conversation_not_found');
    end if;
  else
    insert into public.agent_conversations (business_id, agent_id, started_by, channel, external_ref)
    values (p_business_id, p_agent_id, p_started_by, p_channel, p_external_ref)
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
-- create_reservation_service: also accept WhatsApp bookings.
-- -----------------------------------------------------------------------------
create or replace function public.create_reservation_service(
  p_business_id         uuid,
  p_conversation_id     uuid,
  p_customer_message_id bigint,
  p_quote_id            uuid,
  p_guest               jsonb,
  p_special_requests    text,
  p_source              public.reservation_source,
  p_dry_run             boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ent    jsonb;
  v_quote  public.reservation_quotes;
  v_result jsonb;
  v_price  integer;
begin
  if p_source::text not in ('ai_website', 'ai_voice', 'ai_whatsapp') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_source');
  end if;
  v_ent := private.compute_entitlements(p_business_id);
  if not coalesce((v_ent ->> 'access_active')::boolean, false) or not ((v_ent -> 'features') ? 'reservation_assistant') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed_by_plan');
  end if;

  select * into v_quote from public.reservation_quotes
  where id = p_quote_id and business_id = p_business_id and conversation_id = p_conversation_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'quote_not_found');
  end if;
  if v_quote.used_at is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'reservation',
      (select private.reservation_json(r) from public.reservations r where r.id = v_quote.reservation_id));
  end if;
  if v_quote.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'quote_expired');
  end if;
  -- The guest must have replied AFTER seeing the quote.
  if p_customer_message_id is null or v_quote.created_in_message_id >= p_customer_message_id then
    return jsonb_build_object('ok', false, 'reason', 'guest_has_not_confirmed_quote');
  end if;
  v_price := private.stay_price(v_quote.room_type_id, v_quote.check_in, v_quote.check_out);
  if v_price <> v_quote.total_price_cents then
    return jsonb_build_object('ok', false, 'reason', 'price_changed', 'new_total_price_cents', v_price);
  end if;

  begin
    v_result := private.create_reservation_core(
      p_business_id, v_quote.room_type_id, null, v_quote.check_in, v_quote.check_out, v_quote.guests_count,
      p_guest, p_special_requests, p_source, null, p_conversation_id, 'quote:' || v_quote.id::text);
    if p_dry_run then
      -- Playground: undo everything done in this block, report as a test.
      raise exception using errcode = 'HA001', message = v_result::text;
    end if;
  exception
    when sqlstate 'HA001' then
      v_result := sqlerrm::jsonb;
      return jsonb_build_object('ok', true, 'dry_run', true, 'reservation',
        v_result || jsonb_build_object('confirmation_reference', 'TEST-' || (v_result ->> 'confirmation_reference'), 'id', null));
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'reason', 'sold_out');
    when invalid_parameter_value then
      return jsonb_build_object('ok', false, 'reason', 'invalid_details', 'message', sqlerrm);
    when no_data_found then
      return jsonb_build_object('ok', false, 'reason', 'room_type_not_found');
  end;

  update public.reservation_quotes set used_at = now(), reservation_id = (v_result ->> 'id')::uuid where id = v_quote.id;
  return jsonb_build_object('ok', true, 'dry_run', false, 'reservation', v_result);
end;
$$;

revoke all on function public.configure_channel(uuid, public.channel_kind, boolean, jsonb) from public, anon;
revoke all on function public.regenerate_widget_key(uuid) from public, anon;
grant execute on function public.configure_channel(uuid, public.channel_kind, boolean, jsonb) to authenticated;
grant execute on function public.regenerate_widget_key(uuid) to authenticated;
revoke all on function public.assign_channel_address(uuid, public.channel_kind, text) from public, anon, authenticated;
revoke all on function public.record_voice_call(uuid, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.begin_agent_turn(uuid, uuid, public.conversation_channel, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.assign_channel_address(uuid, public.channel_kind, text) to service_role;
grant execute on function public.record_voice_call(uuid, uuid, uuid, text, integer) to service_role;
grant execute on function public.begin_agent_turn(uuid, uuid, public.conversation_channel, uuid, uuid, text, text) to service_role;
revoke all on function public.widget_public_config(text) from public;
grant execute on function public.widget_public_config(text) to anon, authenticated, service_role;
