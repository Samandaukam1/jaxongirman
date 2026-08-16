-- What a member has left — and the fix for who may ask.
--
-- `my_entitlements`, `quota_status` and `current_subscription` all take a user
-- id that defaults to the caller's, are SECURITY DEFINER, and are granted to
-- `authenticated`. Nothing checked that the id passed in was the caller's own,
-- so any signed-in person could read anybody else's plan, expiry and usage
-- counters by sending a different uuid. The default made it look self-scoped;
-- a default is a convenience, never a boundary.

/**
 * May the caller read this person's entitlements?
 *
 * Written once and called from each reader, so the rule cannot drift between
 * them. Three cases are allowed: your own, an admin's, and a call with no
 * signed-in user at all — which is the server calling itself, since `anon` is
 * revoked from every one of these and only Edge functions hold the service
 * role.
 */
create or replace function public.assert_reads_own_entitlements(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then return; end if;
  if p_user_id = v_caller then return; end if;
  if public.is_admin(v_caller) then return; end if;
  raise exception 'forbidden' using errcode = '42501';
end;
$$;

revoke all on function public.assert_reads_own_entitlements(uuid) from public, anon;

-- The three readers, unchanged apart from the guard.

-- Written in plpgsql rather than sql only so the guard can be a statement of
-- its own: a check smuggled into a where clause is a check the planner is
-- entitled to move, and this one has to run before the row is read.
create or replace function public.current_subscription(p_user_id uuid default auth.uid())
returns public.user_subscriptions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.user_subscriptions%rowtype;
begin
  perform public.assert_reads_own_entitlements(p_user_id);

  select s.* into v_row from public.user_subscriptions s
   where s.user_id = p_user_id
     and s.status = 'active'
     and s.expires_at > now()
   order by s.expires_at desc
   limit 1;

  return v_row;
end;
$$;

create or replace function public.my_entitlements(p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.user_subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_free jsonb;
  v_features jsonb;
begin
  if p_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  perform public.assert_reads_own_entitlements(p_user_id);

  select value into v_free from public.app_settings where key = 'subscription.free_tier';
  v_free := coalesce(v_free, '{}'::jsonb);

  v_sub := public.current_subscription(p_user_id);
  if v_sub.id is null then
    return jsonb_build_object(
      'member', false,
      'status', 'inactive',
      'plan', null,
      'features', jsonb_build_object(
        'game_free_daily', jsonb_build_object(
          'enabled', true, 'limit', coalesce((v_free->>'game_free_daily')::integer, 3), 'period', 'day'),
        'presentation_weekly', jsonb_build_object(
          'enabled', coalesce((v_free->>'presentation_weekly')::integer, 0) > 0,
          'limit', coalesce((v_free->>'presentation_weekly')::integer, 0), 'period', 'week'),
        'marketplace_access', jsonb_build_object(
          'enabled', coalesce((v_free->>'marketplace_access')::boolean, false))
      )
    );
  end if;

  select * into v_plan from public.subscription_plans where id = v_sub.plan_id;
  -- The plan as it was sold, when there is a snapshot: a later edit must not
  -- change what somebody already paid for.
  v_features := coalesce(nullif(v_sub.plan_snapshot -> 'features', 'null'::jsonb), v_plan.features);

  return jsonb_build_object(
    'member', true,
    'status', v_sub.status,
    'expires_at', v_sub.expires_at,
    'plan', jsonb_build_object(
      'code', v_plan.code, 'name', v_plan.name, 'price_amount', v_plan.price_amount,
      'currency', v_plan.currency, 'period_days', v_plan.period_days),
    'features', v_features
  );
end;
$$;

create or replace function public.quota_status(p_feature_key text, p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ent jsonb;
  v_feature jsonb;
  v_period text;
  v_limit integer;
  v_start date;
  v_used integer;
begin
  if p_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  perform public.assert_reads_own_entitlements(p_user_id);

  v_ent := public.my_entitlements(p_user_id);
  v_feature := coalesce(v_ent -> 'features' -> p_feature_key, '{}'::jsonb);
  if coalesce((v_feature ->> 'enabled')::boolean, false) is not true then
    return jsonb_build_object('feature', p_feature_key, 'enabled', false,
      'unlimited', false, 'limit', 0, 'used', 0, 'remaining', 0);
  end if;

  if coalesce((v_feature ->> 'unlimited')::boolean, false) then
    return jsonb_build_object('feature', p_feature_key, 'enabled', true,
      'unlimited', true, 'limit', null, 'used', 0, 'remaining', null);
  end if;

  v_period := coalesce(v_feature ->> 'period', 'week');
  v_limit := coalesce((v_feature ->> 'limit')::integer, 0);
  v_start := public.usage_period_start(p_user_id, v_period);

  select coalesce(used, 0) into v_used from public.subscription_usage
   where user_id = p_user_id and feature_key = p_feature_key and period_start = v_start;
  v_used := coalesce(v_used, 0);

  return jsonb_build_object(
    'feature', p_feature_key,
    'enabled', true,
    'unlimited', false,
    'period', v_period,
    'period_start', v_start,
    'limit', v_limit,
    'used', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'resets_at', case lower(v_period)
      when 'day' then (v_start + 1)
      when 'month' then (v_start + interval '1 month')::date
      else (v_start + 7) end
  );
end;
$$;

/**
 * Every metered allowance at once.
 *
 * `quota_status` answers for one feature, which is right for the gates: an
 * action asks about the one allowance it is about to spend. A screen showing a
 * person where they stand needs all of them, and asking three times over a
 * mobile connection to draw three bars is three chances for them to disagree.
 *
 * No new state and no second source of truth — it calls `quota_status` per
 * feature. Which features are metered is not a list kept here; it is read from
 * the plan as "the ones that say over what window they refill", so a capability
 * an admin adds shows up without a migration.
 */
create or replace function public.my_usage(p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_features jsonb;
  v_key text;
  v_feature jsonb;
  v_rows jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  perform public.assert_reads_own_entitlements(p_user_id);

  v_features := coalesce(public.my_entitlements(p_user_id) -> 'features', '{}'::jsonb);

  for v_key, v_feature in select key, value from jsonb_each(v_features)
  loop
    -- A capability is either a switch or an allowance. A switch — "may sell on
    -- the marketplace" — has nothing to count, so it is not a usage line; an
    -- allowance says over what window it refills, and that is what marks it.
    continue when coalesce((v_feature ->> 'enabled')::boolean, false) is not true;
    continue when v_feature ->> 'period' is null;

    v_rows := v_rows || jsonb_build_array(public.quota_status(v_key, p_user_id));
  end loop;

  return v_rows;
end;
$$;

revoke all on function public.my_usage(uuid) from public, anon;
grant execute on function public.my_usage(uuid) to authenticated;

comment on function public.my_usage(uuid) is
  'Every metered allowance for the caller, as quota_status answers each. Read-only.';
