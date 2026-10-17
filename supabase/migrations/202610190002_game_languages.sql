-- O‘yingoh in three languages.
--
-- A game is written in one language — Uzbek (Latin), English or Russian —
-- chosen when it is made, like a deck. `generate-game` asks the model for that
-- language; the projector reads it from the snapshot so the words it sets
-- itself (ROST/YOLG‘ON, "N javob", the results) match the questions on screen.
--
-- Grading compares normalised text. Russian answers need one more fold —
-- «ёлка» and «елка» are the same answer — and the Uzbek apostrophe fold is
-- repaired on the way (see the function below).

alter table public.games
  add column if not exists language text not null default 'uz';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'games_language_check') then
    alter table public.games add constraint games_language_check check (language in ('uz', 'en', 'ru'));
  end if;
end
$$;

comment on column public.games.language is 'Language the questions are written in: uz (Latin), en or ru.';

/**
 * Text the grader can compare. Lowercase, outer and doubled spaces gone, every
 * apostrophe variant folded to one, quotation marks dropped, and «ё» read as «е».
 *
 * The apostrophes are counted out with `repeat` on purpose. The original
 * spelled the replacement as a run of doubled quotes and came out five long for
 * eleven characters, and `translate` deletes whatever has no partner — so ’ and
 * ‘, the ones a phone keyboard actually types in o‘ and g‘, were dropped rather
 * than folded, and «O‘zbekiston» never matched «O'zbekiston».
 */
create or replace function public.game_normalize_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    translate(lower(translate(coalesce(p_value, ''), 'ʻʼ''`´’‘“”«»', repeat('''', 7))), 'ё', 'е'),
    '\s+', ' ', 'g'
  ));
$$;

/**
 * The projector's view of a match: as 202608110008 left it, plus the game's
 * language.
 */
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
declare
  v_session public.game_sessions%rowtype;
  v_question public.game_questions%rowtype;
  v_game public.games%rowtype;
  v_state jsonb;
begin
  select * into v_session from public.game_sessions
    where id = p_session_id
      and screen_token_hash = encode(extensions.digest(coalesce(p_screen_token, ''), 'sha256'), 'hex');
  if not found then
    raise exception 'screen token is not valid for this session' using errcode = '42501';
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

revoke all on function public.game_screen_snapshot(uuid, text) from public;
grant execute on function public.game_screen_snapshot(uuid, text) to anon, authenticated, service_role;
