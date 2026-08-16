-- The plan meets the work: hosting a game.
--
-- A member hosts without a ceiling. Somebody without a plan gets three a day
-- free, and pays 20 J for the fourth — the price coming from the one price list
-- rather than from a constant here.
--
-- Creating a session was not idempotent, which mattered much less when it was
-- free: two presses made two lobbies and the host used the second. Now the
-- second press would also charge twice, so the same fix serves both problems —
-- an unjoined lobby for the same game is returned rather than duplicated, the
-- way `order_find_open` already works for orders.

create or replace function public.game_session_create(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_session_id uuid;
  v_quota jsonb;
  v_charge jsonb;
  v_charged_key text;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.game_can_host(p_game_id, v_user) then
    raise exception 'O‘yin topilmadi yoki uni boshlash huquqingiz yo‘q.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = v_user and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;

  /**
   * A lobby nobody has joined is the same lobby.
   *
   * Returned rather than replaced, so a double press cannot make two rooms — and,
   * now that hosting can cost money, cannot pay for the second one either.
   */
  select * into v_session
    from public.game_sessions
   where host_user_id = v_user
     and game_id = p_game_id
     and status = 'lobby'::public.game_session_status
     and expires_at > now()
   order by created_at desc
   limit 1;
  if found then
    return jsonb_build_object(
      'session_id', v_session.id,
      'game_id', v_session.game_id,
      'join_token', v_session.join_token,
      'join_code', v_session.join_code,
      'realtime_token', v_session.realtime_token,
      'reused', true
    );
  end if;

  -- The id is decided here so it can be the idempotency key of the charge that
  -- pays for it. A charge keyed on something the session does not have yet
  -- could not be matched back to it afterwards.
  v_session_id := gen_random_uuid();

  v_quota := public.quota_consume('game_free_daily', 1, v_user);
  if coalesce((v_quota ->> 'ok')::boolean, false) is not true then
    if (v_quota ->> 'code') <> 'quota_exhausted' then
      raise exception 'O‘yin boshlash imkoniyati yo‘q.' using errcode = '42501';
    end if;

    v_charged_key := 'game-host:' || v_session_id::text;
    v_charge := public.jcoin_reserve('game_after_free_limit', v_charged_key, v_session_id, v_user);
    if coalesce((v_charge ->> 'ok')::boolean, false) is not true then
      raise exception 'Bugungi bepul o‘yinlar tugadi. Keyingisi uchun % J kerak.', v_charge ->> 'amount'
        using errcode = 'P0001', detail = 'insufficient_jcoin';
    end if;
  end if;

  insert into public.game_sessions (id, host_user_id, game_id, realtime_token, join_token, join_code)
  values (v_session_id, v_user, p_game_id,
          public.presentation_new_token(), public.presentation_new_token(), public.game_new_join_code())
  returning * into v_session;

  -- The room exists, so what was held aside is now spent.
  if v_charged_key is not null then
    perform public.jcoin_settle(v_charged_key, v_user);
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'game_id', v_session.game_id,
    'join_token', v_session.join_token,
    'join_code', v_session.join_code,
    'realtime_token', v_session.realtime_token,
    'reused', false,
    'charged', coalesce((v_charge ->> 'amount')::integer, 0)
  );
end;
$$;

revoke all on function public.game_session_create(uuid) from public, anon;
grant execute on function public.game_session_create(uuid) to authenticated;

-- `quota_consume` and the J Coin doors are service-role only, and this function
-- is `security definer`, so it reaches them as its owner while a client still
-- cannot call them directly.
