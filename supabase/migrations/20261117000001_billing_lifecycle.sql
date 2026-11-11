-- =============================================================================
-- HotelAI — Migration 10: Billing lifecycle (checkout sessions, verified
-- webhook application, subscription history)
-- =============================================================================
-- Subscription state changes ONLY via apply_billing_event(), called by the
-- webhook handler AFTER the provider signature was verified. A checkout
-- redirect never changes anything.
-- =============================================================================

alter table public.subscriptions
  add column provider_updated_at timestamptz;

-- -----------------------------------------------------------------------------
-- Checkout sessions: created server-side for an owner. Only the random id is
-- sent to the browser/provider (customData.checkout_id). The webhook resolves
-- the business from this row, so tampering with customData cannot attach a
-- subscription to another business.
-- -----------------------------------------------------------------------------
create table public.billing_checkout_sessions (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  created_by        uuid references auth.users (id) on delete set null,
  provider          text not null check (provider in ('paddle')),
  plan_id           text not null references public.plans (id),
  billing_interval  public.billing_interval not null,
  provider_price_id text not null check (char_length(provider_price_id) <= 200),
  expires_at        timestamptz not null default now() + interval '7 days',
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);
create index billing_checkout_sessions_business_idx on public.billing_checkout_sessions (business_id, created_at desc);
alter table public.billing_checkout_sessions enable row level security;
revoke all on public.billing_checkout_sessions from anon, authenticated;
grant all on public.billing_checkout_sessions to service_role;

-- -----------------------------------------------------------------------------
-- Subscription history (what the provider told us, in order).
-- -----------------------------------------------------------------------------
create table public.subscription_events (
  id                bigint generated always as identity primary key,
  business_id       uuid not null references public.businesses (id) on delete cascade,
  provider          text not null,
  provider_event_id text not null,
  event_type        text not null,
  status            public.subscription_status,
  plan_id           text,
  billing_interval  public.billing_interval,
  outcome           text not null check (outcome in ('applied', 'stale', 'recorded', 'conflict')),
  occurred_at       timestamptz not null,
  details           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);
create index subscription_events_business_idx on public.subscription_events (business_id, occurred_at desc);
alter table public.subscription_events enable row level security;
revoke all on public.subscription_events from anon, authenticated;
grant select on public.subscription_events to authenticated;
grant all on public.subscription_events to service_role;
create policy subscription_events_select on public.subscription_events for select to authenticated
  using (private.has_business_role(business_id, array['owner', 'admin']::public.business_role[]));

-- -----------------------------------------------------------------------------
-- create_checkout_session: owners only; refuses if a paid subscription is
-- already running (use plan change instead).
-- -----------------------------------------------------------------------------
create or replace function public.create_checkout_session(
  p_business_id       uuid,
  p_plan_id           text,
  p_interval          public.billing_interval,
  p_provider          text,
  p_provider_price_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
  v_id  uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.has_business_role(p_business_id, array['owner']::public.business_role[]) then
    raise exception 'only owners can manage billing' using errcode = '42501';
  end if;
  if not exists (select 1 from public.plans where id = p_plan_id and is_active) then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  if p_provider is distinct from 'paddle' or coalesce(p_provider_price_id, '') = '' then
    raise exception 'billing provider not configured' using errcode = '22023';
  end if;
  select * into v_sub from public.subscriptions where business_id = p_business_id;
  if v_sub.provider_subscription_id is not null and v_sub.status in ('active', 'past_due', 'paused') then
    raise exception 'a paid subscription already exists; change the plan instead' using errcode = '55000';
  end if;
  if (select count(*) from public.billing_checkout_sessions
      where business_id = p_business_id and created_at > now() - interval '1 day') >= 30 then
    raise exception 'too many checkout attempts today' using errcode = '54000';
  end if;
  insert into public.billing_checkout_sessions (business_id, created_by, provider, plan_id, billing_interval, provider_price_id)
  values (p_business_id, auth.uid(), p_provider, p_plan_id, p_interval, p_provider_price_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- apply_billing_event: idempotent, order-aware application of a VERIFIED
-- provider event. Called only by the webhook handler (service role).
--   p_subscription: normalized provider subscription or null:
--     { id, customer_id, status, plan_id, interval, period_start, period_end,
--       cancel_at_period_end, checkout_id }
--   p_related_subscription_id: for transaction/adjustment events
-- Returns { result: applied|duplicate|stale|recorded|ignored|unresolved|conflict|invalid }
-- -----------------------------------------------------------------------------
create or replace function public.apply_billing_event(
  p_provider                text,
  p_event_id                text,
  p_event_type              text,
  p_occurred_at             timestamptz,
  p_subscription            jsonb,
  p_related_subscription_id text,
  p_payload                 jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_webhook_id   uuid;
  v_prev_status  public.webhook_processing_status;
  v_sub          public.subscriptions;
  v_business     uuid;
  v_status       public.subscription_status;
  v_plan         text;
  v_interval     public.billing_interval;
  v_provider_sub text := nullif(p_subscription ->> 'id', '');
  v_result       text;
begin
  -- 1. Idempotency ledger.
  insert into public.webhook_events (provider, provider_event_id, event_type, payload)
  values (p_provider, p_event_id, left(p_event_type, 120), p_payload)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_webhook_id;

  if v_webhook_id is null then
    select id, processing_status into v_webhook_id, v_prev_status
    from public.webhook_events where provider = p_provider and provider_event_id = p_event_id
    for update;
    if v_prev_status in ('processed', 'ignored') then
      return jsonb_build_object('result', 'duplicate');
    end if;
  end if;

  -- 2. Resolve the business: known subscription id first, then our checkout session.
  select * into v_sub from public.subscriptions
  where provider_subscription_id = coalesce(v_provider_sub, nullif(p_related_subscription_id, ''));
  v_business := v_sub.business_id;
  if v_business is null and p_subscription ? 'checkout_id' and (p_subscription ->> 'checkout_id') ~ '^[0-9a-f-]{36}$' then
    select business_id into v_business from public.billing_checkout_sessions
    where id = (p_subscription ->> 'checkout_id')::uuid and provider = p_provider;
  end if;

  if v_business is null then
    update public.webhook_events set processing_status = (case when p_subscription is null then 'ignored' else 'failed' end)::public.webhook_processing_status,
      error = case when p_subscription is null then null else 'unresolved business' end, processed_at = now()
    where id = v_webhook_id;
    return jsonb_build_object('result', case when p_subscription is null then 'ignored' else 'unresolved' end);
  end if;

  -- 3. Non-subscription events (payments, refunds): record in history only.
  if p_subscription is null then
    insert into public.subscription_events (business_id, provider, provider_event_id, event_type, outcome, occurred_at, details)
    values (v_business, p_provider, p_event_id, p_event_type, 'recorded', p_occurred_at,
            jsonb_strip_nulls(jsonb_build_object('related_subscription_id', p_related_subscription_id)));
    update public.webhook_events set processing_status = 'processed', processed_at = now() where id = v_webhook_id;
    return jsonb_build_object('result', 'recorded', 'business_id', v_business);
  end if;

  -- 4. Validate the normalized subscription.
  begin
    v_status := (p_subscription ->> 'status')::public.subscription_status;
    v_interval := nullif(p_subscription ->> 'interval', '')::public.billing_interval;
  exception when invalid_text_representation then
    v_status := null;
  end;
  v_plan := p_subscription ->> 'plan_id';
  if v_status is null or v_status = 'trialing' or not exists (select 1 from public.plans where id = v_plan) then
    update public.webhook_events set processing_status = 'failed', error = 'invalid subscription payload (status/plan)', processed_at = now()
    where id = v_webhook_id;
    return jsonb_build_object('result', 'invalid');
  end if;

  select * into v_sub from public.subscriptions where business_id = v_business for update;

  -- 5. Never let one provider subscription be attached to two businesses, and
  --    don't silently replace a different live subscription.
  if exists (select 1 from public.subscriptions where provider_subscription_id = v_provider_sub and business_id <> v_business)
     or (v_sub.provider_subscription_id is not null and v_sub.provider_subscription_id <> v_provider_sub
         and v_sub.status in ('active', 'past_due', 'paused') and v_status in ('active', 'past_due', 'paused')) then
    v_result := 'conflict';
  elsif v_sub.provider_updated_at is not null and p_occurred_at < v_sub.provider_updated_at
        and v_sub.provider_subscription_id = v_provider_sub then
    v_result := 'stale';  -- out-of-order delivery: an older event than what we applied
  else
    v_result := 'applied';
    update public.subscriptions set
      billing_provider = p_provider,
      provider_customer_id = nullif(p_subscription ->> 'customer_id', ''),
      provider_subscription_id = v_provider_sub,
      plan_id = v_plan,
      billing_interval = v_interval,
      status = v_status,
      current_period_start = nullif(p_subscription ->> 'period_start', '')::timestamptz,
      current_period_end = nullif(p_subscription ->> 'period_end', '')::timestamptz,
      cancel_at_period_end = coalesce((p_subscription ->> 'cancel_at_period_end')::boolean, false),
      provider_updated_at = p_occurred_at
    where business_id = v_business;

    if p_subscription ? 'checkout_id' and (p_subscription ->> 'checkout_id') ~ '^[0-9a-f-]{36}$' then
      update public.billing_checkout_sessions set completed_at = coalesce(completed_at, now())
      where id = (p_subscription ->> 'checkout_id')::uuid and business_id = v_business;
    end if;
  end if;

  insert into public.subscription_events (business_id, provider, provider_event_id, event_type, status, plan_id, billing_interval, outcome, occurred_at, details)
  values (v_business, p_provider, p_event_id, p_event_type, v_status, v_plan, v_interval, v_result, p_occurred_at,
          jsonb_build_object('subscription_id', v_provider_sub, 'period_end', p_subscription ->> 'period_end',
                             'cancel_at_period_end', p_subscription -> 'cancel_at_period_end'));

  update public.webhook_events
  set processing_status = (case when v_result = 'conflict' then 'failed' else 'processed' end)::public.webhook_processing_status,
      error = case when v_result = 'conflict' then 'subscription conflict: needs manual review' end,
      processed_at = now()
  where id = v_webhook_id;

  return jsonb_build_object('result', v_result, 'business_id', v_business, 'status', v_status);
end;
$$;

revoke all on function public.create_checkout_session(uuid, text, public.billing_interval, text, text) from public, anon;
grant execute on function public.create_checkout_session(uuid, text, public.billing_interval, text, text) to authenticated;
revoke all on function public.apply_billing_event(text, text, text, timestamptz, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_billing_event(text, text, text, timestamptz, jsonb, text, jsonb) to service_role;
