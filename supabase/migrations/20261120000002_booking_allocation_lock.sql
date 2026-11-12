-- =============================================================================
-- HotelAI — Migration: serialize room allocation per room type
-- Found by CI: under concurrency, conflicting inserts checked by the
-- double-booking exclusion constraint could deadlock (40P01). Inventory was
-- never exceeded, but a guest could get a technical error instead of a clean
-- "sold out" answer. Both allocating functions now take a per-room-type
-- transaction lock first. Bodies are otherwise unchanged.
-- =============================================================================

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

  -- Bookings of the same room type take turns. Without this, concurrent
  -- inserts that conflict in the exclusion constraint can deadlock (40P01)
  -- instead of cleanly reporting "sold out". Held until commit; only blocks
  -- other bookings of this one room type.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('room_alloc:' || p_room_type_id::text, 0));

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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('room_alloc:' || v_type_id::text, 0));

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
