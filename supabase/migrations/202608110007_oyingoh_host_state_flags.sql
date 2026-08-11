-- The host's lobby switches, missing from the state the remote reads.
--
-- `game_session_configure()` has always been able to set `show_on_phones` and
-- `sound_enabled`, and both the player state and the screen snapshot report
-- them. `game_host_state()` did not, so the two switches on the remote had
-- nothing to render their current position from — a checkbox that always looked
-- off, and turned itself on on every press.
--
-- Forward-only: 202608110004 is already applied on the remote, so this replaces
-- the function rather than editing that file.

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
begin
  select * into v_session from public.game_sessions where id = p_session_id;
  if not found or v_session.host_user_id is distinct from v_user then
    raise exception 'session not found' using errcode = 'P0002';
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
    'state_version', v_session.state_version
  );
end;
$$;

revoke all on function public.game_host_state(uuid) from public, anon;
grant execute on function public.game_host_state(uuid) to authenticated, service_role;
