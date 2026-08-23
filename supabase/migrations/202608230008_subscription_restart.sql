/**
 * Restarting a tariff, which is not renewing one.
 *
 * A renewal extends: it adds a period to whatever is left, so time already paid
 * for is not forfeited. A restart does the opposite on purpose — it begins a
 * fresh cycle now, and what was left of the old one is gone. That is the point
 * of asking for it: somebody who has used this week's allowance wants next
 * week's allowance today, and is willing to pay for a full period to get it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * One thing the brief describes does not exist in this system, and pretending
 * otherwise would have been worse than saying so.
 *
 * The brief describes a restart discarding a coin balance: 120 left, 800 in the
 * new plan, balance becomes 800 rather than 920. Here a tariff grants no coins.
 * J Coins are bought separately, in their own orders, into their own wallet;
 * what a tariff grants is metered allowances — presentations a week, marathon
 * unlocks, game hosting — counted in `subscription_usage`.
 *
 * So "carry-over = 0" is implemented against the thing the tariff actually
 * gives: the remaining days and the current period's used-up allowances are
 * both discarded, and the new cycle starts empty. The J Coin wallet is left
 * alone, because those coins are money paid for coins, and taking them because
 * somebody restarted a subscription would be taking something they bought for
 * a different reason.
 * ────────────────────────────────────────────────────────────────────────────
 */

create table if not exists public.subscription_restarts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  previous_subscription_id uuid references public.user_subscriptions(id) on delete set null,
  new_subscription_id uuid references public.user_subscriptions(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  plan_code text not null,
  reason text not null default 'user_requested',
  /** What the person gave up, so the decision can be explained back to them. */
  discarded_days integer not null default 0,
  discarded_usage jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists subscription_restarts_user_idx
  on public.subscription_restarts (user_id, created_at desc);

alter table public.subscription_restarts enable row level security;

/** A person reads their own; the console reads everybody's. */
drop policy if exists subscription_restarts_owner_select on public.subscription_restarts;
create policy subscription_restarts_owner_select on public.subscription_restarts
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

grant select on public.subscription_restarts to authenticated;

/**
 * What a restart would cost, before it is paid for.
 *
 * The confirmation is only honest with the real numbers in it — "you have nine
 * days left and two of four presentations still unused" is a decision; "your
 * remaining balance will be cancelled" is a warning nobody can weigh.
 */
create or replace function public.subscription_restart_preview(p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subscription public.user_subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_usage jsonb;
begin
  if p_user_id is null or (p_user_id <> auth.uid() and not public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_subscription from public.user_subscriptions
   where user_id = p_user_id and status = 'active'::public.subscription_status
   order by created_at desc limit 1;

  if not found then
    return jsonb_build_object('member', false);
  end if;

  select * into v_plan from public.subscription_plans where id = v_subscription.plan_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'feature', usage.feature_key,
           'used', usage.used_count,
           'period_start', usage.period_start
         ) order by usage.feature_key), '[]'::jsonb)
    into v_usage
  from public.subscription_usage usage
  where usage.user_id = p_user_id
    and usage.used_count > 0
    and usage.period_start >= (now() - interval '31 days')::date;

  return jsonb_build_object(
    'member', true,
    'plan', jsonb_build_object('code', v_plan.code, 'name', v_plan.name,
                               'price_amount', v_plan.price_amount, 'currency', v_plan.currency,
                               'period_days', v_plan.period_days),
    'expires_at', v_subscription.expires_at,
    -- Rounded up: half a day left is a day somebody is giving up.
    'remaining_days', greatest(0, ceil(extract(epoch from (v_subscription.expires_at - now())) / 86400)::integer),
    'used', v_usage
  );
end;
$$;

revoke all on function public.subscription_restart_preview(uuid) from public, anon;
grant execute on function public.subscription_restart_preview(uuid) to authenticated;

/**
 * The restart itself, applied when the order that paid for it settles.
 *
 * Called from the subscription branch of order fulfilment rather than from a
 * button, which is what makes the two halves of the brief's requirement true at
 * once: payment succeeds and the cycle turns over atomically, and payment
 * failing leaves the old tariff exactly as it was — because nothing here runs
 * until money has arrived.
 */
create or replace function public.apply_subscription_restart(
  p_user_id uuid,
  p_plan_id uuid,
  p_order_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_previous public.user_subscriptions%rowtype;
  v_new public.user_subscriptions%rowtype;
  v_days integer := 0;
  v_usage jsonb := '[]'::jsonb;
begin
  select * into v_plan from public.subscription_plans where id = p_plan_id;
  if not found then
    raise exception 'subscription plan not found' using errcode = 'P0002';
  end if;

  select * into v_previous from public.user_subscriptions
   where user_id = p_user_id
     and status in ('active'::public.subscription_status, 'payment_pending'::public.subscription_status)
   for update;

  if found then
    v_days := greatest(0, ceil(extract(epoch from (coalesce(v_previous.expires_at, now()) - now())) / 86400)::integer);

    select coalesce(jsonb_agg(jsonb_build_object('feature', feature_key, 'used', used_count)), '[]'::jsonb)
      into v_usage
    from public.subscription_usage
    where user_id = p_user_id and used_count > 0
      and period_start >= (now() - interval '31 days')::date;

    /**
     * The old cycle is closed rather than deleted.
     *
     * `user_subscriptions_one_live` allows one row in `active` or
     * `payment_pending` per person, so the old one has to leave those states
     * before the new one arrives — and it stays on the table because a
     * membership somebody paid for is a record, not a draft.
     */
    update public.user_subscriptions set
      status = 'expired',
      cancelled_at = now(),
      expires_at = now()
    where id = v_previous.id;
  end if;

  /**
   * The allowances start empty.
   *
   * This is the whole of "carry-over = 0" in a system whose tariff grants
   * allowances rather than coins: the rows counting what has been used in the
   * current period are cleared, so a person who spent this week's four
   * presentations has four again. Older rows stay, because they are history.
   */
  delete from public.subscription_usage
  where user_id = p_user_id and period_start >= (now() - interval '31 days')::date;

  insert into public.user_subscriptions (
    user_id, plan_id, status, order_id, started_at, expires_at, plan_snapshot
  ) values (
    p_user_id, v_plan.id, 'active', p_order_id, now(),
    now() + make_interval(days => v_plan.period_days),
    jsonb_build_object('features', v_plan.features, 'price_amount', v_plan.price_amount, 'restart', true)
  )
  returning * into v_new;

  insert into public.subscription_restarts (
    user_id, previous_subscription_id, new_subscription_id, order_id,
    plan_code, discarded_days, discarded_usage
  ) values (
    p_user_id, v_previous.id, v_new.id, p_order_id,
    v_plan.code, v_days, v_usage
  );

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (
    p_user_id, 'subscription.restarted', 'user_subscription', v_new.id::text,
    jsonb_build_object('plan', v_plan.code, 'discarded_days', v_days,
                       'previous', v_previous.id, 'order', p_order_id)
  );

  return v_new.id;
end;
$$;

revoke all on function public.apply_subscription_restart(uuid, uuid, uuid) from public, anon, authenticated;
