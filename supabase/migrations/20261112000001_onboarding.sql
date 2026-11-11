-- =============================================================================
-- HotelAI — Migration 5: Business onboarding
-- =============================================================================
-- Onboarding is a multi-step wizard:
--   1. company     -> create_business_workspace()   (creates tenant + trial)
--   2. operations  -> save_onboarding_operations()  (hours, policies, services, FAQs)
--   3. hotel       -> save_onboarding_hotel()       (hotel facts, room types, rooms)
--   4. review      -> complete_onboarding()
-- Each step is one transaction. Functions are SECURITY DEFINER and check the
-- caller's role themselves; every write is scoped to p_business_id, which is
-- only accepted after that check.
-- =============================================================================

-- Progress tracking. Not in the client-updatable column grants, so only the
-- functions below can change it.
alter table public.businesses
  add column onboarding_state jsonb not null default '{"completed_steps": []}'::jsonb;

-- Raises unless the current user is an active owner/admin of the business.
create or replace function private.assert_business_admin(p_business_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.has_business_role(p_business_id, array['owner', 'admin']::public.business_role[]) then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.mark_onboarding_step(p_business_id uuid, p_step text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.businesses
  set onboarding_state = jsonb_set(
    onboarding_state,
    '{completed_steps}',
    (
      select coalesce(jsonb_agg(distinct s), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(onboarding_state -> 'completed_steps', '[]'::jsonb) || to_jsonb(p_step)) s
    )
  )
  where id = p_business_id;
$$;

revoke all on function private.assert_business_admin(uuid) from public, anon;
revoke all on function private.mark_onboarding_step(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- create_business_workspace(): replaced to accept the full company profile so
-- step 1 is a single atomic call. Trial/agent logic is unchanged.
-- -----------------------------------------------------------------------------
drop function public.create_business_workspace(text, public.industry, text, text, text[], text, text, text);

create or replace function public.create_business_workspace(
  p_name                text,
  p_industry            public.industry,
  p_timezone            text default 'UTC',
  p_default_language    text default 'en',
  p_supported_languages text[] default null,
  p_country             text default null,
  p_city                text default null,
  p_contact_email       text default null,
  p_description         text default null,
  p_phone               text default null,
  p_website             text default null,
  p_address             text default null
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
    country, city, contact_email, description, phone, website, address, created_by,
    onboarding_state
  ) values (
    trim(p_name), p_industry, p_timezone, p_default_language, v_languages,
    p_country, nullif(trim(p_city), ''), nullif(trim(p_contact_email), ''),
    nullif(trim(p_description), ''), nullif(trim(p_phone), ''),
    nullif(trim(p_website), ''), nullif(trim(p_address), ''), v_user_id,
    '{"completed_steps": ["company"]}'::jsonb
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

revoke all on function public.create_business_workspace(text, public.industry, text, text, text[], text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_business_workspace(text, public.industry, text, text, text[], text, text, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Step 2: operations.
--   p_opening_hours: object, stored as-is (shape validated by the app)
--   p_policies:      object merged into business_settings.policies
--   p_services:      [{ "title": text, "content": text }]
--   p_faqs:          [{ "question": text, "answer": text }]
-- Services and FAQs become knowledge-base entries with source_type
-- 'onboarding'; re-saving replaces only those, never manual entries.
-- -----------------------------------------------------------------------------
create or replace function public.save_onboarding_operations(
  p_business_id   uuid,
  p_opening_hours jsonb,
  p_policies      jsonb,
  p_services      jsonb,
  p_faqs          jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_business_admin(p_business_id);

  if jsonb_typeof(p_opening_hours) <> 'object' or jsonb_typeof(p_policies) <> 'object'
     or jsonb_typeof(p_services) <> 'array' or jsonb_typeof(p_faqs) <> 'array' then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_services) > 50 or jsonb_array_length(p_faqs) > 100 then
    raise exception 'too many entries' using errcode = '22023';
  end if;

  update public.business_settings
  set opening_hours = p_opening_hours,
      policies = policies || p_policies
  where business_id = p_business_id;

  delete from public.agent_knowledge
  where business_id = p_business_id
    and source_type = 'onboarding'
    and category in ('services', 'faq');

  insert into public.agent_knowledge (business_id, title, content, category, source_type, created_by)
  select p_business_id, trim(s ->> 'title'), trim(s ->> 'content'), 'services', 'onboarding', auth.uid()
  from jsonb_array_elements(p_services) s
  where nullif(trim(s ->> 'title'), '') is not null;

  insert into public.agent_knowledge (business_id, title, content, category, source_type, created_by)
  select p_business_id, trim(f ->> 'question'), trim(f ->> 'answer'), 'faq', 'onboarding', auth.uid()
  from jsonb_array_elements(p_faqs) f
  where nullif(trim(f ->> 'question'), '') is not null
    and nullif(trim(f ->> 'answer'), '') is not null;

  perform private.mark_onboarding_step(p_business_id, 'operations');
  perform private.write_audit_log(p_business_id, 'onboarding.operations_saved', 'business', p_business_id::text, '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Step 3: hotel details (hotel businesses only).
--   p_booking_settings: { check_in_time, check_out_time, currency }
--   p_hotel_policies:   { cancellation, breakfast, parking, wifi, pets, extra_services }
--   p_room_types:       [{ name, description, maximum_guests, bed_configuration,
--                          amenities: [text], base_price_cents, room_numbers: [text] }]
-- Room inventory is replaced wholesale, which is only safe while no
-- reservations exist. After that, rooms are managed from the Rooms page.
-- -----------------------------------------------------------------------------
create or replace function public.save_onboarding_hotel(
  p_business_id      uuid,
  p_booking_settings jsonb,
  p_hotel_policies   jsonb,
  p_room_types       jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency  text;
  v_room_type jsonb;
  v_type_id   uuid;
  v_total     integer := 0;
begin
  perform private.assert_business_admin(p_business_id);

  if (select industry from public.businesses where id = p_business_id) <> 'hotel' then
    raise exception 'hotel details apply to hotel businesses only' using errcode = '22023';
  end if;

  if jsonb_typeof(p_booking_settings) <> 'object' or jsonb_typeof(p_hotel_policies) <> 'object'
     or jsonb_typeof(p_room_types) <> 'array' then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_room_types) not between 1 and 50 then
    raise exception 'between 1 and 50 room types are required' using errcode = '22023';
  end if;

  v_currency := coalesce(p_booking_settings ->> 'currency', 'EUR');
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid currency' using errcode = '22023';
  end if;

  if exists (select 1 from public.reservations where business_id = p_business_id) then
    raise exception 'rooms already have reservations; manage them from the Rooms page'
      using errcode = '55006';
  end if;

  update public.business_settings
  set booking_settings = booking_settings || p_booking_settings,
      policies = policies || p_hotel_policies
  where business_id = p_business_id;

  delete from public.rooms where business_id = p_business_id;
  delete from public.room_types where business_id = p_business_id;

  for v_room_type in select * from jsonb_array_elements(p_room_types)
  loop
    insert into public.room_types (
      business_id, name, description, maximum_guests, bed_configuration,
      amenities, base_price_cents, currency
    ) values (
      p_business_id,
      trim(v_room_type ->> 'name'),
      nullif(trim(v_room_type ->> 'description'), ''),
      (v_room_type ->> 'maximum_guests')::int,
      nullif(trim(v_room_type ->> 'bed_configuration'), ''),
      coalesce(array(select jsonb_array_elements_text(v_room_type -> 'amenities')), '{}'),
      (v_room_type ->> 'base_price_cents')::int,
      v_currency
    )
    returning id into v_type_id;

    insert into public.rooms (business_id, room_type_id, room_number)
    select p_business_id, v_type_id, trim(n)
    from jsonb_array_elements_text(coalesce(v_room_type -> 'room_numbers', '[]'::jsonb)) n;

    get diagnostics v_total = row_count;
    if v_total = 0 then
      raise exception 'each room type needs at least one room' using errcode = '22023';
    end if;
  end loop;

  if (select count(*) from public.rooms where business_id = p_business_id) > 1000 then
    raise exception 'too many rooms' using errcode = '22023';
  end if;

  perform private.mark_onboarding_step(p_business_id, 'hotel');
  perform private.write_audit_log(
    p_business_id, 'onboarding.hotel_saved', 'business', p_business_id::text,
    jsonb_build_object('room_types', jsonb_array_length(p_room_types))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Step 4: mark onboarding complete once required steps are done.
-- -----------------------------------------------------------------------------
create or replace function public.complete_onboarding(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_steps    jsonb;
begin
  perform private.assert_business_admin(p_business_id);

  select * into v_business from public.businesses where id = p_business_id for update;
  v_steps := coalesce(v_business.onboarding_state -> 'completed_steps', '[]'::jsonb);

  if not (v_steps ? 'operations') then
    raise exception 'complete the operations step first' using errcode = '55000';
  end if;
  if v_business.industry = 'hotel' and not (v_steps ? 'hotel') then
    raise exception 'complete the hotel step first' using errcode = '55000';
  end if;

  if v_business.onboarding_completed_at is null then
    update public.businesses set onboarding_completed_at = now() where id = p_business_id;
    perform private.write_audit_log(p_business_id, 'onboarding.completed', 'business', p_business_id::text, '{}'::jsonb);
  end if;
end;
$$;

revoke all on function public.save_onboarding_operations(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.save_onboarding_hotel(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.complete_onboarding(uuid) from public, anon;
grant execute on function public.save_onboarding_operations(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.save_onboarding_hotel(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.complete_onboarding(uuid) to authenticated;
