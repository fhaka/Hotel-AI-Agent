-- =============================================================================
-- HotelAI — Migration 9: Reservation engine
-- =============================================================================
-- Availability, prices, allocation and every reservation change happen in
-- these functions. Clients can no longer INSERT or freely UPDATE reservations.
-- The exclusion constraint reservations_no_overlap (migration 3) remains the
-- final guarantee against double-booking.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema additions
-- -----------------------------------------------------------------------------
alter table public.reservations
  add column idempotency_key     text check (char_length(idempotency_key) <= 200),
  add column cancellation_reason text check (char_length(cancellation_reason) <= 1000),
  add column canceled_by         uuid references auth.users (id) on delete set null,
  add column conversation_id     uuid,
  add constraint reservations_idempotency_unique unique (business_id, idempotency_key),
  add constraint reservations_conversation_fk foreign key (business_id, conversation_id)
    references public.agent_conversations (business_id, id) on delete set null (conversation_id);

-- Reservation history (audit trail for reservations specifically).
create table public.reservation_events (
  id             bigint generated always as identity primary key,
  business_id    uuid not null,
  reservation_id uuid not null,
  event_type     text not null check (event_type in ('created', 'status_changed', 'modified', 'email')),
  from_status    public.reservation_status,
  to_status      public.reservation_status,
  actor_id       uuid references auth.users (id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  foreign key (business_id, reservation_id) references public.reservations (business_id, id) on delete cascade
);
create index reservation_events_reservation_idx on public.reservation_events (reservation_id, id);

alter table public.reservation_events enable row level security;
revoke all on public.reservation_events from anon, authenticated;
grant select on public.reservation_events to authenticated;
grant all on public.reservation_events to service_role;
create policy reservation_events_select on public.reservation_events for select to authenticated
  using (private.is_business_member(business_id));

-- Quotes given to guests by the AI. A booking must reference a quote shown in
-- an EARLIER turn (the guest saw the price and replied).
create table public.reservation_quotes (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null,
  conversation_id        uuid not null,
  room_type_id           uuid not null,
  check_in               date not null,
  check_out              date not null,
  guests_count           integer not null,
  total_price_cents      integer not null,
  currency               char(3) not null,
  created_in_message_id  bigint not null,
  expires_at             timestamptz not null,
  used_at                timestamptz,
  reservation_id         uuid,
  created_at             timestamptz not null default now(),
  foreign key (business_id, conversation_id) references public.agent_conversations (business_id, id) on delete cascade,
  foreign key (business_id, room_type_id) references public.room_types (business_id, id) on delete cascade
);
alter table public.reservation_quotes enable row level security;
revoke all on public.reservation_quotes from anon, authenticated;
grant all on public.reservation_quotes to service_role;

-- Clients may only edit free-text special requests directly; everything else
-- goes through the functions below.
revoke insert, update on public.reservations from authenticated;
grant update (special_requests) on public.reservations to authenticated;
drop policy if exists reservations_insert on public.reservations;

-- -----------------------------------------------------------------------------
-- History trigger
-- -----------------------------------------------------------------------------
create or replace function private.reservation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.reservation_events (business_id, reservation_id, event_type, to_status, actor_id, metadata)
    values (new.business_id, new.id, 'created', new.status, auth.uid(),
            jsonb_build_object('source', new.source, 'check_in', new.check_in, 'check_out', new.check_out));
  else
    if new.status is distinct from old.status then
      insert into public.reservation_events (business_id, reservation_id, event_type, from_status, to_status, actor_id, metadata)
      values (new.business_id, new.id, 'status_changed', old.status, new.status, auth.uid(),
              jsonb_strip_nulls(jsonb_build_object('reason', new.cancellation_reason)));
    end if;
    if (new.check_in, new.check_out, new.room_id, new.guests_count, new.total_price_cents)
       is distinct from (old.check_in, old.check_out, old.room_id, old.guests_count, old.total_price_cents) then
      insert into public.reservation_events (business_id, reservation_id, event_type, actor_id, metadata)
      values (new.business_id, new.id, 'modified', auth.uid(), jsonb_build_object(
        'from', jsonb_build_object('check_in', old.check_in, 'check_out', old.check_out, 'guests', old.guests_count, 'total_cents', old.total_price_cents),
        'to',   jsonb_build_object('check_in', new.check_in, 'check_out', new.check_out, 'guests', new.guests_count, 'total_cents', new.total_price_cents)));
    end if;
  end if;
  return new;
end;
$$;

create trigger reservations_history
  after insert or update on public.reservations
  for each row execute function private.reservation_history();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function private.business_today(p_business_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone b.timezone)::date from public.businesses b where b.id = p_business_id;
$$;

create or replace function private.booking_setting(p_business_id uuid, p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(s.booking_settings ->> p_key, '')::int, p_default)
  from public.business_settings s where s.business_id = p_business_id;
$$;

-- Total price for a stay: per night, a seasonal rate if one covers that date,
-- otherwise the room type's base price.
create or replace function private.stay_price(p_room_type_id uuid, p_check_in date, p_check_out date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce(r.nightly_price_cents, rt.base_price_cents)), 0)::int
  from public.room_types rt
  cross join generate_series(p_check_in, p_check_out - 1, interval '1 day') as n(night)
  left join public.room_type_rates r
    on r.room_type_id = rt.id and n.night::date >= r.starts_on and n.night::date < r.ends_on
  where rt.id = p_room_type_id;
$$;

-- Raises 22023 with a clear message when stay parameters are invalid.
create or replace function private.validate_stay(
  p_business_id uuid, p_check_in date, p_check_out date, p_guests integer
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_today(p_business_id);
  v_max   integer := private.booking_setting(p_business_id, 'max_nights', 30);
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception 'check-out must be after check-in' using errcode = '22023';
  end if;
  if p_check_in < v_today then
    raise exception 'check-in cannot be in the past' using errcode = '22023';
  end if;
  if p_check_in > v_today + 365 then
    raise exception 'bookings open up to 365 days ahead' using errcode = '22023';
  end if;
  if p_check_out - p_check_in > v_max then
    raise exception 'maximum stay is % nights', v_max using errcode = '22023';
  end if;
  if p_guests is null or p_guests < 1 or p_guests > 50 then
    raise exception 'invalid number of guests' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- search_room_availability: per active room type, how many rooms are free for
-- the whole stay and what the stay costs. SECURITY INVOKER: members see only
-- their businesses (RLS); the service role must pass a server-resolved id.
-- -----------------------------------------------------------------------------
create or replace function public.search_room_availability(
  p_business_id uuid,
  p_check_in    date,
  p_check_out   date,
  p_guests      integer
)
returns table (
  room_type_id      uuid,
  name              text,
  description       text,
  maximum_guests    integer,
  bed_configuration text,
  amenities         text[],
  currency          char(3),
  available_rooms   integer,
  nights            integer,
  total_price_cents integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.validate_stay(p_business_id, p_check_in, p_check_out, p_guests);
  return query
  select rt.id, rt.name, rt.description, rt.maximum_guests, rt.bed_configuration, rt.amenities, rt.currency,
         (select count(*)::int from public.rooms r
          where r.room_type_id = rt.id and r.business_id = p_business_id and r.status = 'available'
            and not exists (
              select 1 from public.reservations x
              where x.room_id = r.id and x.status in ('pending', 'confirmed', 'checked_in')
                and daterange(x.check_in, x.check_out, '[)') && daterange(p_check_in, p_check_out, '[)'))),
         (p_check_out - p_check_in)::int,
         private.stay_price(rt.id, p_check_in, p_check_out)
  from public.room_types rt
  where rt.business_id = p_business_id and rt.is_active and rt.maximum_guests >= p_guests
  order by private.stay_price(rt.id, p_check_in, p_check_out), rt.name;
end;
$$;

-- -----------------------------------------------------------------------------
-- Core booking: guest upsert, server-side price, safe room allocation.
-- Not callable directly; wrapped by create_reservation (staff) and
-- create_reservation_service (AI).
-- -----------------------------------------------------------------------------
create or replace function private.create_reservation_core(
  p_business_id      uuid,
  p_room_type_id     uuid,
  p_room_id          uuid,
  p_check_in         date,
  p_check_out        date,
  p_guests           integer,
  p_guest            jsonb,
  p_special_requests text,
  p_source           public.reservation_source,
  p_created_by       uuid,
  p_conversation_id  uuid,
  p_idempotency_key  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.reservations;
  v_type     public.room_types;
  v_guest_id uuid;
  v_name     text := nullif(trim(p_guest ->> 'full_name'), '');
  v_email    text := nullif(lower(trim(p_guest ->> 'email')), '');
  v_phone    text := nullif(trim(p_guest ->> 'phone'), '');
  v_lang     text := nullif(trim(p_guest ->> 'preferred_language'), '');
  v_price    integer;
  v_room     record;
  v_res      public.reservations;
begin
  if p_idempotency_key is not null then
    select * into v_existing from public.reservations
    where business_id = p_business_id and idempotency_key = p_idempotency_key;
    if found then
      return private.reservation_json(v_existing) || jsonb_build_object('duplicate', true);
    end if;
  end if;

  perform private.validate_stay(p_business_id, p_check_in, p_check_out, p_guests);

  select * into v_type from public.room_types where id = p_room_type_id and business_id = p_business_id;
  if not found or not v_type.is_active then
    raise exception 'room type not found' using errcode = 'P0002';
  end if;
  if p_guests > v_type.maximum_guests then
    raise exception 'too many guests for this room type (max %)', v_type.maximum_guests using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'guest name is required' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid guest email' using errcode = '22023';
  end if;

  -- Guest: reuse by email within this business, otherwise create.
  if v_email is not null then
    select id into v_guest_id from public.guests where business_id = p_business_id and lower(email) = v_email
    order by created_at limit 1;
  end if;
  if v_guest_id is null then
    insert into public.guests (business_id, full_name, email, phone, preferred_language)
    values (p_business_id, left(v_name, 200), v_email, left(v_phone, 40),
            case when v_lang ~ '^[a-z]{2}(-[A-Z]{2})?$' then v_lang end)
    returning id into v_guest_id;
  else
    update public.guests set phone = coalesce(phone, left(v_phone, 40)) where id = v_guest_id;
  end if;

  v_price := private.stay_price(p_room_type_id, p_check_in, p_check_out);

  -- Allocation: try each free room of the type (or only the requested room).
  -- A concurrent booking that takes the same room makes the insert fail with
  -- an exclusion violation; we then simply try the next room.
  for v_room in
    select r.id from public.rooms r
    where r.business_id = p_business_id and r.room_type_id = p_room_type_id and r.status = 'available'
      and (p_room_id is null or r.id = p_room_id)
      and not exists (
        select 1 from public.reservations x
        where x.room_id = r.id and x.status in ('pending', 'confirmed', 'checked_in')
          and daterange(x.check_in, x.check_out, '[)') && daterange(p_check_in, p_check_out, '[)'))
    order by r.room_number
  loop
    begin
      insert into public.reservations (
        business_id, room_id, guest_id, check_in, check_out, guests_count, total_price_cents, currency,
        status, source, special_requests, created_by, conversation_id, idempotency_key
      ) values (
        p_business_id, v_room.id, v_guest_id, p_check_in, p_check_out, p_guests, v_price, v_type.currency,
        'confirmed', p_source, left(nullif(trim(p_special_requests), ''), 2000), p_created_by, p_conversation_id, p_idempotency_key
      ) returning * into v_res;
      exit;
    exception when exclusion_violation then
      continue;
    end;
  end loop;

  if v_res.id is null then
    raise exception 'no rooms of this type are available for these dates' using errcode = '23P01';
  end if;

  perform private.write_audit_log(p_business_id, 'reservation.created', 'reservation', v_res.id::text,
    jsonb_build_object('source', p_source));
  return private.reservation_json(v_res);
end;
$$;

create or replace function private.reservation_json(r public.reservations)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'confirmation_reference', r.confirmation_reference,
    'status', r.status,
    'check_in', r.check_in,
    'check_out', r.check_out,
    'nights', r.check_out - r.check_in,
    'guests_count', r.guests_count,
    'total_price_cents', r.total_price_cents,
    'currency', r.currency,
    'room_type', (select rt.name from public.rooms ro join public.room_types rt on rt.id = ro.room_type_id where ro.id = r.room_id),
    'room_number', (select ro.room_number from public.rooms ro where ro.id = r.room_id),
    'guest_name', (select g.full_name from public.guests g where g.id = r.guest_id),
    'guest_email', (select g.email from public.guests g where g.id = r.guest_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- Staff booking (dashboard)
-- -----------------------------------------------------------------------------
create or replace function public.create_reservation(
  p_business_id      uuid,
  p_room_type_id     uuid,
  p_room_id          uuid,
  p_check_in         date,
  p_check_out        date,
  p_guests           integer,
  p_guest            jsonb,
  p_special_requests text,
  p_idempotency_key  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_business_member(p_business_id) then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;
  if not coalesce((private.compute_entitlements(p_business_id) ->> 'access_active')::boolean, false) then
    raise exception 'subscription inactive' using errcode = '54001';
  end if;
  return private.create_reservation_core(
    p_business_id, p_room_type_id, p_room_id, p_check_in, p_check_out, p_guests, p_guest,
    p_special_requests, 'dashboard', auth.uid(), null, p_idempotency_key);
end;
$$;

-- -----------------------------------------------------------------------------
-- AI: quote, then book from that quote in a later turn.
-- -----------------------------------------------------------------------------
create or replace function public.create_reservation_quote_service(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_message_id      bigint,
  p_room_type_id    uuid,
  p_check_in        date,
  p_check_out       date,
  p_guests          integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avail record;
  v_id    uuid;
begin
  select * into v_avail
  from public.search_room_availability(p_business_id, p_check_in, p_check_out, p_guests) a
  where a.room_type_id = p_room_type_id;
  if not found then
    return jsonb_build_object('available', false, 'reason', 'room_type_unavailable_for_party');
  end if;
  if v_avail.available_rooms < 1 then
    return jsonb_build_object('available', false, 'reason', 'sold_out');
  end if;
  insert into public.reservation_quotes (
    business_id, conversation_id, room_type_id, check_in, check_out, guests_count,
    total_price_cents, currency, created_in_message_id, expires_at
  ) values (
    p_business_id, p_conversation_id, p_room_type_id, p_check_in, p_check_out, p_guests,
    v_avail.total_price_cents, v_avail.currency, p_message_id, now() + interval '30 minutes'
  ) returning id into v_id;
  return jsonb_build_object(
    'available', true, 'quote_id', v_id, 'room_type', v_avail.name, 'check_in', p_check_in, 'check_out', p_check_out,
    'nights', v_avail.nights, 'guests', p_guests, 'total_price_cents', v_avail.total_price_cents,
    'currency', v_avail.currency, 'valid_minutes', 30);
end;
$$;

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
  if p_source not in ('ai_website', 'ai_voice') then
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

-- Guest lookup: reference + matching email, nothing else.
create or replace function public.get_reservation_service(p_business_id uuid, p_reference text, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.reservation_json(r)
     from public.reservations r join public.guests g on g.id = r.guest_id
     where r.business_id = p_business_id
       and r.confirmation_reference = upper(trim(p_reference))
       and lower(g.email) = lower(trim(p_email))),
    jsonb_build_object('found', false));
$$;

-- -----------------------------------------------------------------------------
-- Cancellation
-- -----------------------------------------------------------------------------
create or replace function private.cancel_reservation_core(p_reservation_id uuid, p_reason text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if v_res.status not in ('pending', 'confirmed') then
    raise exception 'only pending or confirmed reservations can be canceled' using errcode = '55000';
  end if;
  update public.reservations
  set status = 'canceled', canceled_at = now(), canceled_by = p_actor,
      cancellation_reason = left(nullif(trim(p_reason), ''), 1000)
  where id = p_reservation_id
  returning * into v_res;
  perform private.write_audit_log(v_res.business_id, 'reservation.canceled', 'reservation', v_res.id::text, '{}'::jsonb);
  return private.reservation_json(v_res);
end;
$$;

create or replace function public.cancel_reservation(p_reservation_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.reservations where id = p_reservation_id;
  if v_business is null or not private.is_business_member(v_business) then
    raise exception 'reservation not found' using errcode = 'P0002';
  end if;
  return private.cancel_reservation_core(p_reservation_id, p_reason, auth.uid());
end;
$$;

-- AI cancellation request: cancels only when the hotel allows AI
-- cancellations AND the free-cancellation window is still open; otherwise
-- the request is handed to staff.
create or replace function public.request_cancellation_service(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_reference       text,
  p_email           text,
  p_reason          text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res        public.reservations;
  v_settings   jsonb;
  v_tz         text;
  v_hours      integer;
  v_checkin_at timestamptz;
begin
  select r.* into v_res
  from public.reservations r join public.guests g on g.id = r.guest_id
  where r.business_id = p_business_id and r.confirmation_reference = upper(trim(p_reference))
    and lower(g.email) = lower(trim(p_email));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_res.status not in ('pending', 'confirmed') then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable', 'status', v_res.status);
  end if;

  select booking_settings into v_settings from public.business_settings where business_id = p_business_id;
  select timezone into v_tz from public.businesses where id = p_business_id;
  v_hours := coalesce(nullif(v_settings ->> 'free_cancellation_hours', '')::int, 48);
  v_checkin_at := (v_res.check_in + coalesce(nullif(v_settings ->> 'check_in_time', '')::time, '14:00'::time)) at time zone v_tz;

  if coalesce((v_settings ->> 'ai_can_cancel')::boolean, false) and now() < v_checkin_at - make_interval(hours => v_hours) then
    return jsonb_build_object('ok', true, 'canceled', true,
      'reservation', private.cancel_reservation_core(v_res.id, coalesce(p_reason, 'Canceled by guest via AI assistant'), null));
  end if;

  perform public.escalate_conversation(p_business_id, p_conversation_id, jsonb_build_object(
    'reason', 'Cancellation request for ' || v_res.confirmation_reference || coalesce(': ' || left(p_reason, 300), ''),
    'reservation_id', v_res.id, 'requested_at', now()));
  return jsonb_build_object('ok', true, 'canceled', false, 'handed_to_staff', true,
    'free_cancellation_hours', v_hours, 'outside_free_window', now() >= v_checkin_at - make_interval(hours => v_hours));
end;
$$;

-- -----------------------------------------------------------------------------
-- Staff: status changes and modifications
-- -----------------------------------------------------------------------------
create or replace function public.update_reservation_status(p_reservation_id uuid, p_status public.reservation_status)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res   public.reservations;
  v_today date;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found or not private.is_business_member(v_res.business_id) then
    raise exception 'reservation not found' using errcode = 'P0002';
  end if;
  if p_status = 'canceled' then
    return private.cancel_reservation_core(p_reservation_id, null, auth.uid());
  end if;
  if not (
    (v_res.status = 'pending' and p_status = 'confirmed') or
    (v_res.status = 'confirmed' and p_status in ('checked_in', 'no_show')) or
    (v_res.status = 'checked_in' and p_status = 'checked_out')
  ) then
    raise exception 'cannot change status from % to %', v_res.status, p_status using errcode = '55000';
  end if;
  v_today := private.business_today(v_res.business_id);
  if p_status in ('checked_in', 'no_show') and v_today < v_res.check_in then
    raise exception 'too early: the stay has not started yet' using errcode = '55000';
  end if;
  update public.reservations set status = p_status where id = p_reservation_id returning * into v_res;
  return private.reservation_json(v_res);
end;
$$;

create or replace function public.modify_reservation(
  p_reservation_id uuid,
  p_check_in       date,
  p_check_out      date,
  p_guests         integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res     public.reservations;
  v_type_id uuid;
  v_max     integer;
  v_price   integer;
  v_room    record;
  v_done    boolean := false;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found or not private.is_business_member(v_res.business_id) then
    raise exception 'reservation not found' using errcode = 'P0002';
  end if;
  if v_res.status not in ('pending', 'confirmed') then
    raise exception 'only pending or confirmed reservations can be changed' using errcode = '55000';
  end if;
  perform private.validate_stay(v_res.business_id, p_check_in, p_check_out, p_guests);
  select rt.id, rt.maximum_guests into v_type_id, v_max
  from public.rooms r join public.room_types rt on rt.id = r.room_type_id where r.id = v_res.room_id;
  if p_guests > v_max then
    raise exception 'too many guests for this room type (max %)', v_max using errcode = '22023';
  end if;
  v_price := private.stay_price(v_type_id, p_check_in, p_check_out);

  -- Keep the current room if possible, otherwise move to another free room of the same type.
  for v_room in
    select r.id from public.rooms r
    where r.business_id = v_res.business_id and r.room_type_id = v_type_id and r.status = 'available'
    order by (r.id = v_res.room_id) desc, r.room_number
  loop
    begin
      update public.reservations
      set room_id = v_room.id, check_in = p_check_in, check_out = p_check_out,
          guests_count = p_guests, total_price_cents = v_price
      where id = p_reservation_id
      returning * into v_res;
      v_done := true;
      exit;
    exception when exclusion_violation then
      continue;
    end;
  end loop;
  if not v_done then
    raise exception 'no room of this type is free for the new dates' using errcode = '23P01';
  end if;
  return private.reservation_json(v_res);
end;
$$;

create or replace function public.log_reservation_email(p_reservation_id uuid, p_kind text, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.reservations where id = p_reservation_id;
  if v_business is null then
    return;
  end if;
  -- Signed-in callers must be members; anon has no EXECUTE; the service role has no auth.uid().
  if auth.uid() is not null and not private.is_business_member(v_business) then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;
  insert into public.reservation_events (business_id, reservation_id, event_type, actor_id, metadata)
  values (v_business, p_reservation_id, 'email', auth.uid(),
          jsonb_build_object('kind', left(p_kind, 40), 'status', left(p_status, 40)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function private.business_today(uuid) from public, anon;
revoke all on function private.booking_setting(uuid, text, integer) from public, anon;
revoke all on function private.stay_price(uuid, date, date) from public, anon;
revoke all on function private.validate_stay(uuid, date, date, integer) from public, anon;
revoke all on function private.create_reservation_core(uuid, uuid, uuid, date, date, integer, jsonb, text, public.reservation_source, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.cancel_reservation_core(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.reservation_json(public.reservations) from public, anon, authenticated;
-- search_room_availability is SECURITY INVOKER and calls these helpers.
grant execute on function private.business_today(uuid), private.booking_setting(uuid, text, integer),
  private.stay_price(uuid, date, date), private.validate_stay(uuid, date, date, integer)
  to authenticated, service_role;

revoke all on function public.search_room_availability(uuid, date, date, integer) from public, anon;
revoke all on function public.create_reservation(uuid, uuid, uuid, date, date, integer, jsonb, text, text) from public, anon;
revoke all on function public.cancel_reservation(uuid, text) from public, anon;
revoke all on function public.update_reservation_status(uuid, public.reservation_status) from public, anon;
revoke all on function public.modify_reservation(uuid, date, date, integer) from public, anon;
revoke all on function public.log_reservation_email(uuid, text, text) from public, anon;
grant execute on function public.search_room_availability(uuid, date, date, integer) to authenticated, service_role;
grant execute on function public.create_reservation(uuid, uuid, uuid, date, date, integer, jsonb, text, text) to authenticated;
grant execute on function public.cancel_reservation(uuid, text) to authenticated;
grant execute on function public.update_reservation_status(uuid, public.reservation_status) to authenticated;
grant execute on function public.modify_reservation(uuid, date, date, integer) to authenticated;
grant execute on function public.log_reservation_email(uuid, text, text) to authenticated, service_role;

revoke all on function public.create_reservation_quote_service(uuid, uuid, bigint, uuid, date, date, integer) from public, anon, authenticated;
revoke all on function public.create_reservation_service(uuid, uuid, bigint, uuid, jsonb, text, public.reservation_source, boolean) from public, anon, authenticated;
revoke all on function public.get_reservation_service(uuid, text, text) from public, anon, authenticated;
revoke all on function public.request_cancellation_service(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_reservation_quote_service(uuid, uuid, bigint, uuid, date, date, integer) to service_role;
grant execute on function public.create_reservation_service(uuid, uuid, bigint, uuid, jsonb, text, public.reservation_source, boolean) to service_role;
grant execute on function public.get_reservation_service(uuid, text, text) to service_role;
grant execute on function public.request_cancellation_service(uuid, uuid, text, text, text) to service_role;

create index reservations_business_room_dates_idx on public.reservations (business_id, room_id, check_in);
