-- The host stops being a metronome.
--
-- A quiz advanced only when somebody pressed a button, which meant the person
-- running the room had to watch a phone instead of the players — and with one
-- player answering instantly, everybody sat looking at a finished question
-- waiting for a tap.
--
-- Advancing needs two facts the host screen was never given: when the current
-- phase runs out, and how many have answered. Both are already on the session
-- and its answers; they were simply not in the payload.
--
-- The decision stays on the host device rather than moving to a scheduler. One
-- device owns the session, it is already subscribed to every change, and a
-- server-side timer would be a second thing that can advance a question — which
-- is how a room ends up skipping one.

create or replace function public.game_host_state(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_answered integer := 0;
begin
  select * into v_session from public.game_sessions where id = p_session_id;
  if not found or v_session.host_user_id is distinct from v_user then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  -- Only meaningful while a question is open, and only counted then: on a
  -- leaderboard this is a scan of every answer in the game for no reason.
  if v_session.status = 'question'::public.game_session_status then
    select count(*) into v_answered
      from public.game_answers a
     where a.session_id = p_session_id
       and a.question_index = v_session.current_index;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'game_id', v_session.game_id,
    'join_token', v_session.join_token,
    'join_code', v_session.join_code,
    'realtime_token', v_session.realtime_token,
    'current_index', v_session.current_index,
    'team_mode', v_session.team_mode,
    'teams', v_session.teams,
    'show_on_phones', v_session.show_on_phones,
    'sound_enabled', v_session.sound_enabled,
    'reward_plan', v_session.reward_plan,
    'reward_state', v_session.reward_state,
    'reward_reserved', v_session.reward_reserved,
    'player_count', v_session.player_count,
    'state_version', v_session.state_version,
    -- When this phase ends, so the host can advance without being told to.
    'phase_deadline', v_session.phase_deadline,
    'answered_count', v_answered
  );
end;
$$;

revoke all on function public.game_host_state(uuid) from public, anon;
grant execute on function public.game_host_state(uuid) to authenticated, service_role;
