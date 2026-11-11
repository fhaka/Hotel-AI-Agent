-- =============================================================================
-- HotelAI — Migration 2: Plans, subscriptions, trials, webhook idempotency
-- =============================================================================
-- Clients can READ their own business's subscription but can never write to
-- it. Subscription state changes only through:
--   * public.create_business_workspace()  (starts the trial)
--   * the billing webhook handler using the service role (verified events)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- platform_settings: operator-tunable configuration (trial length, limits).
-- Not readable by clients; consumed through SECURITY DEFINER functions.
-- -----------------------------------------------------------------------------
create table public.platform_settings (
  key        text primary key check (char_length(key) <= 100),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value) values
  ('trial', jsonb_build_object(
    'days', 7,
    'max_trials_per_user', 1,
    'plan_id', 'growth',
    'usage_limits', jsonb_build_object(
      'ai_messages_per_month', 300,
      'ai_tokens_per_month', 600000,
      'voice_minutes_per_month', 0,
      'agents', 2,
      'members', 3
    )
  )),
  ('workspaces', jsonb_build_object('max_created_per_user', 10));

-- -----------------------------------------------------------------------------
-- plans: catalogue. Prices in minor units (cents) to avoid float rounding.
-- Prices here are ILLUSTRATIVE starting points, not validated market prices.
-- -----------------------------------------------------------------------------
create table public.plans (
  id                  text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name                text not null check (char_length(name) <= 80),
  description         text check (char_length(description) <= 1000),
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  annual_price_cents  integer not null check (annual_price_cents >= 0),
  currency            char(3) not null default 'EUR',
  usage_limits        jsonb not null default '{}'::jsonb,
  features            jsonb not null default '[]'::jsonb,
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function private.set_updated_at();

insert into public.plans (id, name, description, monthly_price_cents, annual_price_cents, usage_limits, features, sort_order) values
  ('basic', 'Basic', 'One AI website receptionist for a single property.', 9900, 99000,
    '{"ai_messages_per_month": 1000, "ai_tokens_per_month": 2000000, "voice_minutes_per_month": 0, "agents": 1, "members": 2}',
    '["website_receptionist", "knowledge_base", "basic_reports", "email_support"]', 1),
  ('growth', 'Growth', 'Reservation workflows and automation for growing properties.', 19900, 199000,
    '{"ai_messages_per_month": 5000, "ai_tokens_per_month": 10000000, "voice_minutes_per_month": 0, "agents": 2, "members": 5}',
    '["website_receptionist", "reservation_assistant", "knowledge_base", "automations", "calendar", "advanced_reports", "email_support"]', 2),
  ('business', 'Business', 'All agents, voice allowance and multi-user workspaces.', 39900, 399000,
    '{"ai_messages_per_month": 20000, "ai_tokens_per_month": 40000000, "voice_minutes_per_month": 300, "agents": 3, "members": 20}',
    '["website_receptionist", "reservation_assistant", "voice_receptionist", "knowledge_base", "automations", "calendar", "advanced_reports", "integrations", "priority_support"]', 3);

-- -----------------------------------------------------------------------------
-- subscriptions: exactly one current subscription row per business.
-- -----------------------------------------------------------------------------
create type public.subscription_status as enum (
  'trialing',   -- free trial in progress (check trial_ends_at!)
  'active',     -- paid, verified by billing webhook
  'past_due',   -- payment failed, provider retrying
  'paused',
  'canceled',   -- canceled; may still be inside paid period
  'expired',    -- trial or paid period ended without payment
  'incomplete'  -- no trial available and no payment yet
);

create type public.billing_interval as enum ('month', 'year');

create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null unique references public.businesses (id) on delete cascade,
  billing_provider         text check (billing_provider in ('paddle')),
  provider_customer_id     text check (char_length(provider_customer_id) <= 200),
  provider_subscription_id text unique check (char_length(provider_subscription_id) <= 200),
  plan_id                  text not null references public.plans (id),
  billing_interval         public.billing_interval,
  status                   public.subscription_status not null,
  trial_started_at         timestamptz,
  trial_ends_at            timestamptz,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint subscriptions_trial_window
    check (trial_ends_at is null or trial_started_at is not null and trial_ends_at > trial_started_at),
  constraint subscriptions_trialing_requires_dates
    check (status <> 'trialing' or (trial_started_at is not null and trial_ends_at is not null))
);

create index subscriptions_status_idx on public.subscriptions (status, trial_ends_at);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function private.set_updated_at();

-- Trial timestamps are immutable once set, even for the service role, unless
-- an operator explicitly sets `hotelai.allow_trial_edit = on` in their session.
create or replace function private.protect_trial_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.trial_started_at is distinct from new.trial_started_at
      or old.trial_ends_at is distinct from new.trial_ends_at)
     and coalesce(current_setting('hotelai.allow_trial_edit', true), 'off') <> 'on' then
    raise exception 'trial dates are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger subscriptions_protect_trial_dates
  before update on public.subscriptions
  for each row execute function private.protect_trial_dates();

-- -----------------------------------------------------------------------------
-- trial_grants: one row per user who has received a free trial. Prevents
-- "create another workspace to get another trial". Keyed by auth user id,
-- which cannot be changed by clearing browser data or editing requests.
-- -----------------------------------------------------------------------------
create table public.trial_grants (
  user_id     uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  granted_at  timestamptz not null default now(),
  primary key (user_id, business_id)
);

-- -----------------------------------------------------------------------------
-- webhook_events: idempotency ledger for billing (and later other) webhooks.
-- -----------------------------------------------------------------------------
create type public.webhook_processing_status as enum ('received', 'processed', 'failed', 'ignored');

create table public.webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null check (char_length(provider) <= 40),
  provider_event_id text not null check (char_length(provider_event_id) <= 200),
  event_type        text not null check (char_length(event_type) <= 120),
  payload           jsonb,
  processing_status public.webhook_processing_status not null default 'received',
  error             text check (char_length(error) <= 2000),
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  constraint webhook_events_provider_event_unique unique (provider, provider_event_id)
);

-- -----------------------------------------------------------------------------
-- RLS & privileges
-- -----------------------------------------------------------------------------
alter table public.platform_settings enable row level security;
alter table public.plans             enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.trial_grants      enable row level security;
alter table public.webhook_events    enable row level security;

revoke all on public.platform_settings, public.plans, public.subscriptions,
  public.trial_grants, public.webhook_events from anon, authenticated;

grant all on public.platform_settings, public.plans, public.subscriptions,
  public.trial_grants, public.webhook_events to service_role;

-- Plans are public marketing information (active plans only).
grant select on public.plans to anon, authenticated;
create policy plans_select_active on public.plans
  for select to anon, authenticated
  using (is_active);

-- Members can see their business's subscription; nobody can write it.
grant select on public.subscriptions to authenticated;
create policy subscriptions_select_members on public.subscriptions
  for select to authenticated
  using (private.is_business_member(business_id));

-- platform_settings, trial_grants, webhook_events: no client access at all
-- (RLS enabled with no policies + no grants).
