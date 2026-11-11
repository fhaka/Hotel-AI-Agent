-- =============================================================================
-- HotelAI — Migration 11: Automation (notification outbox, scheduled jobs)
-- =============================================================================
-- Flow (all service-role only, driven by POST /api/jobs/run):
--   1. expire_trials()                 status housekeeping
--   2. enqueue_due_notifications()     what is due -> outbox rows (unique dedupe_key)
--   3. claim_notifications()           FOR UPDATE SKIP LOCKED batch for one worker
--   4. (app renders + sends via Resend, idempotency key = notification id)
--   5. complete_notification()         sent / retry with backoff / failed / skipped
--   6. purge_expired_conversations()   retention
-- =============================================================================

create table public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  kind                text not null check (kind in (
                        'guest_pre_arrival', 'owner_trial_ending', 'owner_trial_ended',
                        'owner_payment_failed', 'staff_escalation', 'staff_unanswered_inquiry',
                        'owner_daily_report', 'owner_welcome')),
  recipient_email     text not null check (char_length(recipient_email) <= 320),
  recipient_type      text not null check (recipient_type in ('guest', 'staff', 'owner')),
  subject_id          text check (char_length(subject_id) <= 200), -- reservation / conversation / subscription id
  dedupe_key          text not null unique check (char_length(dedupe_key) <= 400),
  status              text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  last_error          text check (char_length(last_error) <= 500),
  provider_message_id text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index notifications_due_idx on public.notifications (status, next_attempt_at);
create index notifications_business_idx on public.notifications (business_id, created_at desc);

create table public.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null,
  started_at  timestamptz not null,
  finished_at timestamptz not null default now(),
  status      text not null check (status in ('ok', 'partial', 'failed')),
  stats       jsonb not null default '{}'::jsonb,
  error       text check (char_length(error) <= 1000)
);
create index job_runs_job_idx on public.job_runs (job, finished_at desc);

alter table public.notifications enable row level security;
alter table public.job_runs enable row level security;
revoke all on public.notifications, public.job_runs from anon, authenticated;
grant all on public.notifications, public.job_runs to service_role;
-- Owners/admins can see their business's notification log (read-only).
grant select (id, business_id, kind, recipient_email, recipient_type, subject_id, status, attempts,
              next_attempt_at, last_error, created_at, sent_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated
  using (private.has_business_role(business_id, array['owner', 'admin']::public.business_role[]));

-- -----------------------------------------------------------------------------
-- Preference helpers (business_settings.notification_preferences)
--   { guest_pre_arrival:  { enabled: true,  days_before: 2 },
--     owner_daily_report: { enabled: true,  hour: 8 },
--     staff_alerts:       { enabled: true,  email: null, unanswered_after_hours: 4 } }
-- -----------------------------------------------------------------------------
create or replace function private.pref_bool(p_prefs jsonb, p_section text, p_key text, p_default boolean)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce((p_prefs -> p_section ->> p_key)::boolean, p_default);
$$;

create or replace function private.pref_int(p_prefs jsonb, p_section text, p_key text, p_default integer)
returns integer language sql immutable set search_path = '' as $$
  select coalesce(nullif(p_prefs -> p_section ->> p_key, '')::int, p_default);
$$;

-- Owner emails (active owners with a profile email).
create or replace function private.owner_emails(p_business_id uuid)
returns table (email text) language sql stable security definer set search_path = '' as $$
  select distinct lower(p.email)
  from public.business_members m join public.profiles p on p.id = m.user_id
  where m.business_id = p_business_id and m.role = 'owner' and m.invitation_status = 'active' and p.email is not null;
$$;

-- Staff alert recipients: configured address, else owners and admins.
create or replace function private.staff_alert_emails(p_business_id uuid, p_prefs jsonb)
returns table (email text) language sql stable security definer set search_path = '' as $$
  select lower(p_prefs -> 'staff_alerts' ->> 'email')
  where coalesce(p_prefs -> 'staff_alerts' ->> 'email', '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  union
  select distinct lower(p.email)
  from public.business_members m join public.profiles p on p.id = m.user_id
  where m.business_id = p_business_id and m.role in ('owner', 'admin') and m.invitation_status = 'active'
    and p.email is not null
    and coalesce(p_prefs -> 'staff_alerts' ->> 'email', '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
$$;

-- -----------------------------------------------------------------------------
-- expire_trials: trialing subscriptions past their end become 'expired'.
-- (Access already ends at trial_ends_at via compute_entitlements; this keeps
-- reporting and the admin view accurate.)
-- -----------------------------------------------------------------------------
create or replace function public.expire_trials()
returns integer language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  update public.subscriptions set status = 'expired'
  where status = 'trialing' and trial_ends_at <= now();
  get diagnostics v = row_count;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- enqueue_due_notifications: idempotent; safe to run every few minutes.
-- -----------------------------------------------------------------------------
create or replace function public.enqueue_due_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n      integer;
begin
  -- 1. Guest pre-arrival reminders (needs active access + 'automations' feature).
  insert into public.notifications (business_id, kind, recipient_email, recipient_type, subject_id, dedupe_key)
  select r.business_id, 'guest_pre_arrival', lower(g.email), 'guest', r.id::text, 'pre_arrival:' || r.id
  from public.reservations r
  join public.guests g on g.id = r.guest_id
  join public.businesses b on b.id = r.business_id
  join public.business_settings s on s.business_id = r.business_id
  where r.status = 'confirmed'
    and g.email is not null
    and private.pref_bool(s.notification_preferences, 'guest_pre_arrival', 'enabled', true)
    and r.check_in = (now() at time zone b.timezone)::date
                     + private.pref_int(s.notification_preferences, 'guest_pre_arrival', 'days_before', 2)
    and coalesce((private.compute_entitlements(r.business_id) ->> 'access_active')::boolean, false)
    and (private.compute_entitlements(r.business_id) -> 'features') ? 'automations'
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('guest_pre_arrival', v_n);

  -- 2. Trial ending within 48 hours (to owners).
  insert into public.notifications (business_id, kind, recipient_email, recipient_type, subject_id, dedupe_key)
  select su.business_id, 'owner_trial_ending', o.email, 'owner', su.id::text,
         'trial_ending:' || su.business_id || ':' || o.email
  from public.subscriptions su
  cross join lateral private.owner_emails(su.business_id) o
  where su.status = 'trialing' and su.trial_ends_at > now() and su.trial_ends_at <= now() + interval '48 hours'
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('owner_trial_ending', v_n);

  -- 3. Trial ended (within the last 7 days, once).
  insert into public.notifications (business_id, kind, recipient_email, recipient_type, subject_id, dedupe_key)
  select su.business_id, 'owner_trial_ended', o.email, 'owner', su.id::text,
         'trial_ended:' || su.business_id || ':' || o.email
  from public.subscriptions su
  cross join lateral private.owner_emails(su.business_id) o
  where su.status in ('trialing', 'expired') and su.provider_subscription_id is null
    and su.trial_ends_at <= now() and su.trial_ends_at > now() - interval '7 days'
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('owner_trial_ended', v_n);

  -- 4. Payment failed (once per billing period).
  insert into public.notifications (business_id, kind, recipient_email, recipient_type, subject_id, dedupe_key)
  select su.business_id, 'owner_payment_failed', o.email, 'owner', su.id::text,
         'payment_failed:' || su.id || ':' || coalesce(su.current_period_end::text, '') || ':' || o.email
  from public.subscriptions su
  cross join lateral private.owner_emails(su.business_id) o
  where su.status = 'past_due'
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('owner_payment_failed', v_n);

  -- 5. New escalations (hand-overs) -> staff, once per conversation.
  insert into public.notifications (business_id, kind, recipient_email, recipient_type, subject_id, dedupe_key)
  select c.business_id, 'staff_escalation', e.email, 'staff', c.id::text, 'escalation:' || c.id || ':' || e.email
  from public.agent_conversations c
  join public.business_settings s on s.business_id = c.business_id
  cross join lateral private.staff_alert_emails(c.business_id, s.notification_preferences) e
  where c.status = 'escalated' and c.escalated_at > now() - interval '7 days' and c.channel <> 'playground'
    and private.pref_bool(s.notification_preferences, 'staff_alerts', 'enabled', true)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('staff_escalation', v_n);

  -- 6. Escalations still unanswered after N hours -> staff reminder, once.
  insert into public.notifications (business_id, kind, recipient_email, recipient_type, subject_id, dedupe_key)
  select c.business_id, 'staff_unanswered_inquiry', e.email, 'staff', c.id::text, 'unanswered:' || c.id || ':' || e.email
  from public.agent_conversations c
  join public.business_settings s on s.business_id = c.business_id
  cross join lateral private.staff_alert_emails(c.business_id, s.notification_preferences) e
  where c.status = 'escalated' and c.channel <> 'playground'
    and c.escalated_at <= now() - make_interval(hours => private.pref_int(s.notification_preferences, 'staff_alerts', 'unanswered_after_hours', 4))
    and c.escalated_at > now() - interval '7 days'
    and private.pref_bool(s.notification_preferences, 'staff_alerts', 'enabled', true)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('staff_unanswered_inquiry', v_n);

  -- 7. Daily owner report, once per local day after the configured hour,
  --    for businesses with access (trial or paid).
  insert into public.notifications (business_id, kind, recipient_email, recipient_type, subject_id, dedupe_key)
  select b.id, 'owner_daily_report', o.email, 'owner', ((now() at time zone b.timezone)::date)::text,
         'daily:' || b.id || ':' || ((now() at time zone b.timezone)::date) || ':' || o.email
  from public.businesses b
  join public.business_settings s on s.business_id = b.id
  cross join lateral private.owner_emails(b.id) o
  where private.pref_bool(s.notification_preferences, 'owner_daily_report', 'enabled', true)
    and extract(hour from (now() at time zone b.timezone)) >= private.pref_int(s.notification_preferences, 'owner_daily_report', 'hour', 8)
    and b.onboarding_completed_at is not null
    and coalesce((private.compute_entitlements(b.id) ->> 'access_active')::boolean, false)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('owner_daily_report', v_n);

  -- 8. Welcome email for new workspaces (created within the last day).
  insert into public.notifications (business_id, kind, recipient_email, recipient_type, subject_id, dedupe_key)
  select b.id, 'owner_welcome', o.email, 'owner', b.id::text, 'welcome:' || b.id || ':' || o.email
  from public.businesses b
  cross join lateral private.owner_emails(b.id) o
  where b.created_at > now() - interval '1 day'
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('owner_welcome', v_n);

  return v_counts;
end;
$$;

-- -----------------------------------------------------------------------------
-- claim_notifications: hand a batch to ONE worker. Rows stuck in 'sending'
-- (worker crashed) for 15 minutes are reclaimed.
-- -----------------------------------------------------------------------------
create or replace function public.claim_notifications(p_limit integer)
returns setof public.notifications
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications set status = 'pending'
  where status = 'sending' and next_attempt_at < now() - interval '15 minutes';

  return query
  with due as (
    select id from public.notifications
    where status = 'pending' and next_attempt_at <= now()
    order by next_attempt_at
    limit least(greatest(coalesce(p_limit, 25), 1), 200)
    for update skip locked
  )
  update public.notifications n
  set status = 'sending', attempts = n.attempts + 1, next_attempt_at = now()
  from due where n.id = due.id
  returning n.*;
end;
$$;

-- -----------------------------------------------------------------------------
-- complete_notification: p_outcome in sent | retry | skipped | failed.
-- Retries back off exponentially (2^attempts minutes, max 6 h) and stop
-- after 5 attempts.
-- -----------------------------------------------------------------------------
create or replace function public.complete_notification(
  p_id uuid, p_outcome text, p_error text, p_provider_message_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_status   text;
begin
  select attempts into v_attempts from public.notifications where id = p_id for update;
  if not found then
    return 'not_found';
  end if;
  v_status := case
    when p_outcome = 'sent' then 'sent'
    when p_outcome = 'skipped' then 'skipped'
    when p_outcome = 'retry' and v_attempts < 5 then 'pending'
    else 'failed'
  end;
  update public.notifications set
    status = v_status,
    sent_at = case when v_status = 'sent' then now() end,
    provider_message_id = coalesce(left(p_provider_message_id, 200), provider_message_id),
    last_error = left(p_error, 500),
    next_attempt_at = case when v_status = 'pending'
                           then now() + least(make_interval(mins => power(2, v_attempts)::int), interval '6 hours')
                           else next_attempt_at end
  where id = p_id;
  return v_status;
end;
$$;

create or replace function public.record_job_run(p_job text, p_started_at timestamptz, p_status text, p_stats jsonb, p_error text)
returns void language sql security definer set search_path = '' as $$
  insert into public.job_runs (job, started_at, status, stats, error)
  values (left(p_job, 100), p_started_at, p_status, coalesce(p_stats, '{}'::jsonb), left(p_error, 1000));
  delete from public.job_runs where finished_at < now() - interval '30 days';
$$;

-- Last successful run per job, for the health indicator (owners/admins see it
-- through this function only; job_runs itself is service-only).
create or replace function public.automation_health()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'last_run_at', (select max(finished_at) from public.job_runs where job = 'scheduled' and status in ('ok', 'partial')),
    'last_status', (select status from public.job_runs where job = 'scheduled' order by finished_at desc limit 1));
$$;

revoke all on function private.pref_bool(jsonb, text, text, boolean), private.pref_int(jsonb, text, text, integer),
  private.owner_emails(uuid), private.staff_alert_emails(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.expire_trials(), public.enqueue_due_notifications(), public.claim_notifications(integer),
  public.complete_notification(uuid, text, text, text), public.record_job_run(text, timestamptz, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.expire_trials(), public.enqueue_due_notifications(), public.claim_notifications(integer),
  public.complete_notification(uuid, text, text, text), public.record_job_run(text, timestamptz, text, jsonb, text)
  to service_role;
revoke all on function public.automation_health() from public, anon;
grant execute on function public.automation_health() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- resolve_conversation: staff mark a hand-over as handled (stops the
-- "unanswered inquiry" alert). Any active member may do this.
-- -----------------------------------------------------------------------------
create or replace function public.resolve_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.agent_conversations where id = p_conversation_id;
  if v_business is null or not private.is_business_member(v_business) then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  update public.agent_conversations set status = 'closed' where id = p_conversation_id;
  perform private.write_audit_log(v_business, 'conversation.resolved', 'agent_conversation', p_conversation_id::text, '{}'::jsonb);
end;
$$;
revoke all on function public.resolve_conversation(uuid) from public, anon;
grant execute on function public.resolve_conversation(uuid) to authenticated;
