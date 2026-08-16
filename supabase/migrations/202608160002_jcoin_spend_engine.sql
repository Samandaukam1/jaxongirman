-- Spending J Coins on a metered operation.
--
-- The ledger already exists and already knows how to hold money aside:
-- `game_rewards_reserve` writes a `reservation` row, moves
-- `credit_wallets.reserved`, and relies on the unique `(user_id,
-- idempotency_key)` to make a repeat harmless. This is that pattern, generalised
-- so the three metered actions — presenting an outside PPTX, hosting a game past
-- the free allowance, and anything priced later — all go through one door.
--
-- Prices come from `app_settings.credits.operation_costs`, which is already the
-- one price list. Nothing here hardcodes an amount.

/**
 * Holds the price of an operation aside, or refuses.
 *
 * Reserving rather than charging is what makes a failure recoverable: the work
 * happens after the money is committed but before it is taken, so a technical
 * fault gives it back instead of leaving somebody paying for nothing.
 *
 * The idempotency key is the caller's promise that two requests are the same
 * request. A repeat returns the reservation that already exists rather than
 * taking a second one — which is what stops a double press from charging twice.
 */
create or replace function public.jcoin_reserve(
  p_operation text,
  p_idempotency_key text,
  p_reference_id uuid default null,
  p_user_id uuid default auth.uid(),
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost integer;
  v_wallet public.credit_wallets%rowtype;
  v_existing public.credit_transactions%rowtype;
begin
  if p_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  -- A repeat of a request that already reserved is that reservation, not a new
  -- one. Checked before anything is read for update, so a double press costs
  -- nothing at all.
  select * into v_existing from public.credit_transactions
   where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'repeated', true, 'operation', p_operation,
      'amount', abs(v_existing.amount), 'idempotency_key', p_idempotency_key);
  end if;

  select coalesce((value -> p_operation ->> 'base_credits')::integer, -1)
    into v_cost
    from public.app_settings where key = 'credits.operation_costs';
  if v_cost is null or v_cost < 0 then
    raise exception 'unknown priced operation: %', p_operation using errcode = '22023';
  end if;

  -- Free is a legitimate price. It still answers, so a caller does not have to
  -- know which operations happen to cost nothing today.
  if v_cost = 0 then
    return jsonb_build_object('ok', true, 'repeated', false, 'operation', p_operation,
      'amount', 0, 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_wallet from public.credit_wallets where user_id = p_user_id for update;
  if not found then
    raise exception 'wallet not found' using errcode = 'P0002';
  end if;
  if v_wallet.balance < v_cost then
    return jsonb_build_object('ok', false, 'code', 'insufficient_jcoin',
      'operation', p_operation, 'amount', v_cost, 'balance', v_wallet.balance);
  end if;

  insert into public.credit_transactions (
    user_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, metadata
  ) values (
    p_user_id, 'reservation', -v_cost, v_cost,
    v_wallet.balance - v_cost, v_wallet.reserved + v_cost,
    p_idempotency_key, 'J Tanga band qilindi: ' || p_operation,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('operation', p_operation, 'reference_id', p_reference_id)
  );

  update public.credit_wallets
     set balance = balance - v_cost, reserved = reserved + v_cost, version = version + 1
   where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'repeated', false, 'operation', p_operation,
    'amount', v_cost, 'idempotency_key', p_idempotency_key,
    'balance', v_wallet.balance - v_cost);
end;
$$;

/**
 * Turns a reservation into a charge, once the work it paid for is done.
 *
 * The money has already left the balance; settling only releases the hold and
 * records that it was spent. Settling twice is a no-op rather than a second
 * charge.
 */
create or replace function public.jcoin_settle(
  p_idempotency_key text,
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.credit_transactions%rowtype;
  v_amount integer;
  v_wallet public.credit_wallets%rowtype;
begin
  select * into v_reservation from public.credit_transactions
   where user_id = p_user_id and idempotency_key = p_idempotency_key
     and type = 'reservation'::public.credit_transaction_type;
  if not found then
    return jsonb_build_object('ok', true, 'settled', false, 'code', 'nothing_to_settle');
  end if;

  -- The reservation row is permanent — it is the record that money was held —
  -- so whether this was already finished is a question about the settlement or
  -- the refund, not about the reservation.
  if exists (
    select 1 from public.credit_transactions
     where user_id = p_user_id
       and idempotency_key in (p_idempotency_key || ':settled', p_idempotency_key || ':refunded')
  ) then
    return jsonb_build_object('ok', true, 'settled', false, 'code', 'already_finished');
  end if;

  v_amount := abs(v_reservation.amount);
  select * into v_wallet from public.credit_wallets where user_id = p_user_id for update;

  insert into public.credit_transactions (
    user_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, metadata
  ) values (
    p_user_id, 'charge', 0, -v_amount,
    v_wallet.balance, v_wallet.reserved - v_amount,
    p_idempotency_key || ':settled', 'J Tanga sarflandi: ' || coalesce(v_reservation.metadata ->> 'operation', '—'),
    v_reservation.metadata
  )
  on conflict (user_id, idempotency_key) do nothing;

  if not found then
    return jsonb_build_object('ok', true, 'settled', false, 'code', 'already_settled');
  end if;

  update public.credit_wallets
     set reserved = greatest(reserved - v_amount, 0),
         lifetime_spent = lifetime_spent + v_amount,
         version = version + 1
   where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'settled', true, 'amount', v_amount);
end;
$$;

/**
 * Gives a reservation back, for a failure that was ours rather than theirs.
 *
 * A provider timeout, a conversion that crashed: the buyer did nothing wrong and
 * must not be left paying for it. A refund with nothing to refund is a no-op.
 */
create or replace function public.jcoin_refund(
  p_idempotency_key text,
  p_reason text default '',
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.credit_transactions%rowtype;
  v_amount integer;
  v_wallet public.credit_wallets%rowtype;
begin
  select * into v_reservation from public.credit_transactions
   where user_id = p_user_id and idempotency_key = p_idempotency_key
     and type = 'reservation'::public.credit_transaction_type;
  if not found then
    return jsonb_build_object('ok', true, 'refunded', false, 'code', 'nothing_to_refund');
  end if;

  -- Settled money is spent, not refundable here; refunded money is already back.
  if exists (
    select 1 from public.credit_transactions
     where user_id = p_user_id
       and idempotency_key in (p_idempotency_key || ':settled', p_idempotency_key || ':refunded')
  ) then
    return jsonb_build_object('ok', true, 'refunded', false, 'code', 'already_finished');
  end if;

  v_amount := abs(v_reservation.amount);
  select * into v_wallet from public.credit_wallets where user_id = p_user_id for update;

  insert into public.credit_transactions (
    user_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, metadata
  ) values (
    p_user_id, 'refund', v_amount, -v_amount,
    v_wallet.balance + v_amount, v_wallet.reserved - v_amount,
    p_idempotency_key || ':refunded',
    'J Tanga qaytarildi' || case when coalesce(btrim(p_reason), '') = '' then '' else ': ' || p_reason end,
    v_reservation.metadata || jsonb_build_object('refund_reason', p_reason)
  )
  on conflict (user_id, idempotency_key) do nothing;

  if not found then
    return jsonb_build_object('ok', true, 'refunded', false, 'code', 'already_refunded');
  end if;

  update public.credit_wallets
     set balance = balance + v_amount,
         reserved = greatest(reserved - v_amount, 0),
         version = version + 1
   where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'refunded', true, 'amount', v_amount);
end;
$$;

revoke all on function public.jcoin_reserve(text, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.jcoin_settle(text, uuid) from public, anon, authenticated;
revoke all on function public.jcoin_refund(text, text, uuid) from public, anon, authenticated;
grant execute on function public.jcoin_reserve(text, text, uuid, uuid, jsonb) to service_role;
grant execute on function public.jcoin_settle(text, uuid) to service_role;
grant execute on function public.jcoin_refund(text, text, uuid) to service_role;

/* ------------------------------------------------------- unlimited quotas */

/**
 * An allowance with no ceiling.
 *
 * Not `limit: 999999` — a huge number is a limit waiting to be hit by a bug, and
 * counting something nobody reads writes a row for nothing. An unlimited feature
 * answers `remaining: null` and never touches `subscription_usage`.
 */
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

create or replace function public.quota_consume(
  p_feature_key text,
  p_amount integer default 1,
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_start date;
  v_used integer;
  v_limit integer;
begin
  if p_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if coalesce(p_amount, 1) < 1 then
    raise exception 'quota amount must be positive' using errcode = '22023';
  end if;

  v_status := public.quota_status(p_feature_key, p_user_id);
  if (v_status ->> 'enabled')::boolean is not true then
    return jsonb_build_object('ok', false, 'code', 'not_entitled', 'feature', p_feature_key);
  end if;

  -- Nothing to count, so nothing is written.
  if coalesce((v_status ->> 'unlimited')::boolean, false) then
    return jsonb_build_object('ok', true, 'feature', p_feature_key, 'unlimited', true,
      'limit', null, 'remaining', null);
  end if;

  v_limit := (v_status ->> 'limit')::integer;
  v_start := (v_status ->> 'period_start')::date;

  insert into public.subscription_usage (user_id, feature_key, period_start, used)
  values (p_user_id, p_feature_key, v_start, 0)
  on conflict (user_id, feature_key, period_start) do nothing;

  -- Taken before the decision, so the count cannot change underneath it.
  select used into v_used from public.subscription_usage
   where user_id = p_user_id and feature_key = p_feature_key and period_start = v_start
   for update;

  if v_used + p_amount > v_limit then
    return jsonb_build_object('ok', false, 'code', 'quota_exhausted', 'feature', p_feature_key,
      'limit', v_limit, 'used', v_used, 'remaining', greatest(v_limit - v_used, 0),
      'resets_at', v_status -> 'resets_at');
  end if;

  update public.subscription_usage
     set used = used + p_amount, updated_at = now()
   where user_id = p_user_id and feature_key = p_feature_key and period_start = v_start
   returning used into v_used;

  return jsonb_build_object('ok', true, 'feature', p_feature_key, 'unlimited', false,
    'limit', v_limit, 'used', v_used, 'remaining', greatest(v_limit - v_used, 0),
    'resets_at', v_status -> 'resets_at');
end;
$$;

-- Members host without a ceiling; the free tier keeps its three a day.
update public.subscription_plans
   set features = jsonb_set(features, '{game_free_daily}',
         (features -> 'game_free_daily') || jsonb_build_object('unlimited', true, 'limit', null))
 where code = 'premium_monthly';
