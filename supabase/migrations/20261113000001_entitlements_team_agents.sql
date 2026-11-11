-- =============================================================================
-- HotelAI — Migration 6: Entitlements, team invitations, agent guards, audit
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ENTITLEMENTS
-- One authoritative calculation of "what may this business do right now",
-- evaluated against the DATABASE clock. The app turns this snapshot into
-- capability flags (src/lib/entitlements). Nothing here trusts client input.
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
begin
  select * into v_sub from public.subscriptions where business_id = p_business_id;
  if not found then
    return jsonb_build_object('access_active', false, 'reason', 'no_subscription', 'evaluated_at', v_now);
  end if;

  select * into v_plan from public.plans where id = v_sub.plan_id;
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
    'features',            coalesce(v_plan.features, '[]'::jsonb),
    'usage',               v_usage || jsonb_build_object('members', v_members, 'pending_invitations', v_pending),
    'agents',              v_agents
  );
end;
$$;

-- For signed-in users: verifies active membership via auth.uid() first.
create or replace function public.get_business_entitlements(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.business_role;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select role into v_role
  from public.business_members
  where business_id = p_business_id and user_id = auth.uid() and invitation_status = 'active';
  if v_role is null then
    raise exception 'not a member of this business' using errcode = '42501';
  end if;
  return private.compute_entitlements(p_business_id) || jsonb_build_object('role', v_role);
end;
$$;

-- For trusted server code running with the secret key (agent runtime for
-- public channels, background jobs). No role in the result.
create or replace function public.get_business_entitlements_service(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.compute_entitlements(p_business_id);
$$;

-- -----------------------------------------------------------------------------
-- 2. TEAM INVITATIONS
-- The plaintext token exists only in the creator's response and in the email
-- link; the database stores its SHA-256. Accepting requires being signed in
-- with the exact (verified) email address the invitation was sent to.
-- -----------------------------------------------------------------------------
create table public.business_invitations (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  email        text not null check (
                 email = lower(email) and char_length(email) <= 320
                 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role         public.business_role not null check (role <> 'owner'),
  token_hash   text not null unique,
  invited_by   uuid references auth.users (id) on delete set null,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create unique index business_invitations_one_pending
  on public.business_invitations (business_id, email)
  where accepted_at is null and revoked_at is null;
create index business_invitations_business_idx on public.business_invitations (business_id, created_at desc);

alter table public.business_invitations enable row level security;
revoke all on public.business_invitations from anon, authenticated;
-- token_hash is deliberately NOT readable by clients.
grant select (id, business_id, email, role, invited_by, expires_at, accepted_at, revoked_at, created_at)
  on public.business_invitations to authenticated;
grant all on public.business_invitations to service_role;

create policy business_invitations_select_admins on public.business_invitations
  for select to authenticated
  using (private.has_business_role(business_id, array['owner', 'admin']::public.business_role[]));

create or replace function private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

create or replace function public.create_business_invitation(
  p_business_id uuid,
  p_email       text,
  p_role        public.business_role
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_role public.business_role;
  v_email      text := lower(trim(p_email));
  v_ent        jsonb;
  v_limit      integer;
  v_token      text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id         uuid;
  v_expires    timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select role into v_actor_role from public.business_members
  where business_id = p_business_id and user_id = auth.uid() and invitation_status = 'active';

  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'invite as admin and transfer ownership afterwards' using errcode = '22023';
  end if;
  if v_actor_role = 'admin' and p_role = 'admin' then
    raise exception 'only owners can invite admins' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.business_members m join auth.users u on u.id = m.user_id
    where m.business_id = p_business_id and lower(u.email) = v_email
  ) then
    raise exception 'already a member' using errcode = '23505';
  end if;

  -- Serialize per business so concurrent invites cannot exceed the seat limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invite:' || p_business_id::text, 0));

  v_ent := private.compute_entitlements(p_business_id);
  if not coalesce((v_ent ->> 'access_active')::boolean, false) then
    raise exception 'subscription inactive' using errcode = '54001';
  end if;

  -- An existing pending invite for the same email is replaced (re-send).
  update public.business_invitations
  set revoked_at = now()
  where business_id = p_business_id and email = v_email and accepted_at is null and revoked_at is null;

  v_limit := (v_ent -> 'limits' ->> 'members')::int;
  if v_limit is not null and (
    (select count(*) from public.business_members where business_id = p_business_id and invitation_status = 'active')
    + (select count(*) from public.business_invitations i
       where i.business_id = p_business_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
  ) >= v_limit then
    raise exception 'member limit reached' using errcode = '54000';
  end if;

  if (select count(*) from public.business_invitations i
      where i.business_id = p_business_id and i.created_at > now() - interval '1 day') >= 50 then
    raise exception 'too many invitations today' using errcode = '54000';
  end if;

  insert into public.business_invitations (business_id, email, role, token_hash, invited_by, expires_at)
  values (p_business_id, v_email, p_role, private.hash_token(v_token), auth.uid(), v_expires)
  returning id into v_id;

  perform private.write_audit_log(p_business_id, 'invitation.created', 'business_invitation', v_id::text,
    jsonb_build_object('role', p_role));

  return query select v_id, v_token, v_expires;
end;
$$;

create or replace function public.revoke_business_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv        public.business_invitations;
  v_actor_role public.business_role;
begin
  select * into v_inv from public.business_invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  select role into v_actor_role from public.business_members
  where business_id = v_inv.business_id and user_id = auth.uid() and invitation_status = 'active';
  if v_actor_role is null or v_actor_role not in ('owner', 'admin')
     or (v_actor_role = 'admin' and v_inv.role = 'admin') then
    -- Same error as "not found" so ids of other businesses' invites leak nothing.
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is null and v_inv.revoked_at is null then
    update public.business_invitations set revoked_at = now() where id = p_invitation_id;
    perform private.write_audit_log(v_inv.business_id, 'invitation.revoked', 'business_invitation', p_invitation_id::text, '{}'::jsonb);
  end if;
end;
$$;

-- What the invite landing page may show to whoever holds the (secret) token.
create or replace function public.get_invitation_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv  public.business_invitations;
  v_name text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_inv from public.business_invitations where token_hash = private.hash_token(p_token);
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  select name into v_name from public.businesses where id = v_inv.business_id;
  return jsonb_build_object(
    'status', case
      when v_inv.accepted_at is not null then 'accepted'
      when v_inv.revoked_at is not null then 'revoked'
      when v_inv.expires_at <= now() then 'expired'
      else 'valid' end,
    'business_name', v_name,
    'role', v_inv.role,
    'email', v_inv.email,
    'expires_at', v_inv.expires_at
  );
end;
$$;

create or replace function public.accept_business_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv       public.business_invitations;
  v_email     text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  select * into v_inv from public.business_invitations
  where token_hash = private.hash_token(p_token) for update;
  if not found or v_inv.revoked_at is not null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation already used' using errcode = '55000';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation expired' using errcode = '55000';
  end if;

  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  if v_email is distinct from v_inv.email or v_confirmed is null then
    raise exception 'invitation was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.business_members (business_id, user_id, role, invitation_status, invited_by)
  values (v_inv.business_id, auth.uid(), v_inv.role, 'active', v_inv.invited_by)
  on conflict (business_id, user_id) do nothing;

  update public.business_invitations
  set accepted_at = now(), accepted_by = auth.uid()
  where id = v_inv.id;

  perform private.write_audit_log(v_inv.business_id, 'invitation.accepted', 'business_invitation', v_inv.id::text,
    jsonb_build_object('role', v_inv.role));
  return v_inv.business_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. AGENT GUARDS
-- -----------------------------------------------------------------------------
alter table public.agents
  add constraint agents_system_configuration_size check (octet_length(system_configuration::text) <= 20000);

create or replace function private.guard_agent_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.enabled and not old.enabled and new.status in ('not_configured', 'disabled') then
    raise exception 'this agent is not available for this business yet' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger agents_guard_update
  before update on public.agents
  for each row execute function private.guard_agent_update();

-- -----------------------------------------------------------------------------
-- 4. AUDIT TRIGGERS for configuration changes. Only column NAMES are logged,
-- never values, to keep personal data out of the audit trail.
-- -----------------------------------------------------------------------------
create or replace function private.audit_row_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
  v_business uuid;
  v_entity_id text;
begin
  select array_agg(n.key order by n.key) into v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value and n.key not in ('updated_at');

  if v_changed is null then
    return new;
  end if;

  v_business := (to_jsonb(new) ->> coalesce(tg_argv[1], 'business_id'))::uuid;
  v_entity_id := coalesce(to_jsonb(new) ->> 'id', v_business::text);

  perform private.write_audit_log(v_business, tg_argv[0], tg_table_name, v_entity_id,
    jsonb_build_object('changed', to_jsonb(v_changed)));
  return new;
end;
$$;

create trigger agents_audit_update after update on public.agents
  for each row execute function private.audit_row_update('agent.updated');
create trigger businesses_audit_update after update on public.businesses
  for each row execute function private.audit_row_update('business.updated', 'id');
create trigger business_settings_audit_update after update on public.business_settings
  for each row execute function private.audit_row_update('business_settings.updated');
create trigger subscriptions_audit_update after update on public.subscriptions
  for each row execute function private.audit_row_update('subscription.updated');

-- -----------------------------------------------------------------------------
-- Privileges for new functions
-- -----------------------------------------------------------------------------
revoke all on function private.compute_entitlements(uuid) from public, anon, authenticated;
revoke all on function public.get_business_entitlements(uuid) from public, anon;
revoke all on function public.get_business_entitlements_service(uuid) from public, anon, authenticated;
revoke all on function public.create_business_invitation(uuid, text, public.business_role) from public, anon;
revoke all on function public.revoke_business_invitation(uuid) from public, anon;
revoke all on function public.accept_business_invitation(text) from public, anon;
revoke all on function public.get_invitation_preview(text) from public;

grant execute on function public.get_business_entitlements(uuid) to authenticated;
grant execute on function public.get_business_entitlements_service(uuid) to service_role;
grant execute on function public.create_business_invitation(uuid, text, public.business_role) to authenticated;
grant execute on function public.revoke_business_invitation(uuid) to authenticated;
grant execute on function public.accept_business_invitation(text) to authenticated;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;
