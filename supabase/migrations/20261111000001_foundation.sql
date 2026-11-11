-- =============================================================================
-- HotelAI — Migration 1: Foundation (identity, workspaces, membership, audit)
-- =============================================================================
-- Security model (see docs/architecture/0002-multi-tenancy-and-rls.md):
--   * Every tenant-owned row carries business_id.
--   * Row Level Security is enabled on every table in `public`.
--   * Membership checks run inside SECURITY DEFINER helpers in the `private`
--     schema, which is NOT exposed through the Supabase Data API.
--   * Privileges are granted explicitly per table instead of relying on
--     platform defaults, so the effective access surface is reviewable here.
--   * Sensitive multi-step writes (workspace creation, role changes) happen
--     only through SECURITY DEFINER functions that re-check auth.uid().
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
create type public.business_role as enum ('owner', 'admin', 'manager', 'staff');
create type public.membership_status as enum ('invited', 'active', 'revoked');
create type public.industry as enum (
  'hotel', 'restaurant', 'beauty_salon', 'clinic', 'real_estate', 'other'
);

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles: 1:1 with auth.users
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 200),
  email       text check (char_length(email) <= 320),
  avatar_url  text check (char_length(avatar_url) <= 2048),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Create a profile automatically whenever Supabase Auth creates a user.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 200), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keep profile email in sync when the user confirms an email change.
create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- businesses: the tenant
-- -----------------------------------------------------------------------------
create table public.businesses (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(trim(name)) between 2 and 120),
  industry            public.industry not null,
  description         text check (char_length(description) <= 5000),
  contact_email       text check (char_length(contact_email) <= 320),
  phone               text check (char_length(phone) <= 40),
  website             text check (char_length(website) <= 2048),
  country             text check (char_length(country) <= 2), -- ISO 3166-1 alpha-2
  city                text check (char_length(city) <= 120),
  address             text check (char_length(address) <= 500),
  timezone            text not null default 'UTC' check (char_length(timezone) <= 64),
  default_language    text not null default 'en' check (default_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  supported_languages text[] not null default array['en'],
  onboarding_completed_at timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint businesses_supported_languages_size
    check (cardinality(supported_languages) between 1 and 20)
);

create index businesses_created_by_idx on public.businesses (created_by);

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- business_members: who can access which business, and with which role
-- -----------------------------------------------------------------------------
create table public.business_members (
  business_id       uuid not null references public.businesses (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  role              public.business_role not null default 'staff',
  invitation_status public.membership_status not null default 'invited',
  invited_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index business_members_user_idx on public.business_members (user_id, invitation_status);

create trigger business_members_set_updated_at
  before update on public.business_members
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- business_settings: one row per business (JSON documents validated in app)
-- -----------------------------------------------------------------------------
create table public.business_settings (
  business_id              uuid primary key references public.businesses (id) on delete cascade,
  opening_hours            jsonb not null default '{}'::jsonb,
  policies                 jsonb not null default '{}'::jsonb,
  notification_preferences jsonb not null default '{}'::jsonb,
  brand_settings           jsonb not null default '{}'::jsonb,
  booking_settings         jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create trigger business_settings_set_updated_at
  before update on public.business_settings
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- platform_admins: SaaS operator staff. Only grantable with the service role
-- or directly in SQL — there is deliberately no client-facing write path.
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- audit_logs: append-only record of security-sensitive actions
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  business_id uuid references public.businesses (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null check (char_length(action) <= 100),
  entity_type text check (char_length(entity_type) <= 100),
  entity_id   text check (char_length(entity_id) <= 200),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_logs_business_created_idx on public.audit_logs (business_id, created_at desc);

-- Append-only: block updates and deletes for everyone except table owner.
create or replace function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_no_update
  before update on public.audit_logs
  for each row execute function private.prevent_audit_mutation();

create or replace function private.write_audit_log(
  p_business_id uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   text,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_business_id, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- Authorization helpers used by RLS policies.
-- SECURITY DEFINER so they can read business_members without recursing into
-- business_members' own RLS policies. They only ever answer about auth.uid().
-- -----------------------------------------------------------------------------
create or replace function private.is_business_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.invitation_status = 'active'
  );
$$;

create or replace function private.has_business_role(
  p_business_id uuid,
  p_roles public.business_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.invitation_status = 'active'
      and m.role = any (p_roles)
  );
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins a where a.user_id = (select auth.uid())
  );
$$;

-- True when the current user shares at least one active business with p_user_id.
create or replace function private.shares_business_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members mine
    join public.business_members theirs
      on theirs.business_id = mine.business_id
    where mine.user_id = (select auth.uid())
      and mine.invitation_status = 'active'
      and theirs.user_id = p_user_id
      and theirs.invitation_status in ('active', 'invited')
  );
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_business_member(uuid),
  private.has_business_role(uuid, public.business_role[]),
  private.is_platform_admin(),
  private.shares_business_with(uuid)
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.businesses        enable row level security;
alter table public.business_members  enable row level security;
alter table public.business_settings enable row level security;
alter table public.platform_admins   enable row level security;
alter table public.audit_logs        enable row level security;

-- Explicit privileges: anon gets nothing on tenant tables.
revoke all on public.profiles, public.businesses, public.business_members,
  public.business_settings, public.platform_admins, public.audit_logs
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

grant select on public.businesses to authenticated;
grant update (name, description, contact_email, phone, website, country, city,
  address, timezone, default_language, supported_languages)
  on public.businesses to authenticated;

grant select on public.business_members to authenticated;

grant select on public.business_settings to authenticated;
grant update (opening_hours, policies, notification_preferences, brand_settings, booking_settings)
  on public.business_settings to authenticated;

grant select on public.platform_admins to authenticated;
grant select on public.audit_logs to authenticated;

grant all on public.profiles, public.businesses, public.business_members,
  public.business_settings, public.platform_admins, public.audit_logs
  to service_role;

-- profiles ---------------------------------------------------------------------
create policy profiles_select_self_or_teammate on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_business_with(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- No INSERT/DELETE policies: rows are managed by auth triggers / cascades.

-- businesses -------------------------------------------------------------------
create policy businesses_select_members on public.businesses
  for select to authenticated
  using (private.is_business_member(id));

create policy businesses_update_owner_admin on public.businesses
  for update to authenticated
  using (private.has_business_role(id, array['owner', 'admin']::public.business_role[]))
  with check (private.has_business_role(id, array['owner', 'admin']::public.business_role[]));
-- No INSERT policy: workspaces are created only via public.create_business_workspace().
-- No DELETE policy: workspace deletion will be a dedicated, audited flow.

-- business_members -------------------------------------------------------------
create policy business_members_select_same_business on public.business_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_business_member(business_id));
-- No direct INSERT/UPDATE/DELETE: use the membership functions below, which
-- enforce role hierarchy and the "at least one owner" invariant.

-- business_settings ------------------------------------------------------------
create policy business_settings_select_members on public.business_settings
  for select to authenticated
  using (private.is_business_member(business_id));

create policy business_settings_update_owner_admin on public.business_settings
  for update to authenticated
  using (private.has_business_role(business_id, array['owner', 'admin']::public.business_role[]))
  with check (private.has_business_role(business_id, array['owner', 'admin']::public.business_role[]));

-- platform_admins: a user may check whether they themselves are an admin.
create policy platform_admins_select_self on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- audit_logs: owners and admins can read their business's audit trail.
create policy audit_logs_select_owner_admin on public.audit_logs
  for select to authenticated
  using (
    business_id is not null
    and private.has_business_role(business_id, array['owner', 'admin']::public.business_role[])
  );

-- -----------------------------------------------------------------------------
-- Membership management functions
-- Rules:
--   * Only owners can grant/revoke the owner or admin role.
--   * Admins can manage managers and staff.
--   * A business must always keep at least one active owner.
-- -----------------------------------------------------------------------------
create or replace function public.update_member_role(
  p_business_id uuid,
  p_user_id     uuid,
  p_new_role    public.business_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role  public.business_role;
  v_target_role public.business_role;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select role into v_actor_role
  from public.business_members
  where business_id = p_business_id and user_id = auth.uid() and invitation_status = 'active';

  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;

  select role into v_target_role
  from public.business_members
  where business_id = p_business_id and user_id = p_user_id
  for update;

  if v_target_role is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  if v_actor_role <> 'owner'
     and (v_target_role in ('owner', 'admin') or p_new_role in ('owner', 'admin')) then
    raise exception 'only owners can manage owners and admins' using errcode = '42501';
  end if;

  if v_target_role = 'owner' and p_new_role <> 'owner' then
    perform 1 from public.business_members
    where business_id = p_business_id and role = 'owner' and invitation_status = 'active'
    for update;
    if (select count(*) from public.business_members
        where business_id = p_business_id and role = 'owner' and invitation_status = 'active') <= 1 then
      raise exception 'a business must keep at least one owner' using errcode = '23514';
    end if;
  end if;

  update public.business_members
  set role = p_new_role
  where business_id = p_business_id and user_id = p_user_id;

  perform private.write_audit_log(
    p_business_id, 'member.role_changed', 'business_member', p_user_id::text,
    jsonb_build_object('from', v_target_role, 'to', p_new_role)
  );
end;
$$;

create or replace function public.remove_business_member(
  p_business_id uuid,
  p_user_id     uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role  public.business_role;
  v_target_role public.business_role;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select role into v_actor_role
  from public.business_members
  where business_id = p_business_id and user_id = auth.uid() and invitation_status = 'active';

  if v_actor_role is null then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;

  select role into v_target_role
  from public.business_members
  where business_id = p_business_id and user_id = p_user_id
  for update;

  if v_target_role is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  -- Anyone may leave a business themselves; otherwise owner/admin rules apply.
  if p_user_id <> auth.uid() then
    if v_actor_role not in ('owner', 'admin') then
      raise exception 'insufficient permissions' using errcode = '42501';
    end if;
    if v_actor_role <> 'owner' and v_target_role in ('owner', 'admin') then
      raise exception 'only owners can remove owners and admins' using errcode = '42501';
    end if;
  end if;

  if v_target_role = 'owner' then
    perform 1 from public.business_members
    where business_id = p_business_id and role = 'owner' and invitation_status = 'active'
    for update;
    if (select count(*) from public.business_members
        where business_id = p_business_id and role = 'owner' and invitation_status = 'active') <= 1 then
      raise exception 'a business must keep at least one owner' using errcode = '23514';
    end if;
  end if;

  delete from public.business_members
  where business_id = p_business_id and user_id = p_user_id;

  perform private.write_audit_log(
    p_business_id, 'member.removed', 'business_member', p_user_id::text,
    jsonb_build_object('role', v_target_role)
  );
end;
$$;

revoke all on function public.update_member_role(uuid, uuid, public.business_role) from public, anon;
revoke all on function public.remove_business_member(uuid, uuid) from public, anon;
grant execute on function public.update_member_role(uuid, uuid, public.business_role) to authenticated;
grant execute on function public.remove_business_member(uuid, uuid) to authenticated;
