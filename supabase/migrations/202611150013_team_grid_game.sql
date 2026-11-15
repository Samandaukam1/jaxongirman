-- The team grid game (Jaxongirman.app 2.0, §5.3), in the manner of Baamboozle.
--
-- A game of kind 'grid' is open-answer questions with their answers
-- (`config.reference`), each worth 500, 1000 or 1500 by how hard it is. On
-- the board the questions hide behind numbered cells — 30 for two teams, 36
-- for three — showing only what each is worth. The teams take turns to pick a
-- cell; the host opens it, the board shows the question, the team answers
-- aloud, and the host taps "To‘g‘ri" or "Noto‘g‘ri" on the phone. Right adds
-- the cell's points to the team; either way the turn passes on.
--
-- It is played in the same session as any O‘yingoh match, so the board pairs
-- and reads it the same way; its state is `game_sessions.grid`, moved only by
-- the game_grid_* functions, each of them the host's alone.

alter table public.games drop constraint if exists games_kind;
alter table public.games add constraint games_kind check (kind in ('quiz', 'crossword', 'grid'));

alter table public.game_sessions add column if not exists grid jsonb;
comment on column public.game_sessions.grid is
  'A team grid game: {teams, scores, turn, cells: [{q, points, state closed|won|missed, team}], open, revealed}.';

/**
 * The grid as one side may see it. The board (`p_host` false) gets the cells'
 * points and fates and, for the open cell, its question — and its answer only
 * once the host has shown it. The host gets the open cell's answer always.
 */
create or replace function public.game_grid_view(p_session public.game_sessions, p_host boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_grid jsonb := p_session.grid;
  v_open integer;
  v_question public.game_questions%rowtype;
begin
  if v_grid is null then return null; end if;
  v_open := (v_grid ->> 'open')::integer;
  if v_open is not null then
    select * into v_question from public.game_questions where id = (v_grid -> 'cells' -> v_open ->> 'q')::uuid;
  end if;
  return jsonb_build_object(
    'teams', v_grid -> 'teams',
    'scores', v_grid -> 'scores',
    'turn', v_grid -> 'turn',
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object('points', cell -> 'points', 'state', cell -> 'state', 'team', cell -> 'team') order by at)
      from jsonb_array_elements(v_grid -> 'cells') with ordinality as listed(cell, at)
    ), '[]'::jsonb),
    'open', case when v_open is null then null else jsonb_build_object(
      'cell', v_open,
      'points', v_grid -> 'cells' -> v_open -> 'points',
      'prompt', v_question.prompt,
      'media_path', v_question.media_path,
      'answer', case when p_host or coalesce((v_grid ->> 'revealed')::boolean, false)
                     then coalesce(v_question.config ->> 'reference', '') end,
      'revealed', coalesce((v_grid ->> 'revealed')::boolean, false)
    ) end
  );
end;
$$;
revoke all on function public.game_grid_view(public.game_sessions, boolean) from public, anon, authenticated;

/** The session, when it is the caller's and holds a grid game; locked for the change. */
create or replace function public.game_grid_session(p_session_id uuid)
returns public.game_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found or v_session.host_user_id is distinct from auth.uid() then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if (select g.kind from public.games g where g.id = v_session.game_id) is distinct from 'grid' then
    raise exception 'Bu jamoaviy o‘yin emas.' using errcode = '22023';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'Sessiya muddati tugagan.' using errcode = '22023';
  end if;
  return v_session;
end;
$$;
revoke all on function public.game_grid_session(uuid) from public, anon, authenticated;

/**
 * Starts the game: the teams, and the cells dealt from the questions — as
 * many of each worth as there are, shuffled, so every row has easy and hard.
 */
create or replace function public.game_grid_start(p_session_id uuid, p_teams text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_grid_session(p_session_id);
  v_names text[];
  v_target integer;
  v_cells jsonb;
begin
  if v_session.status <> 'lobby'::public.game_session_status then
    raise exception 'O‘yin allaqachon boshlangan.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_teams, 1), 0) not between 2 and 3 then
    raise exception 'Ikki yoki uch jamoa bo‘lsin.' using errcode = '22023';
  end if;
  select array_agg(coalesce(nullif(left(btrim(name), 40), ''), at || '-jamoa') order by at)
    into v_names from unnest(p_teams) with ordinality as listed(name, at);
  v_target := case when array_length(v_names, 1) = 2 then 30 else 36 end;

  -- Take questions round-robin across the worths, then shuffle the board.
  select jsonb_agg(jsonb_build_object('q', picked.id, 'points', picked.base_points, 'state', 'closed', 'team', null) order by random())
    into v_cells
    from (
      select q.id, q.base_points
        from (
          select q.id, q.base_points, row_number() over (partition by q.base_points order by random()) as turn
            from public.game_questions q
           where q.game_id = v_session.game_id and q.type = 'open_answer'::public.game_question_type
        ) q
       order by q.turn, q.base_points
       limit v_target
    ) picked;
  if coalesce(jsonb_array_length(v_cells), 0) < 9 then
    raise exception 'Jamoaviy o‘yin uchun kamida 9 ta savol kerak.' using errcode = '22023';
  end if;

  update public.game_sessions set
    status = 'question'::public.game_session_status,
    team_mode = true,
    teams = to_jsonb(v_names),
    grid = jsonb_build_object(
      'teams', to_jsonb(v_names),
      'scores', (select jsonb_agg(0) from unnest(v_names)),
      'turn', 0,
      'cells', v_cells,
      'open', null,
      'revealed', false
    ),
    started_at = now(), state_version = state_version + 1, last_advance_at = now()
    where id = v_session.id
    returning * into v_session;
  return public.game_grid_view(v_session, true);
end;
$$;

/** Opens a closed cell: its question goes up on the board. */
create or replace function public.game_grid_open(p_session_id uuid, p_cell integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_grid_session(p_session_id);
begin
  if v_session.status <> 'question'::public.game_session_status or v_session.grid is null then
    raise exception 'O‘yin hali boshlanmagan.' using errcode = '22023';
  end if;
  if (v_session.grid ->> 'open') is not null then
    raise exception 'Avval ochiq savolni baholang.' using errcode = '22023';
  end if;
  if p_cell is null or p_cell < 0 or p_cell >= jsonb_array_length(v_session.grid -> 'cells')
     or v_session.grid -> 'cells' -> p_cell ->> 'state' <> 'closed' then
    raise exception 'Bu katak allaqachon ochilgan.' using errcode = '22023';
  end if;
  update public.game_sessions set
    grid = grid || jsonb_build_object('open', p_cell, 'revealed', false),
    state_version = state_version + 1, last_advance_at = now()
    where id = v_session.id returning * into v_session;
  return public.game_grid_view(v_session, true);
end;
$$;

/** Shows the open question's answer on the board. */
create or replace function public.game_grid_reveal(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_grid_session(p_session_id);
begin
  if (v_session.grid ->> 'open') is null then raise exception 'Ochiq savol yo‘q.' using errcode = '22023'; end if;
  update public.game_sessions set grid = grid || '{"revealed": true}'::jsonb,
    state_version = state_version + 1, last_advance_at = now()
    where id = v_session.id returning * into v_session;
  return public.game_grid_view(v_session, true);
end;
$$;

/** Puts an open cell back, unanswered: a tap on the wrong number. */
create or replace function public.game_grid_close(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_grid_session(p_session_id);
begin
  update public.game_sessions set grid = grid || '{"open": null, "revealed": false}'::jsonb,
    state_version = state_version + 1, last_advance_at = now()
    where id = v_session.id returning * into v_session;
  return public.game_grid_view(v_session, true);
end;
$$;

/**
 * The host's verdict on the open cell for the team whose turn it is: right
 * wins the cell's points, wrong spends the cell; the turn passes either way.
 * The last cell ends the game.
 */
create or replace function public.game_grid_judge(p_session_id uuid, p_correct boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_grid_session(p_session_id);
  v_grid jsonb := v_session.grid;
  v_open integer := (v_grid ->> 'open')::integer;
  v_turn integer := (v_grid ->> 'turn')::integer;
  v_teams integer := jsonb_array_length(v_grid -> 'teams');
  v_points integer;
  v_left integer;
begin
  if v_open is null then raise exception 'Ochiq savol yo‘q.' using errcode = '22023'; end if;
  v_points := (v_grid -> 'cells' -> v_open ->> 'points')::integer;
  v_grid := jsonb_set(v_grid, array['cells', v_open::text], (v_grid -> 'cells' -> v_open) || jsonb_build_object(
    'state', case when p_correct then 'won' else 'missed' end,
    'team', case when p_correct then to_jsonb(v_turn) else 'null'::jsonb end));
  if p_correct then
    v_grid := jsonb_set(v_grid, array['scores', v_turn::text], to_jsonb((v_grid -> 'scores' ->> v_turn)::integer + v_points));
  end if;
  v_grid := v_grid || jsonb_build_object('open', null, 'revealed', false, 'turn', (v_turn + 1) % v_teams);
  select count(*) into v_left from jsonb_array_elements(v_grid -> 'cells') as cell where cell ->> 'state' = 'closed';

  update public.game_sessions set
    grid = v_grid,
    status = case when v_left = 0 then 'finished'::public.game_session_status else status end,
    ended_at = case when v_left = 0 then now() else ended_at end,
    state_version = state_version + 1, last_advance_at = now()
    where id = v_session.id returning * into v_session;
  return public.game_grid_view(v_session, true);
end;
$$;

/** Ends the game where it stands. */
create or replace function public.game_grid_finish(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_grid_session(p_session_id);
begin
  update public.game_sessions set
    grid = case when grid is null then null else grid || '{"open": null, "revealed": false}'::jsonb end,
    status = 'finished'::public.game_session_status, ended_at = now(),
    state_version = state_version + 1, last_advance_at = now()
    where id = v_session.id returning * into v_session;
  return public.game_grid_view(v_session, true);
end;
$$;

revoke all on function public.game_grid_start(uuid, text[]) from public, anon;
revoke all on function public.game_grid_open(uuid, integer) from public, anon;
revoke all on function public.game_grid_reveal(uuid) from public, anon;
revoke all on function public.game_grid_close(uuid) from public, anon;
revoke all on function public.game_grid_judge(uuid, boolean) from public, anon;
revoke all on function public.game_grid_finish(uuid) from public, anon;
grant execute on function public.game_grid_start(uuid, text[]) to authenticated;
grant execute on function public.game_grid_open(uuid, integer) to authenticated;
grant execute on function public.game_grid_reveal(uuid) to authenticated;
grant execute on function public.game_grid_close(uuid) to authenticated;
grant execute on function public.game_grid_judge(uuid, boolean) to authenticated;
grant execute on function public.game_grid_finish(uuid) to authenticated;

create or replace function public.game_session_advance(p_session_id uuid, p_action text DEFAULT 'next'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_question public.game_questions%rowtype;
  v_next integer;
  v_settlement jsonb;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found or v_session.host_user_id is distinct from v_user then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'Sessiya muddati tugagan.' using errcode = '22023';
  end if;
  -- A team grid game is moved by its own buttons (game_grid_*); only leaving it is shared.
  if p_action <> 'cancel' and (select g.kind from public.games g where g.id = v_session.game_id) = 'grid' then
    raise exception 'Jamoaviy o‘yin o‘z tugmalari bilan boshqariladi.' using errcode = '22023';
  end if;

  if p_action = 'cancel' then
    if v_session.status in ('finished'::public.game_session_status,
                            'cancelled'::public.game_session_status) then
      raise exception 'O‘yin allaqachon yakunlangan.' using errcode = '22023';
    end if;
    perform public.game_rewards_refund(p_session_id);
    update public.game_sessions set
      status = 'cancelled'::public.game_session_status,
      ended_at = now(), phase_deadline = null,
      state_version = state_version + 1, last_advance_at = now()
      where id = p_session_id;
    return jsonb_build_object('status', 'cancelled');
  end if;

  if p_action = 'finish' or (
    p_action = 'next'
    and v_session.status = 'leaderboard'::public.game_session_status
    and v_session.current_index + 1 >= coalesce(array_length(v_session.question_ids, 1), 0)
  ) then
    if v_session.status in ('finished'::public.game_session_status,
                            'cancelled'::public.game_session_status,
                            'lobby'::public.game_session_status) then
      raise exception 'O‘yin bu holatdan yakunlanmaydi.' using errcode = '22023';
    end if;

    -- Final ranks are written once, before settlement reads them.
    with ranked as (
      select gp.id, rank() over (order by gp.total_score desc, gp.joined_at) as place
      from public.game_players gp
      where gp.session_id = p_session_id and gp.status <> 'kicked'
    )
    update public.game_players gp set rank = ranked.place
    from ranked where gp.id = ranked.id;

    update public.game_sessions set
      status = 'finished'::public.game_session_status,
      ended_at = now(), phase_deadline = null,
      state_version = state_version + 1, last_advance_at = now()
      where id = p_session_id;

    v_settlement := public.game_rewards_settle(p_session_id);

    -- Podium news goes out whether or not coins were configured.
    insert into public.notifications (user_id, kind, title, body, payload, entity_id)
    select gp.user_id, 'game_result',
      case gp.rank when 1 then 'O‘yinda 1-o‘rinni egalladingiz 🥇'
                   when 2 then 'O‘yinda 2-o‘rinni egalladingiz 🥈'
                   else 'O‘yinda 3-o‘rinni egalladingiz 🥉' end,
      'Natijalar O‘yingoh tarixida saqlanadi.',
      jsonb_build_object('game_session_id', p_session_id, 'rank', gp.rank, 'score', gp.total_score),
      p_session_id
    from public.game_players gp
    where gp.session_id = p_session_id and gp.rank between 1 and 3 and gp.status <> 'kicked';

    return jsonb_build_object('status', 'finished', 'settlement', v_settlement);
  end if;

  if p_action <> 'next' then
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;

  case v_session.status
    when 'lobby'::public.game_session_status then
      if v_session.game_id is null then
        raise exception 'Avval o‘yinni tanlang.' using errcode = '22023';
      end if;
      if v_session.player_count < 1 then
        raise exception 'Hech kim qo‘shilmadi. Kamida bitta ishtirokchi kerak.' using errcode = '22023';
      end if;
      if not public.game_can_host(v_session.game_id, v_user) then
        raise exception 'O‘yinni boshlash huquqingiz yo‘q.' using errcode = '42501';
      end if;

      -- The deck snapshot: edits to the game after this moment change nothing
      -- for this room.
      select coalesce(array_agg(q.id order by q.position, q.created_at), '{}')
        into v_session.question_ids
        from public.game_questions q where q.game_id = v_session.game_id;
      if coalesce(array_length(v_session.question_ids, 1), 0) < 1 then
        raise exception 'Bu o‘yinda hali savol yo‘q.' using errcode = '22023';
      end if;

      -- The coin hold happens here, before anything is shown to the room.
      perform public.game_rewards_reserve(v_session);

      update public.games set sessions_count = sessions_count + 1 where id = v_session.game_id;

      update public.game_sessions set
        status = 'countdown'::public.game_session_status,
        question_ids = v_session.question_ids,
        current_index = -1,
        started_at = now(),
        phase_deadline = now() + interval '4 seconds',
        state_version = state_version + 1, last_advance_at = now()
        where id = p_session_id;

    when 'countdown'::public.game_session_status,
         'question_result'::public.game_session_status,
         'leaderboard'::public.game_session_status then
      if v_session.status = 'question_result'::public.game_session_status then
        -- Result → leaderboard, always: the scoreboard is part of the rhythm.
        update public.game_sessions set
          status = 'leaderboard'::public.game_session_status,
          phase_deadline = null,
          state_version = state_version + 1, last_advance_at = now()
          where id = p_session_id;
      else
        v_next := v_session.current_index + 1;
        if v_next >= coalesce(array_length(v_session.question_ids, 1), 0) then
          -- Countdown with an empty snapshot cannot happen (checked at start);
          -- leaderboard past the last question is handled by the finish branch.
          raise exception 'Savollar tugadi.' using errcode = '22023';
        end if;
        select * into v_question from public.game_questions where id = v_session.question_ids[v_next + 1];
        if not found then
          raise exception 'Savol topilmadi — o‘yin o‘zgartirilgan.' using errcode = 'P0002';
        end if;
        update public.game_sessions set
          status = 'question'::public.game_session_status,
          current_index = v_next,
          question_started_at = now(),
          phase_deadline = now() + make_interval(secs => v_question.time_limit_seconds),
          state_version = state_version + 1, last_advance_at = now()
          where id = p_session_id;
      end if;

    when 'question'::public.game_session_status then
      perform public.game_to_result(v_session);

    else
      raise exception 'O‘yin bu holatdan davom etmaydi.' using errcode = '22023';
  end case;

  select * into v_session from public.game_sessions where id = p_session_id;
  return jsonb_build_object(
    'status', v_session.status,
    'current_index', v_session.current_index,
    'phase_deadline', v_session.phase_deadline,
    'state_version', v_session.state_version
  );
end;
$function$;

create or replace function public.game_screen_state(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'game_kind', coalesce(v_game.kind, 'quiz'),
    -- A team grid game: the board's own picture of it, never an answer the host has not shown.
    'grid', public.game_grid_view(v_session, false),
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
    'allow_late_join', v_session.allow_late_join,
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
            -- A crossword counts the players who finished it.
            and (v_question.type <> 'crossword'::public.game_question_type or payload ->> 'done' = 'true')
        )
      );
      if v_question.type = 'crossword'::public.game_question_type then
        v_state := v_state || jsonb_build_object(
          'crossword_progress', public.game_crossword_progress(p_session_id, v_session.current_index));
      end if;
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
$function$;

create or replace function public.game_host_state(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_answered integer := 0;
  v_question public.game_questions%rowtype;
  v_current jsonb;
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
       and a.question_index = v_session.current_index
       -- A crossword counts the players who finished it.
       and coalesce(a.payload ->> 'done', 'true') <> 'false';  -- compared as text: a player's payload is not trusted to be a boolean
  end if;

  -- The host sees the open question with its answer: the room does not, but
  -- the person running it should, to explain and to keep an eye on answers.
  if v_session.status in ('question'::public.game_session_status, 'question_result'::public.game_session_status)
     and v_session.question_ids is not null then
    select * into v_question from public.game_questions
      where id = v_session.question_ids[v_session.current_index + 1];
    if found then
      v_current := jsonb_build_object(
        'id', v_question.id, 'type', v_question.type, 'prompt', v_question.prompt,
        'media_path', v_question.media_path, 'config', v_question.config,
        'explanation', v_question.explanation);
      if v_question.type = 'crossword'::public.game_question_type then
        v_current := v_current || jsonb_build_object(
          'crossword_progress', public.game_crossword_progress(p_session_id, v_session.current_index));
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'game_id', v_session.game_id,
    'game_kind', coalesce((select g.kind from public.games g where g.id = v_session.game_id), 'quiz'),
    'grid', public.game_grid_view(v_session, true),
    'join_token', v_session.join_token,
    'join_code', v_session.join_code,
    'realtime_token', v_session.realtime_token,
    'current_index', v_session.current_index,
    'team_mode', v_session.team_mode,
    'teams', v_session.teams,
    'show_on_phones', v_session.show_on_phones,
    'allow_late_join', v_session.allow_late_join,
    'current_question', v_current,
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
$function$;

-- A grid game can be started empty and filled by hand, like a quiz: the app
-- may say which kind of game it is making.
grant insert (kind) on public.games to authenticated;
