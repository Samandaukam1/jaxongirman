-- O‘yingoh on a laptop: the host's own screen, and the host's own phone.
--
-- A match hosted from the web app has no projector paired to it — the laptop
-- that started it is the big screen. It is signed in as the host, so it reads
-- the projector's view by being the host (`game_host_screen`) rather than by
-- holding a screen token that `game_session_create` never minted.
--
-- And the person at the laptop may pick up their phone and play. One account
-- on both is the common case — a teacher trying a quiz before the lesson, a
-- family round at home — so the host's own account may now join. It plays and
-- scores like anybody else; it is never paid out of its own reward hold. Being
-- paid from your own hold would turn plan coins, which cannot be sent to
-- anyone, into ordinary coins.

-- ----------------------------------------------------------------- joining --
/**
 * As 202608110004 left it, except that the host's own account is let in, as a
 * player who is not eligible for the host's own rewards.
 */
create or replace function public.game_join(
  p_join_token text,
  p_nickname text,
  p_avatar_id integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_player public.game_players%rowtype;
  v_nickname text := left(btrim(coalesce(p_nickname, '')), 30);
  v_team text;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if char_length(v_nickname) < 1 then
    raise exception 'Ismingizni yozing.' using errcode = '22023';
  end if;
  if p_avatar_id is null or p_avatar_id < 0 or p_avatar_id > 39 then
    raise exception 'avatar_id must be between 0 and 39' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = v_user and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;

  select * into v_session from public.game_sessions
    where join_token = p_join_token
    for update;
  if not found then
    raise exception 'O‘yin topilmadi. QR kodni qayta skaner qiling.' using errcode = 'P0002';
  end if;
  if v_session.status in ('finished'::public.game_session_status,
                          'cancelled'::public.game_session_status,
                          'expired'::public.game_session_status)
     or v_session.expires_at <= now() then
    raise exception 'Bu o‘yin yakunlangan.' using errcode = '22023';
  end if;
  if v_session.game_id is null then
    raise exception 'O‘yin hali tanlanmadi. Bir oz kutib qayta urinib ko‘ring.' using errcode = '22023';
  end if;

  if v_session.team_mode and jsonb_array_length(v_session.teams) > 0 then
    v_team := v_session.teams ->> (v_session.player_count % jsonb_array_length(v_session.teams));
  end if;

  insert into public.game_players (session_id, user_id, nickname, avatar_id, team, reward_eligible)
  values (
    v_session.id, v_user, v_nickname, p_avatar_id, v_team,
    -- A latecomer was not in the lobby the hold was priced on, and the host
    -- is never paid from their own hold.
    v_session.status = 'lobby'::public.game_session_status
      and v_session.host_user_id is distinct from v_user
  )
  on conflict (session_id, user_id) do update set
    nickname = excluded.nickname,
    avatar_id = excluded.avatar_id,
    status = 'joined'::public.game_player_status,
    last_seen_at = now()
  returning * into v_player;

  return jsonb_build_object(
    'session_id', v_session.id,
    'player_id', v_player.id,
    'nickname', v_player.nickname,
    'avatar_id', v_player.avatar_id,
    'team', v_player.team,
    'status', v_session.status,
    'state_version', v_session.state_version
  );
end;
$$;

-- ------------------------------------------------------------- the screen --
/**
 * What the big screen shows, for whoever has already been let in to see it.
 *
 * The body of `game_screen_snapshot` as 202610190002 left it, moved here so the
 * projector (by screen token) and the host's own laptop (by being the host)
 * read one and the same view. Not callable by a client: the two functions
 * below are the doors, and each checks its own key first.
 */
create or replace function public.game_screen_state(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_question public.game_questions%rowtype;
  v_game public.games%rowtype;
  v_state jsonb;
begin
  select * into v_session from public.game_sessions where id = p_session_id;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if v_session.game_id is not null then
    select * into v_game from public.games where id = v_session.game_id;
  end if;

  v_state := jsonb_build_object(
    'status', v_session.status,
    -- The two facts the projector renders its own state machine from: has a
    -- phone taken this screen over, and has that phone chosen a game yet.
    -- Neither reveals who the host is.
    'paired', v_session.host_user_id is not null,
    'game_selected', v_session.game_id is not null,
    'game_title', coalesce(v_game.title, ''),
    -- The projector prints its own words (true/false, answers, results) in the
    -- language the questions are written in, not the website's.
    'game_language', coalesce(v_game.language, 'uz'),
    'join_token', v_session.join_token,
    'join_code', v_session.join_code,
    'current_index', v_session.current_index,
    'question_count', coalesce(array_length(v_session.question_ids, 1),
                               case when v_session.game_id is null then 0
                                    else (select count(*)::integer from public.game_questions q where q.game_id = v_session.game_id) end),
    'phase_deadline', v_session.phase_deadline,
    'question_started_at', v_session.question_started_at,
    'team_mode', v_session.team_mode,
    'sound_enabled', v_session.sound_enabled,
    'player_count', v_session.player_count,
    'state_version', v_session.state_version,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gp.id, 'nickname', gp.nickname, 'avatar_id', gp.avatar_id, 'team', gp.team,
        'total_score', gp.total_score
      ) order by gp.joined_at)
      from public.game_players gp
      where gp.session_id = p_session_id and gp.status <> 'kicked'
    ), '[]'::jsonb)
  );

  if v_session.status in ('question'::public.game_session_status,
                          'question_result'::public.game_session_status)
     and v_session.current_index >= 0 then
    select * into v_question from public.game_questions
      where id = v_session.question_ids[v_session.current_index + 1];
    if found then
      v_state := v_state || jsonb_build_object(
        'question', public.game_sanitized_question(v_question, p_session_id),
        'answered_count', (
          select count(*) from public.game_answers
          where session_id = p_session_id and question_index = v_session.current_index
        )
      );
      if v_session.status = 'question_result'::public.game_session_status then
        v_state := v_state || jsonb_build_object(
          'reveal', jsonb_build_object(
            'config', v_question.config,
            'explanation', v_question.explanation,
            'stats', public.game_question_stats(p_session_id, v_session.current_index)
          )
        );
      end if;
    end if;
  end if;

  if v_session.status in ('leaderboard'::public.game_session_status,
                          'finished'::public.game_session_status) then
    v_state := v_state || jsonb_build_object('leaderboard', public.game_leaderboard_rows(p_session_id));
  end if;

  return v_state;
end;
$$;

/** The projector's door: the screen token it was handed once. Unchanged in what it answers. */
create or replace function public.game_screen_snapshot(
  p_session_id uuid,
  p_screen_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform 1 from public.game_sessions
    where id = p_session_id
      and screen_token_hash = encode(extensions.digest(coalesce(p_screen_token, ''), 'sha256'), 'hex');
  if not found then
    raise exception 'screen token is not valid for this session' using errcode = '42501';
  end if;
  return public.game_screen_state(p_session_id);
end;
$$;

/**
 * The host's door: the laptop that started the match is its big screen.
 *
 * Signed in as the host, so being the host is the authorisation; anybody else
 * — a player, a stranger, a signed-out browser — is told there is no such
 * session, the same answer `game_host_state` gives.
 */
create or replace function public.game_host_screen(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform 1 from public.game_sessions where id = p_session_id and host_user_id = v_user;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  return public.game_screen_state(p_session_id);
end;
$$;

revoke all on function public.game_screen_state(uuid) from public, anon, authenticated;
grant execute on function public.game_screen_state(uuid) to service_role;

revoke all on function public.game_screen_snapshot(uuid, text) from public;
grant execute on function public.game_screen_snapshot(uuid, text) to anon, authenticated, service_role;

revoke all on function public.game_host_screen(uuid) from public, anon;
grant execute on function public.game_host_screen(uuid) to authenticated, service_role;

revoke all on function public.game_join(text, text, integer) from public, anon;
grant execute on function public.game_join(text, text, integer) to authenticated, service_role;
