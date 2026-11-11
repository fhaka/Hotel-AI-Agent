-- =============================================================================
-- HotelAI — Migration 3: Hotel inventory, guests, reservations
-- =============================================================================
-- Tenant integrity: child rows reference parents with composite foreign keys
-- (business_id, id), so a row in business A can never point at a room, room
-- type or guest that belongs to business B — even via the service role.
--
-- Double-booking prevention: an exclusion constraint forbids two active
-- reservations for the same room with overlapping [check_in, check_out)
-- ranges. This holds under concurrency because PostgreSQL enforces it at
-- commit time, independent of application logic or the AI model.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- room_types
-- -----------------------------------------------------------------------------
create table public.room_types (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  name              text not null check (char_length(trim(name)) between 1 and 120),
  description       text check (char_length(description) <= 5000),
  maximum_guests    integer not null check (maximum_guests between 1 and 50),
  bed_configuration text check (char_length(bed_configuration) <= 200),
  amenities         text[] not null default '{}',
  base_price_cents  integer not null check (base_price_cents >= 0),
  currency          char(3) not null default 'EUR',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);

create trigger room_types_set_updated_at
  before update on public.room_types
  for each row execute function private.set_updated_at();

-- Seasonal pricing: a nightly price override for a date range.
create table public.room_type_rates (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null,
  room_type_id       uuid not null,
  name               text check (char_length(name) <= 120),
  starts_on          date not null,
  ends_on            date not null, -- exclusive
  nightly_price_cents integer not null check (nightly_price_cents >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint room_type_rates_range check (ends_on > starts_on),
  foreign key (business_id, room_type_id)
    references public.room_types (business_id, id) on delete cascade,
  constraint room_type_rates_no_overlap exclude using gist (
    room_type_id with =,
    daterange(starts_on, ends_on, '[)') with &&
  )
);

create index room_type_rates_lookup_idx on public.room_type_rates (business_id, room_type_id, starts_on);

create trigger room_type_rates_set_updated_at
  before update on public.room_type_rates
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- rooms: physical units
-- -----------------------------------------------------------------------------
create type public.room_status as enum ('available', 'out_of_service', 'retired');

create table public.rooms (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  room_type_id uuid not null,
  room_number  text not null check (char_length(trim(room_number)) between 1 and 20),
  status       public.room_status not null default 'available',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, room_number),
  foreign key (business_id, room_type_id)
    references public.room_types (business_id, id) on delete restrict
);

create index rooms_room_type_idx on public.rooms (business_id, room_type_id);

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- guests
-- -----------------------------------------------------------------------------
create table public.guests (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses (id) on delete cascade,
  full_name          text not null check (char_length(trim(full_name)) between 1 and 200),
  email              text check (char_length(email) <= 320),
  phone              text check (char_length(phone) <= 40),
  preferred_language text check (preferred_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  notes              text check (char_length(notes) <= 5000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (business_id, id)
);

create index guests_business_email_idx on public.guests (business_id, lower(email));
create index guests_business_name_idx on public.guests (business_id, lower(full_name));

create trigger guests_set_updated_at
  before update on public.guests
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- reservations
-- -----------------------------------------------------------------------------
create type public.reservation_status as enum (
  'pending', 'confirmed', 'canceled', 'checked_in', 'checked_out', 'no_show'
);
create type public.reservation_source as enum (
  'dashboard', 'ai_website', 'ai_voice', 'phone', 'email', 'walk_in', 'other'
);

create table public.reservations (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses (id) on delete cascade,
  room_id                uuid not null,
  guest_id               uuid not null,
  check_in               date not null,
  check_out              date not null,
  guests_count           integer not null check (guests_count between 1 and 50),
  total_price_cents      integer not null check (total_price_cents >= 0),
  currency               char(3) not null default 'EUR',
  status                 public.reservation_status not null default 'pending',
  source                 public.reservation_source not null default 'dashboard',
  confirmation_reference text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  special_requests       text check (char_length(special_requests) <= 2000),
  created_by             uuid references auth.users (id) on delete set null,
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint reservations_date_range check (check_out > check_in),
  constraint reservations_max_stay check (check_out - check_in <= 365),
  unique (business_id, id),
  unique (business_id, confirmation_reference),
  foreign key (business_id, room_id)
    references public.rooms (business_id, id) on delete restrict,
  foreign key (business_id, guest_id)
    references public.guests (business_id, id) on delete restrict,
  -- THE double-booking guarantee:
  constraint reservations_no_overlap exclude using gist (
    room_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (status in ('pending', 'confirmed', 'checked_in'))
);

create index reservations_business_dates_idx on public.reservations (business_id, check_in, check_out);
create index reservations_business_status_idx on public.reservations (business_id, status);
create index reservations_guest_idx on public.reservations (business_id, guest_id);

create trigger reservations_set_updated_at
  before update on public.reservations
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS & privileges
-- Room configuration: owner/admin/manager. Guests & reservations: all active
-- members (front-desk staff need them). Hard deletes are restricted; normal
-- workflow is to cancel reservations rather than delete them.
-- -----------------------------------------------------------------------------
alter table public.room_types      enable row level security;
alter table public.room_type_rates enable row level security;
alter table public.rooms           enable row level security;
alter table public.guests          enable row level security;
alter table public.reservations    enable row level security;

revoke all on public.room_types, public.room_type_rates, public.rooms,
  public.guests, public.reservations from anon, authenticated;
grant select, insert, update, delete on public.room_types, public.room_type_rates,
  public.rooms, public.guests to authenticated;
grant select, insert, update on public.reservations to authenticated;
grant all on public.room_types, public.room_type_rates, public.rooms,
  public.guests, public.reservations to service_role;

-- room_types
create policy room_types_select on public.room_types for select to authenticated
  using (private.is_business_member(business_id));
create policy room_types_insert on public.room_types for insert to authenticated
  with check (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]));
create policy room_types_update on public.room_types for update to authenticated
  using (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]))
  with check (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]));
create policy room_types_delete on public.room_types for delete to authenticated
  using (private.has_business_role(business_id, array['owner','admin']::public.business_role[]));

-- room_type_rates
create policy room_type_rates_select on public.room_type_rates for select to authenticated
  using (private.is_business_member(business_id));
create policy room_type_rates_insert on public.room_type_rates for insert to authenticated
  with check (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]));
create policy room_type_rates_update on public.room_type_rates for update to authenticated
  using (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]))
  with check (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]));
create policy room_type_rates_delete on public.room_type_rates for delete to authenticated
  using (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]));

-- rooms
create policy rooms_select on public.rooms for select to authenticated
  using (private.is_business_member(business_id));
create policy rooms_insert on public.rooms for insert to authenticated
  with check (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]));
create policy rooms_update on public.rooms for update to authenticated
  using (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]))
  with check (private.has_business_role(business_id, array['owner','admin','manager']::public.business_role[]));
create policy rooms_delete on public.rooms for delete to authenticated
  using (private.has_business_role(business_id, array['owner','admin']::public.business_role[]));

-- guests
create policy guests_select on public.guests for select to authenticated
  using (private.is_business_member(business_id));
create policy guests_insert on public.guests for insert to authenticated
  with check (private.is_business_member(business_id));
create policy guests_update on public.guests for update to authenticated
  using (private.is_business_member(business_id))
  with check (private.is_business_member(business_id));
create policy guests_delete on public.guests for delete to authenticated
  using (private.has_business_role(business_id, array['owner','admin']::public.business_role[]));

-- reservations (no DELETE grant: cancel instead)
create policy reservations_select on public.reservations for select to authenticated
  using (private.is_business_member(business_id));
create policy reservations_insert on public.reservations for insert to authenticated
  with check (private.is_business_member(business_id) and created_by = (select auth.uid()));
create policy reservations_update on public.reservations for update to authenticated
  using (private.is_business_member(business_id))
  with check (private.is_business_member(business_id));
