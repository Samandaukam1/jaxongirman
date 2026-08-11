-- O‘yingoh rewards: the host's coins, held before the first question and
-- settled after the last one.
--
-- The invariant this file exists for: a match can never end with "balans
-- yetmaydi". The maximum the plan could pay is computed from the real player
-- count at the moment the host presses start, and that many coins move from
-- the host's balance into their reserve — the same hold the generation
-- pipeline uses. Settlement pays winners out of the hold and refunds the rest;
-- cancellation refunds all of it. Every movement is a credit_transactions row
-- with an idempotency key derived from the session id, so a retried settlement
-- is a no-op rather than a second payout.
--
-- Nothing here is callable by a client. These are plumbing functions invoked
-- by the session lifecycle RPCs in the next migration, inside the same
-- transaction that changes the session's status.

-- Guard rails for the plan itself, tunable without a migration.
insert into public.app_settings (key, value, description, public_read)
values (
  'games.rewards',
  '{"max_per_player": 1000, "max_total": 20000}'::jsonb,
  'O‘yingoh reward limits: the most one player may receive from one match, and the largest total hold one match may take.',
  true
)
on conflict (key) do nothing;

/**
 * What the plan would cost at worst, for this many players.
 *
 * Podium places only count when enough players exist to fill them, and the
 * participation coin goes to every player, podium included — the ceiling is
 * deliberately simple enough for the host to predict from the lobby screen.
 */
create or replace function public.game_reward_liability(p_plan jsonb, p_player_count integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select
    coalesce((p_plan ->> 'participant')::integer, 0) * greatest(p_player_count, 0)
    + case when p_player_count >= 1 then coalesce((p_plan ->> 'first')::integer, 0) else 0 end
    + case when p_player_count >= 2 then coalesce((p_plan ->> 'second')::integer, 0) else 0 end
    + case when p_player_count >= 3 then coalesce((p_plan ->> 'third')::integer, 0) else 0 end;
$$;

/** Rejects a malformed or over-limit plan. Returns the plan, normalised. */
create or replace function public.game_reward_plan_check(p_plan jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limits jsonb;
  v_max_per integer;
  v_key text;
  v_value integer;
  v_clean jsonb := '{}'::jsonb;
begin
  select coalesce(value, '{}'::jsonb) into v_limits from public.app_settings where key = 'games.rewards';
  v_max_per := coalesce((v_limits ->> 'max_per_player')::integer, 1000);

  foreach v_key in array array['first', 'second', 'third', 'participant'] loop
    if p_plan ? v_key then
      begin
        v_value := (p_plan ->> v_key)::integer;
      exception when others then
        raise exception 'reward plan field % must be a whole number', v_key using errcode = '22023';
      end;
      if v_value < 0 then
        raise exception 'reward plan field % must not be negative', v_key using errcode = '22023';
      end if;
      if v_value > v_max_per then
        raise exception 'Bitta ishtirokchiga eng ko‘pi bilan % J berish mumkin.', v_max_per using errcode = '22023';
      end if;
      if v_value > 0 then
        v_clean := v_clean || jsonb_build_object(v_key, v_value);
      end if;
    end if;
  end loop;

  return v_clean;
end;
$$;

/**
 * Takes the hold. Called by game_session_advance('start') with the session row
 * already locked. Raises with a message the host can act on when the balance
 * does not cover the plan.
 */
create or replace function public.game_rewards_reserve(p_session public.game_sessions)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits jsonb;
  v_max_total integer;
  v_liability integer;
  v_wallet public.credit_wallets%rowtype;
begin
  if p_session.reward_state = 'reserved' then
    return p_session.reward_reserved;
  end if;
  if p_session.reward_state <> 'none' then
    raise exception 'rewards for this session are already settled' using errcode = '22023';
  end if;

  v_liability := public.game_reward_liability(p_session.reward_plan, p_session.player_count);
  if v_liability <= 0 then
    return 0;
  end if;

  select coalesce(value, '{}'::jsonb) into v_limits from public.app_settings where key = 'games.rewards';
  v_max_total := coalesce((v_limits ->> 'max_total')::integer, 20000);
  if v_liability > v_max_total then
    raise exception 'Mukofot jamg‘armasi eng ko‘pi bilan % J bo‘lishi mumkin. Rejani kamaytiring.', v_max_total using errcode = '22023';
  end if;

  select * into v_wallet from public.credit_wallets where user_id = p_session.host_user_id for update;
  if not found then
    raise exception 'credit wallet not found' using errcode = 'P0002';
  end if;
  if v_wallet.balance < v_liability then
    raise exception 'Mukofotlar uchun % J kerak, balansingizda % J bor. Rejani kamaytiring yoki balansni to‘ldiring.',
      v_liability, v_wallet.balance using errcode = 'P0001';
  end if;

  update public.credit_wallets
    set balance = balance - v_liability,
        reserved = reserved + v_liability,
        version = version + 1
    where user_id = p_session.host_user_id;

  insert into public.credit_transactions (
    user_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, metadata
  ) values (
    p_session.host_user_id, 'game_reward_reserve', -v_liability, v_liability,
    v_wallet.balance - v_liability, v_wallet.reserved + v_liability,
    'game-reserve:' || p_session.id, 'O‘yingoh mukofot jamg‘armasi band qilindi',
    jsonb_build_object('game_session_id', p_session.id, 'game_id', p_session.game_id,
                       'plan', p_session.reward_plan, 'player_count', p_session.player_count)
  )
  on conflict (user_id, idempotency_key) do nothing;

  update public.game_sessions
    set reward_state = 'reserved', reward_reserved = v_liability
    where id = p_session.id;

  return v_liability;
end;
$$;

/**
 * Pays one person out of the hold. The recipient's wallet gains the amount;
 * the hold shrinks by the same amount on the host side at the end of
 * settlement, not here — the caller tracks the running total.
 */
create or replace function public.game_reward_pay(
  p_session public.game_sessions,
  p_user_id uuid,
  p_amount integer,
  p_kind text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet public.credit_wallets%rowtype;
  v_inserted boolean;
begin
  if p_amount <= 0 then
    return false;
  end if;

  select * into v_wallet from public.credit_wallets where user_id = p_user_id for update;
  if not found then
    return false;
  end if;

  insert into public.credit_transactions (
    user_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, metadata
  ) values (
    p_user_id, 'game_reward', p_amount, 0,
    v_wallet.balance + p_amount, v_wallet.reserved,
    'game-reward:' || p_session.id || ':' || p_kind || ':' || p_user_id,
    'O‘yingoh mukofoti',
    jsonb_build_object('game_session_id', p_session.id, 'game_id', p_session.game_id, 'kind', p_kind)
  )
  on conflict (user_id, idempotency_key) do nothing
  returning true into v_inserted;

  -- The unique key already paid this exact reward once; a replay changes nothing.
  if v_inserted is not true then
    return false;
  end if;

  update public.credit_wallets
    set balance = balance + p_amount,
        lifetime_granted = lifetime_granted + p_amount,
        version = version + 1
    where user_id = p_user_id;

  insert into public.notifications (user_id, kind, title, body, payload, entity_id)
  values (
    p_user_id, 'game_reward', p_amount || ' J mukofot oldingiz 🏆',
    case p_kind
      when 'first' then 'O‘yinda 1-o‘rin uchun mukofot hisobingizga qo‘shildi.'
      when 'second' then 'O‘yinda 2-o‘rin uchun mukofot hisobingizga qo‘shildi.'
      when 'third' then 'O‘yinda 3-o‘rin uchun mukofot hisobingizga qo‘shildi.'
      else 'O‘yinda qatnashganingiz uchun mukofot hisobingizga qo‘shildi.'
    end,
    jsonb_build_object('game_session_id', p_session.id, 'amount', p_amount, 'kind', p_kind),
    p_session.id
  );

  return true;
end;
$$;

/**
 * Settles a finished match: winners and participants are paid, the unused
 * remainder of the hold returns to the host, and the session is marked settled
 * — all in the caller's transaction.
 *
 * Only `reward_eligible` players are paid, and the podium is decided by rank
 * *among them*. That is what keeps the payout inside the hold by construction:
 * the hold was priced on the lobby, so somebody who joined during question
 * three cannot enlarge it, and their arrival must not push a prize the host
 * already promised out of reach either. The three podium prizes are still paid
 * — to the best eligible players — so the amount can only ever be less than or
 * equal to what was reserved.
 *
 * Players who left before the end still count: they answered questions, and a
 * dropped connection should not cost a nine-year-old their coin.
 */
create or replace function public.game_rewards_settle(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_plan jsonb;
  v_paid integer := 0;
  v_amount integer;
  v_player record;
  v_host_wallet public.credit_wallets%rowtype;
  v_release integer;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_session.reward_state = 'settled' or v_session.reward_state = 'refunded' then
    return jsonb_build_object('paid', 0, 'released', 0, 'already', true);
  end if;
  if v_session.reward_state <> 'reserved' or v_session.reward_reserved <= 0 then
    update public.game_sessions set reward_state = 'settled' where id = p_session_id;
    return jsonb_build_object('paid', 0, 'released', 0, 'already', false);
  end if;

  v_plan := v_session.reward_plan;

  for v_player in
    -- `place` is the standing among eligible players, which is the number the
    -- prizes are keyed on. `rank` stays whatever the whole room produced; it is
    -- what the podium screen shows.
    select gp.user_id,
           row_number() over (order by gp.total_score desc, gp.joined_at) as place
    from public.game_players gp
    where gp.session_id = p_session_id
      and gp.status <> 'kicked'
      and gp.reward_eligible
    order by place
  loop
    -- The podium prize for this player's place among the eligible.
    v_amount := case v_player.place
      when 1 then coalesce((v_plan ->> 'first')::integer, 0)
      when 2 then coalesce((v_plan ->> 'second')::integer, 0)
      when 3 then coalesce((v_plan ->> 'third')::integer, 0)
      else 0
    end;
    if v_amount > 0 and public.game_reward_pay(v_session, v_player.user_id,
        v_amount, case v_player.place when 1 then 'first' when 2 then 'second' else 'third' end) then
      v_paid := v_paid + v_amount;
    end if;

    -- The participation coin, podium included.
    v_amount := coalesce((v_plan ->> 'participant')::integer, 0);
    if v_amount > 0 and public.game_reward_pay(v_session, v_player.user_id, v_amount, 'participant') then
      v_paid := v_paid + v_amount;
    end if;
  end loop;

  -- The hold resolves in one movement on the host side: what was paid leaves
  -- the reserve for good, what was not returns to the balance.
  v_release := v_session.reward_reserved - v_paid;
  if v_release < 0 then
    -- Cannot happen while liability >= any payout sum, but a settlement must
    -- never take more than it held.
    raise exception 'reward settlement exceeded its reserve' using errcode = 'P0001';
  end if;

  select * into v_host_wallet from public.credit_wallets where user_id = v_session.host_user_id for update;

  update public.credit_wallets
    set reserved = reserved - v_session.reward_reserved,
        balance = balance + v_release,
        lifetime_spent = lifetime_spent + v_paid,
        version = version + 1
    where user_id = v_session.host_user_id;

  insert into public.credit_transactions (
    user_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, metadata
  ) values (
    v_session.host_user_id, 'game_reward_refund', v_release, -v_session.reward_reserved,
    v_host_wallet.balance + v_release, v_host_wallet.reserved - v_session.reward_reserved,
    'game-settle:' || p_session_id, 'O‘yingoh mukofotlari yakunlandi',
    jsonb_build_object('game_session_id', p_session_id, 'paid', v_paid, 'released', v_release)
  )
  on conflict (user_id, idempotency_key) do nothing;

  update public.game_sessions
    set reward_state = 'settled'
    where id = p_session_id;

  return jsonb_build_object('paid', v_paid, 'released', v_release, 'already', false);
end;
$$;

/**
 * Returns the whole hold. The cancellation path: nobody is paid, the host gets
 * every coin back, and the ledger says why.
 */
create or replace function public.game_rewards_refund(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_wallet public.credit_wallets%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_session.reward_state <> 'reserved' or v_session.reward_reserved <= 0 then
    update public.game_sessions set reward_state =
      case when reward_state = 'reserved' then 'refunded' else reward_state end
      where id = p_session_id;
    return 0;
  end if;

  select * into v_wallet from public.credit_wallets where user_id = v_session.host_user_id for update;

  update public.credit_wallets
    set reserved = reserved - v_session.reward_reserved,
        balance = balance + v_session.reward_reserved,
        version = version + 1
    where user_id = v_session.host_user_id;

  insert into public.credit_transactions (
    user_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, metadata
  ) values (
    v_session.host_user_id, 'game_reward_refund', v_session.reward_reserved, -v_session.reward_reserved,
    v_wallet.balance + v_session.reward_reserved, v_wallet.reserved - v_session.reward_reserved,
    'game-refund:' || p_session_id, 'O‘yingoh bekor qilindi — mukofot jamg‘armasi qaytarildi',
    jsonb_build_object('game_session_id', p_session_id)
  )
  on conflict (user_id, idempotency_key) do nothing;

  update public.game_sessions
    set reward_state = 'refunded'
    where id = p_session_id;

  return v_session.reward_reserved;
end;
$$;

-- Plumbing only: no client role may call any of these directly. The lifecycle
-- RPCs in the next migration are the sole callers.
revoke all on function public.game_reward_liability(jsonb, integer) from public, anon, authenticated;
revoke all on function public.game_reward_plan_check(jsonb) from public, anon, authenticated;
revoke all on function public.game_rewards_reserve(public.game_sessions) from public, anon, authenticated;
revoke all on function public.game_reward_pay(public.game_sessions, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.game_rewards_settle(uuid) from public, anon, authenticated;
revoke all on function public.game_rewards_refund(uuid) from public, anon, authenticated;
grant execute on function public.game_rewards_settle(uuid) to service_role;
grant execute on function public.game_rewards_refund(uuid) to service_role;
