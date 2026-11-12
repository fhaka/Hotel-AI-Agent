-- =============================================================================
-- HotelAI — Migration: Operations (Phase 10)
--   1. Operator controls on businesses: suspension, per-business limit overrides
--   2. Platform settings: agent availability, operational data retention
--   3. compute_entitlements v3: suspension, overrides, platform agent switch
--   4. Platform admin functions (every one checks platform_admins itself)
--   5. Privacy: workspace data export, guest erasure, workspace deletion
--   6. Retention of operational data (scheduled job)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Operator-only columns. No client UPDATE grant exists for them.
-- -----------------------------------------------------------------------------
alter table public.businesses
  add column suspended_at      timestamptz,
  add column suspension_reason text check (char_length(suspension_reason) <= 500),
  add column limit_overrides   jsonb not null default '{}'::jsonb
    check (jsonb_typeof(limit_overrides) = 'object' and octet_length(limit_overrides::text) <= 2000);

-- -----------------------------------------------------------------------------
-- 2. Settings
-- -----------------------------------------------------------------------------
insert into public.platform_settings (key, value) values
  ('agent_availability', jsonb_build_object(
    'website_receptionist', true, 'reservation_assistant', true, 'voice_receptionist', true)),
  ('retention', jsonb_build_object(
    'notification_days', 180, 'job_run_days', 90, 'webhook_payload_days', 90, 'audit_log_days', 730))
on conflict (key) do nothing;

-- Trial grants survive workspace deletion; otherwise deleting a workspace
-- would hand out a fresh free trial.
alter table public.trial_grants drop constraint trial_grants_pkey;
alter table public.trial_grants drop constraint trial_grants_business_id_fkey;
alter table public.trial_grants
  add column id bigint generated always as identity primary key,
  alter column business_id drop not null,
  add constraint trial_grants_business_id_fkey foreign key (business_id)
    references public.businesses (id) on delete set null;
create unique index trial_grants_user_business_unique on public.trial_grants (user_id, business_id);
create index trial_grants_user_idx on public.trial_grants (user_id);

-- Audit entries about deleted workspaces must outlive them, unchanged (the
-- log is append-only), so business_id becomes a plain historical reference.
alter table public.audit_logs drop constraint audit_logs_business_id_fkey;
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

-- -----------------------------------------------------------------------------
-- 3. Entitlements v3
-- -----------------------------------------------------------------------------
create or replace function private.compute_entitlements(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now          timestamptz := now();
  v_sub          public.subscriptions;
  v_plan         public.plans;
  v_trial        jsonb;
  v_is_trial     boolean;
  v_trial_over   boolean := false;
  v_access       boolean := false;
  v_reason       text;
  v_period_start timestamptz;
  v_period_end   timestamptz;
  v_limits       jsonb;
  v_usage        jsonb;
  v_members      integer;
  v_pending      integer;
  v_agents       jsonb;
  v_biz          public.businesses;
  v_avail        jsonb;
  v_features     jsonb;
begin
  select * into v_sub from public.subscriptions where business_id = p_business_id;
  if not found then
    return jsonb_build_object('access_active', false, 'reason', 'no_subscription', 'evaluated_at', v_now);
  end if;

  select * into v_biz from public.businesses where id = p_business_id;
  select * into v_plan from public.plans where id = v_sub.plan_id;
  select value into v_avail from public.platform_settings where key = 'agent_availability';
  select value into v_trial from public.platform_settings where key = 'trial';
  v_is_trial := v_sub.status = 'trialing';

  case v_sub.status
    when 'trialing' then
      v_trial_over := v_sub.trial_ends_at <= v_now;
      v_access := not v_trial_over;
      v_reason := case when v_trial_over then 'trial_expired' end;
    when 'active' then
      v_access := true;
    when 'past_due' then
      -- Provider is retrying the payment; keep service running (dunning grace).
      v_access := true;
      v_reason := 'payment_past_due';
    when 'canceled' then
      v_access := v_sub.current_period_end is not null and v_sub.current_period_end > v_now;
      v_reason := case when v_access then 'cancels_at_period_end' else 'subscription_canceled' end;
    when 'paused' then
      v_reason := 'subscription_paused';
    when 'expired' then
      v_reason := case when v_sub.trial_ends_at is not null and v_sub.current_period_end is null
                       then 'trial_expired' else 'subscription_expired' end;
    else -- incomplete
      v_reason := 'no_active_plan';
  end case;

  -- Operator suspension overrides every subscription state.
  if v_biz.suspended_at is not null then
    v_access := false;
    v_reason := 'suspended';
  end if;

  -- Usage period and limits: trial window + trial limits, or billing period
  -- + plan limits, or (no billing period yet) the current UTC calendar month.
  if v_is_trial then
    v_period_start := v_sub.trial_started_at;
    v_period_end   := v_sub.trial_ends_at;
    v_limits       := coalesce(v_trial -> 'usage_limits', '{}'::jsonb);
  elsif v_sub.current_period_start is not null then
    v_period_start := v_sub.current_period_start;
    v_period_end   := v_sub.current_period_end;
    v_limits       := coalesce(v_plan.usage_limits, '{}'::jsonb);
  else
    v_period_start := date_trunc('month', v_now, 'UTC');
    v_period_end   := v_period_start + interval '1 month';
    v_limits       := coalesce(v_plan.usage_limits, '{}'::jsonb);
  end if;
  -- Per-business limit overrides set by the operator (validated on write).
  v_limits := v_limits || coalesce(v_biz.limit_overrides, '{}'::jsonb);

  -- Agent types the operator switched off platform-wide are removed from the
  -- feature list, so every check that requires the feature denies them.
  select coalesce(jsonb_agg(f), '[]'::jsonb) into v_features
  from jsonb_array_elements(coalesce(v_plan.features, '[]'::jsonb)) f
  where coalesce(v_avail -> (f #>> '{}'), 'true'::jsonb) <> 'false'::jsonb;

  select jsonb_build_object(
    'ai_messages',   coalesce(sum(quantity) filter (where event_type = 'ai_message'), 0),
    'ai_tokens',     coalesce(sum(quantity) filter (where event_type in ('ai_input_tokens', 'ai_output_tokens')), 0),
    'voice_minutes', coalesce(sum(quantity) filter (where event_type = 'voice_minutes'), 0)
  )
  into v_usage
  from public.usage_events
  where business_id = p_business_id
    and created_at >= v_period_start
    and (v_period_end is null or created_at < v_period_end);

  select count(*) into v_members
  from public.business_members where business_id = p_business_id and invitation_status = 'active';

  select count(*) into v_pending
  from public.business_invitations
  where business_id = p_business_id and accepted_at is null and revoked_at is null and expires_at > v_now;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'agent_type', a.agent_type, 'enabled', a.enabled, 'status', a.status,
           'usage_limit', a.usage_limit) order by a.agent_type), '[]'::jsonb)
  into v_agents
  from public.agents a where a.business_id = p_business_id;

  return jsonb_build_object(
    'evaluated_at',        v_now,
    'access_active',       v_access,
    'reason',              v_reason,
    'subscription_status', v_sub.status,
    'plan_id',             v_sub.plan_id,
    'plan_name',           v_plan.name,
    'billing_interval',    v_sub.billing_interval,
    'is_trial',            v_is_trial,
    'trial_started_at',    v_sub.trial_started_at,
    'trial_ends_at',       v_sub.trial_ends_at,
    'current_period_end',  v_sub.current_period_end,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'period_start',        v_period_start,
    'period_end',          v_period_end,
    'limits',              v_limits,
    'features',            v_features,
    'suspended',           v_biz.suspended_at is not null,
    'usage',               v_usage || jsonb_build_object('members', v_members, 'pending_invitations', v_pending),
    'agents',              v_agents
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Platform administration
-- -----------------------------------------------------------------------------
create or replace function private.require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
end;
$$;

-- For the UI only (decides whether to render /admin). Every admin function
-- checks again on its own.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin();
$$;

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_month timestamptz := date_trunc('month', now(), 'UTC');
  v_out jsonb;
begin
  perform private.require_platform_admin();
  select jsonb_build_object(
    'generated_at', v_now,
    'businesses', jsonb_build_object(
      'total', (select count(*) from public.businesses),
      'suspended', (select count(*) from public.businesses where suspended_at is not null),
      'created_7d', (select count(*) from public.businesses where created_at >= v_now - interval '7 days'),
      'created_30d', (select count(*) from public.businesses where created_at >= v_now - interval '30 days')),
    'users', (select count(*) from public.profiles),
    'subscriptions', jsonb_build_object(
      'trialing', (select count(*) from public.subscriptions where status = 'trialing' and trial_ends_at > v_now),
      'trial_expired', (select count(*) from public.subscriptions
                         where (status = 'trialing' and trial_ends_at <= v_now)
                            or (status = 'expired' and current_period_end is null)),
      'active', (select count(*) from public.subscriptions where status = 'active'),
      'past_due', (select count(*) from public.subscriptions where status = 'past_due'),
      'canceling', (select count(*) from public.subscriptions where status = 'canceled' and current_period_end > v_now),
      'ended', (select count(*) from public.subscriptions
                 where status in ('canceled', 'expired', 'paused') and (current_period_end is null or current_period_end <= v_now)
                   and not (status = 'expired' and current_period_end is null))),
    -- Estimated from list prices of subscriptions confirmed by the payment
    -- provider (webhook-applied). Excludes tax, discounts and proration.
    'mrr_estimate', (
      select coalesce(jsonb_object_agg(currency, cents), '{}'::jsonb) from (
        select p.currency, sum(case when s.billing_interval = 'year' then round(p.annual_price_cents / 12.0)
                                    else p.monthly_price_cents end)::bigint as cents
        from public.subscriptions s join public.plans p on p.id = s.plan_id
        where s.status in ('active', 'past_due') and s.provider_subscription_id is not null
        group by p.currency) m),
    'usage_this_month', (
      select jsonb_build_object(
        'ai_messages', coalesce(sum(quantity) filter (where event_type = 'ai_message'), 0),
        'ai_tokens', coalesce(sum(quantity) filter (where event_type in ('ai_input_tokens', 'ai_output_tokens')), 0),
        'voice_minutes', coalesce(sum(quantity) filter (where event_type = 'voice_minutes'), 0),
        'emails', coalesce(sum(quantity) filter (where event_type = 'email_sent'), 0),
        'recorded_cost', coalesce((select jsonb_object_agg(c, v) from (
            select provider_cost_currency c, sum(provider_cost) v from public.usage_events
            where created_at >= v_month and provider_cost is not null group by provider_cost_currency) x), '{}'::jsonb))
      from public.usage_events where created_at >= v_month),
    'health', jsonb_build_object(
      'last_job_run', (select jsonb_build_object('finished_at', finished_at, 'status', status, 'error', error)
                       from public.job_runs order by finished_at desc limit 1),
      'failed_job_runs_24h', (select count(*) from public.job_runs where status <> 'ok' and finished_at >= v_now - interval '24 hours'),
      'failed_notifications_7d', (select count(*) from public.notifications where status = 'failed' and created_at >= v_now - interval '7 days'),
      'pending_notifications', (select count(*) from public.notifications where status in ('pending', 'sending')),
      'failed_webhooks_7d', (select count(*) from public.webhook_events where processing_status = 'failed' and created_at >= v_now - interval '7 days')),
    'recent_subscription_events', (
      select coalesce(jsonb_agg(e order by e.occurred_at desc), '[]'::jsonb) from (
        select se.occurred_at, se.event_type, se.status, se.plan_id, se.outcome, se.business_id, b.name as business_name
        from public.subscription_events se left join public.businesses b on b.id = se.business_id
        order by se.occurred_at desc limit 15) e),
    'recent_activity', (
      select coalesce(jsonb_agg(a order by a.created_at desc), '[]'::jsonb) from (
        select l.created_at, l.action, l.entity_type, l.business_id, b.name as business_name, p.email as actor_email
        from public.audit_logs l
        left join public.businesses b on b.id = l.business_id
        left join public.profiles p on p.id = l.actor_id
        order by l.created_at desc limit 25) a)
  ) into v_out;
  return v_out;
end;
$$;

create or replace function public.admin_list_businesses(p_search text default null, p_status text default null,
                                                        p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_rows jsonb;
  v_total bigint;
begin
  perform private.require_platform_admin();
  if p_limit not between 1 and 200 or p_offset < 0 then
    raise exception 'invalid paging' using errcode = '22023';
  end if;
  if v_search is not null and char_length(v_search) > 100 then
    raise exception 'search too long' using errcode = '22023';
  end if;

  with filtered as (
    select b.id, b.name, b.industry, b.created_at, b.suspended_at, s.status, s.plan_id, s.trial_ends_at,
           s.current_period_end, s.billing_interval,
           (select p.email from public.business_members m join public.profiles p on p.id = m.user_id
             where m.business_id = b.id and m.role = 'owner' and m.invitation_status = 'active'
             order by m.created_at limit 1) as owner_email
    from public.businesses b
    left join public.subscriptions s on s.business_id = b.id
    where (v_search is null or b.name ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
           or exists (select 1 from public.business_members m join public.profiles p on p.id = m.user_id
                      where m.business_id = b.id and p.email ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
           or b.id::text = v_search)
      and (p_status is null
           or (p_status = 'suspended' and b.suspended_at is not null)
           or (p_status = 'trialing' and s.status = 'trialing' and s.trial_ends_at > now())
           or (p_status = 'trial_expired' and ((s.status = 'trialing' and s.trial_ends_at <= now()) or (s.status = 'expired' and s.current_period_end is null)))
           or (p_status in ('active', 'past_due', 'canceled', 'paused') and s.status::text = p_status))
  )
  select (select count(*) from filtered),
         coalesce((select jsonb_agg(f order by f.created_at desc) from (
           select * from filtered order by created_at desc limit p_limit offset p_offset) f), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

create or replace function public.admin_business_detail(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_biz public.businesses;
begin
  perform private.require_platform_admin();
  select * into v_biz from public.businesses where id = p_business_id;
  if not found then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'business', jsonb_build_object('id', v_biz.id, 'name', v_biz.name, 'industry', v_biz.industry,
      'country', v_biz.country, 'timezone', v_biz.timezone, 'created_at', v_biz.created_at,
      'suspended_at', v_biz.suspended_at, 'suspension_reason', v_biz.suspension_reason,
      'limit_overrides', v_biz.limit_overrides),
    'subscription', (select to_jsonb(s) - 'provider_customer_id' from public.subscriptions s where s.business_id = p_business_id),
    'entitlements', private.compute_entitlements(p_business_id),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('email', p.email, 'role', m.role, 'status', m.invitation_status)
                  order by m.role, p.email), '[]'::jsonb)
                from public.business_members m join public.profiles p on p.id = m.user_id where m.business_id = p_business_id),
    'agents', (select coalesce(jsonb_agg(jsonb_build_object('agent_type', a.agent_type, 'enabled', a.enabled, 'status', a.status)
                 order by a.agent_type), '[]'::jsonb) from public.agents a where a.business_id = p_business_id),
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'enabled', c.enabled, 'address', c.address)
                   order by c.kind), '[]'::jsonb) from public.business_channels c where c.business_id = p_business_id),
    'counts', jsonb_build_object(
      'rooms', (select count(*) from public.rooms where business_id = p_business_id),
      'reservations', (select count(*) from public.reservations where business_id = p_business_id),
      'conversations', (select count(*) from public.agent_conversations where business_id = p_business_id)),
    'subscription_events', (select coalesce(jsonb_agg(e order by e.occurred_at desc), '[]'::jsonb) from (
        select occurred_at, event_type, status, plan_id, outcome from public.subscription_events
        where business_id = p_business_id order by occurred_at desc limit 20) e),
    'audit', (select coalesce(jsonb_agg(a order by a.created_at desc), '[]'::jsonb) from (
        select l.created_at, l.action, l.entity_type, p.email as actor_email from public.audit_logs l
        left join public.profiles p on p.id = l.actor_id
        where l.business_id = p_business_id order by l.created_at desc limit 30) a)
  );
end;
$$;

create or replace function public.admin_set_business_suspension(p_business_id uuid, p_suspended boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if p_suspended and char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.businesses
  set suspended_at = case when p_suspended then coalesce(suspended_at, now()) end,
      suspension_reason = case when p_suspended then trim(p_reason) end
  where id = p_business_id;
  if not found then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  perform private.write_audit_log(p_business_id, case when p_suspended then 'admin.business_suspended' else 'admin.business_unsuspended' end,
    'business', p_business_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function private.valid_limits(p_limits jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_limits) = 'object'
     and not exists (
       select 1 from jsonb_each(p_limits) e
       where e.key not in ('ai_messages_per_month', 'ai_tokens_per_month', 'voice_minutes_per_month', 'agents', 'members')
          or jsonb_typeof(e.value) <> 'number'
          or (e.value #>> '{}')::numeric < 0
          or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric)
          or (e.value #>> '{}')::numeric > 1000000000);
$$;

create or replace function public.admin_set_limit_overrides(p_business_id uuid, p_overrides jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if p_overrides is null or not private.valid_limits(p_overrides) then
    raise exception 'invalid limit overrides' using errcode = '22023';
  end if;
  update public.businesses set limit_overrides = p_overrides where id = p_business_id;
  if not found then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  perform private.write_audit_log(p_business_id, 'admin.limits_overridden', 'business', p_business_id::text,
    jsonb_build_object('overrides', p_overrides));
end;
$$;

create or replace function public.admin_assign_channel_address(p_business_id uuid, p_kind public.channel_kind, p_address text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  perform public.assign_channel_address(p_business_id, p_kind, p_address);
end;
$$;

create or replace function public.admin_release_channel_address(p_business_id uuid, p_kind public.channel_kind)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if p_kind = 'website_widget' then
    raise exception 'widgets have no address' using errcode = '22023';
  end if;
  update public.business_channels set address = null, enabled = false
  where business_id = p_business_id and kind = p_kind;
  perform private.write_audit_log(p_business_id, 'admin.channel_address_released', 'business_channel', p_kind::text, '{}'::jsonb);
end;
$$;

create or replace function public.admin_update_plan(p_plan_id text, p_name text, p_description text,
                                                   p_usage_limits jsonb, p_features jsonb, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'invalid plan name' using errcode = '22023';
  end if;
  if p_usage_limits is null or not private.valid_limits(p_usage_limits) then
    raise exception 'invalid usage limits' using errcode = '22023';
  end if;
  if p_features is null or jsonb_typeof(p_features) <> 'array' or exists (
       select 1 from jsonb_array_elements(p_features) f
       where jsonb_typeof(f) <> 'string' or (f #>> '{}') !~ '^[a-z_]{2,40}$') then
    raise exception 'invalid features' using errcode = '22023';
  end if;
  -- Prices are not editable here: they live in the payment provider.
  update public.plans
  set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
      usage_limits = p_usage_limits, features = p_features, is_active = p_is_active, updated_at = now()
  where id = p_plan_id;
  if not found then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  perform private.write_audit_log(null, 'admin.plan_updated', 'plan', p_plan_id,
    jsonb_build_object('usage_limits', p_usage_limits, 'features', p_features, 'is_active', p_is_active));
end;
$$;

-- Includes inactive plans (hidden from customers by RLS).
create or replace function public.admin_list_plans()
returns setof public.plans
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query select * from public.plans order by sort_order, id;
end;
$$;

create or replace function public.admin_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.platform_settings);
end;
$$;

-- Only known keys, each validated, so a typo can't break entitlements.
create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  perform private.require_platform_admin();
  v_ok := case p_key
    when 'trial' then
      jsonb_typeof(p_value) = 'object'
      and jsonb_typeof(p_value -> 'days') = 'number' and (p_value ->> 'days')::numeric between 1 and 60
      and jsonb_typeof(p_value -> 'max_trials_per_user') = 'number' and (p_value ->> 'max_trials_per_user')::numeric between 0 and 10
      and exists (select 1 from public.plans where id = p_value ->> 'plan_id')
      and private.valid_limits(coalesce(p_value -> 'usage_limits', 'null'::jsonb))
      and (select count(*) from jsonb_object_keys(p_value)) = 4
    when 'workspaces' then
      jsonb_typeof(p_value -> 'max_created_per_user') = 'number' and (p_value ->> 'max_created_per_user')::numeric between 1 and 100
      and (select count(*) from jsonb_object_keys(p_value)) = 1
    when 'agent_availability' then
      jsonb_typeof(p_value) = 'object' and not exists (
        select 1 from jsonb_each(p_value) e
        where e.key not in ('website_receptionist', 'reservation_assistant', 'voice_receptionist') or jsonb_typeof(e.value) <> 'boolean')
    when 'agent_runtime' then
      jsonb_typeof(p_value -> 'playground_retention_days') = 'number' and (p_value ->> 'playground_retention_days')::numeric between 1 and 3650
      and jsonb_typeof(p_value -> 'conversation_retention_days') = 'number' and (p_value ->> 'conversation_retention_days')::numeric between 1 and 3650
      and (select count(*) from jsonb_object_keys(p_value)) = 2
    when 'retention' then
      jsonb_typeof(p_value) = 'object' and (select count(*) from jsonb_object_keys(p_value)) = 4 and not exists (
        select 1 from jsonb_each(p_value) e
        where e.key not in ('notification_days', 'job_run_days', 'webhook_payload_days', 'audit_log_days')
           or jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric not between 7 and 3650)
    else false
  end;
  if not coalesce(v_ok, false) then
    raise exception 'invalid value for setting %', p_key using errcode = '22023';
  end if;
  update public.platform_settings set value = p_value, updated_at = now() where key = p_key;
  if not found then
    raise exception 'unknown setting' using errcode = 'P0002';
  end if;
  perform private.write_audit_log(null, 'admin.setting_updated', 'platform_setting', p_key, jsonb_build_object('value', p_value));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Privacy
-- -----------------------------------------------------------------------------

-- Full machine-readable export of a workspace (owners only).
create or replace function public.export_business_data(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_business_role(p_business_id, array['owner']::public.business_role[]) then
    raise exception 'only owners can export workspace data' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'format', 'hotelai-export-v1',
    'exported_at', now(),
    'business', (select to_jsonb(b) - 'limit_overrides' from public.businesses b where b.id = p_business_id),
    'settings', (select to_jsonb(s) from public.business_settings s where s.business_id = p_business_id),
    'subscription', (select to_jsonb(s) - 'provider_customer_id' - 'provider_subscription_id' from public.subscriptions s where s.business_id = p_business_id),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('email', p.email, 'full_name', p.full_name, 'role', m.role,
                  'status', m.invitation_status, 'joined_at', m.created_at)), '[]'::jsonb)
                from public.business_members m join public.profiles p on p.id = m.user_id where m.business_id = p_business_id),
    'room_types', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.room_types t where t.business_id = p_business_id),
    'room_type_rates', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.room_type_rates r where r.business_id = p_business_id),
    'rooms', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.rooms r where r.business_id = p_business_id),
    'guests', (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from public.guests g where g.business_id = p_business_id),
    'reservations', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.reservations r where r.business_id = p_business_id),
    'reservation_events', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.reservation_events e where e.business_id = p_business_id),
    'knowledge', (select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb) from public.agent_knowledge k where k.business_id = p_business_id),
    'agents', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.agents a where a.business_id = p_business_id),
    'channels', (select coalesce(jsonb_agg(to_jsonb(c) - 'public_key'), '[]'::jsonb) from public.business_channels c where c.business_id = p_business_id),
    'conversations', (select coalesce(jsonb_agg(to_jsonb(c) - 'external_ref'), '[]'::jsonb) from public.agent_conversations c where c.business_id = p_business_id),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('conversation_id', m.conversation_id, 'sender_type', m.sender_type,
                   'content', m.content, 'tool_name', m.tool_name, 'created_at', m.created_at) order by m.id), '[]'::jsonb)
                 from public.agent_messages m where m.business_id = p_business_id),
    'usage_events', (select coalesce(jsonb_agg(jsonb_build_object('event_type', u.event_type, 'quantity', u.quantity,
                       'unit', u.unit, 'created_at', u.created_at) order by u.id), '[]'::jsonb)
                     from public.usage_events u where u.business_id = p_business_id),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'recipient_email', n.recipient_email,
                        'status', n.status, 'created_at', n.created_at, 'sent_at', n.sent_at)), '[]'::jsonb)
                      from public.notifications n where n.business_id = p_business_id)
  );
end;
$$;

-- Erase one guest's personal data (right to erasure). Reservations stay for
-- accounting, without personal details.
create or replace function public.erase_guest(p_business_id uuid, p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_business_role(p_business_id, array['owner', 'admin']::public.business_role[]) then
    raise exception 'only owners and admins can erase guest data' using errcode = '42501';
  end if;
  update public.guests
  set full_name = 'Erased guest', email = null, phone = null, notes = null, preferred_language = null
  where id = p_guest_id and business_id = p_business_id;
  if not found then
    raise exception 'guest not found' using errcode = 'P0002';
  end if;
  update public.reservations set special_requests = null
  where business_id = p_business_id and guest_id = p_guest_id;
  delete from public.notifications
  where business_id = p_business_id and recipient_type = 'guest' and status in ('pending', 'failed')
    and subject_id in (select id::text from public.reservations where business_id = p_business_id and guest_id = p_guest_id);
  perform private.write_audit_log(p_business_id, 'guest.erased', 'guest', p_guest_id::text, '{}'::jsonb);
end;
$$;

-- Delete a whole workspace (owners only). Refused while a paid subscription
-- would keep billing; the subscription must be canceled first.
create or replace function public.delete_business(p_business_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz public.businesses;
  v_sub public.subscriptions;
begin
  if not private.has_business_role(p_business_id, array['owner']::public.business_role[]) then
    raise exception 'only owners can delete a workspace' using errcode = '42501';
  end if;
  select * into v_biz from public.businesses where id = p_business_id for update;
  if p_confirm_name is distinct from v_biz.name then
    raise exception 'confirmation does not match the workspace name' using errcode = '22023';
  end if;
  select * into v_sub from public.subscriptions where business_id = p_business_id;
  if found and v_sub.provider_subscription_id is not null
     and (v_sub.status in ('active', 'past_due', 'paused') or (v_sub.status = 'trialing' and v_sub.trial_ends_at > now()))
     and not v_sub.cancel_at_period_end then
    raise exception 'cancel the subscription before deleting the workspace' using errcode = '55000';
  end if;
  perform private.write_audit_log(null, 'business.deleted', 'business', p_business_id::text,
    jsonb_build_object('name', v_biz.name));
  delete from public.businesses where id = p_business_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Retention of operational data (called by the scheduled job)
-- -----------------------------------------------------------------------------
create or replace function public.purge_operational_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb;
  v_notifications integer;
  v_job_runs integer;
  v_webhooks integer;
  v_audit integer;
  v_quotes integer;
begin
  select value into v_cfg from public.platform_settings where key = 'retention';
  delete from public.notifications
  where status in ('sent', 'failed', 'skipped')
    and created_at < now() - make_interval(days => coalesce((v_cfg ->> 'notification_days')::int, 180));
  get diagnostics v_notifications = row_count;
  delete from public.job_runs
  where finished_at < now() - make_interval(days => coalesce((v_cfg ->> 'job_run_days')::int, 90));
  get diagnostics v_job_runs = row_count;
  -- Webhook rows stay (idempotency ledger); only their payloads are dropped.
  update public.webhook_events set payload = null
  where payload is not null and processing_status in ('processed', 'ignored')
    and created_at < now() - make_interval(days => coalesce((v_cfg ->> 'webhook_payload_days')::int, 90));
  get diagnostics v_webhooks = row_count;
  delete from public.audit_logs
  where created_at < now() - make_interval(days => coalesce((v_cfg ->> 'audit_log_days')::int, 730));
  get diagnostics v_audit = row_count;
  delete from public.reservation_quotes where expires_at < now() - interval '30 days';
  get diagnostics v_quotes = row_count;
  return jsonb_build_object('notifications', v_notifications, 'job_runs', v_job_runs,
    'webhook_payloads', v_webhooks, 'audit_logs', v_audit, 'quotes', v_quotes);
end;
$$;

-- Uptime monitors call /api/health, which calls this through the public API.
create or replace function public.health_check()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated, service_role;
revoke all on function private.require_platform_admin() from public, anon;
revoke all on function private.valid_limits(jsonb) from public, anon;
grant execute on function private.require_platform_admin() to authenticated;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_list_businesses(text, text, integer, integer) from public, anon;
revoke all on function public.admin_business_detail(uuid) from public, anon;
revoke all on function public.admin_set_business_suspension(uuid, boolean, text) from public, anon;
revoke all on function public.admin_set_limit_overrides(uuid, jsonb) from public, anon;
revoke all on function public.admin_assign_channel_address(uuid, public.channel_kind, text) from public, anon;
revoke all on function public.admin_release_channel_address(uuid, public.channel_kind) from public, anon;
revoke all on function public.admin_update_plan(text, text, text, jsonb, jsonb, boolean) from public, anon;
revoke all on function public.admin_list_plans() from public, anon;
revoke all on function public.admin_get_settings() from public, anon;
revoke all on function public.admin_update_setting(text, jsonb) from public, anon;
revoke all on function public.export_business_data(uuid) from public, anon;
revoke all on function public.erase_guest(uuid, uuid) from public, anon;
revoke all on function public.delete_business(uuid, text) from public, anon;
revoke all on function public.purge_operational_data() from public, anon, authenticated;

-- Callable by signed-in users; each function checks platform admin / role itself.
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_businesses(text, text, integer, integer) to authenticated;
grant execute on function public.admin_business_detail(uuid) to authenticated;
grant execute on function public.admin_set_business_suspension(uuid, boolean, text) to authenticated;
grant execute on function public.admin_set_limit_overrides(uuid, jsonb) to authenticated;
grant execute on function public.admin_assign_channel_address(uuid, public.channel_kind, text) to authenticated;
grant execute on function public.admin_release_channel_address(uuid, public.channel_kind) to authenticated;
grant execute on function public.admin_update_plan(text, text, text, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.admin_list_plans() to authenticated;
grant execute on function public.admin_get_settings() to authenticated;
grant execute on function public.admin_update_setting(text, jsonb) to authenticated;
grant execute on function public.export_business_data(uuid) to authenticated;
grant execute on function public.erase_guest(uuid, uuid) to authenticated;
grant execute on function public.delete_business(uuid, text) to authenticated;
grant execute on function public.purge_operational_data() to service_role;
