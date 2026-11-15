-- O‘yingoh: latecomers by the host's choice, teams the players choose, and the
-- answer on the host's phone.
--
-- * "O‘rtadan qo‘shilish": a new switch beside "Jamoaviy o‘yin" and "Savollar
--   telefonda ko‘rinsin". Off, nobody new can join once the countdown starts
--   (anyone already in may come back after a dropped connection); on,
--   latecomers join and play from the current question, and the board keeps a
--   small QR and the code in its corner. It starts on: latecomers were always
--   let in before 2.0, and a host on an older app has no switch to open the
--   door again — a default of off would lock their rooms for good.
-- * Teams: one to three, named by the host (default "1-jamoa", "2-jamoa", …).
--   A player picks a team when joining (`game_join_preview` shows the choice);
--   one who does not is put in the smallest team. Changing a setting no longer
--   re-deals everybody — a choice is kept, a renamed team keeps its players.
-- * The host's state carries the open question with its answer key.

alter table public.game_sessions
  add column if not exists allow_late_join boolean not null default true;

comment on column public.game_sessions.allow_late_join is
  'Whether players may join after the countdown (host''s "O‘rtadan qo‘shilish" switch).';

drop function if exists public.game_session_configure(uuid, uuid, boolean, jsonb, boolean, boolean, jsonb);
drop function if exists public.game_join_by_code(text, text, integer);
drop function if exists public.game_join(text, text, integer);

create or replace function public.game_session_configure(
  p_session_id uuid,
  p_game_id uuid default null,
  p_team_mode boolean default null,
  p_teams jsonb default null,
  p_show_on_phones boolean default null,
  p_sound_enabled boolean default null,
  p_reward_plan jsonb default null,
  p_allow_late_join boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_teams jsonb;
  v_old_teams jsonb;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found or v_session.host_user_id is distinct from v_user then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'lobby'::public.game_session_status then
    raise exception 'O‘yin boshlangandan keyin sozlamalarni o‘zgartirib bo‘lmaydi.' using errcode = '22023';
  end if;

  if p_game_id is not null then
    if not public.game_can_host(p_game_id, v_user) then
      raise exception 'O‘yin topilmadi yoki uni boshlash huquqingiz yo‘q.' using errcode = '42501';
    end if;
    v_session.game_id := p_game_id;
  end if;

  v_old_teams := v_session.teams;
  if p_teams is not null then
    -- One to three teams, each with a name of its own.
    if jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) > 3
       or exists (select 1 from jsonb_array_elements(p_teams) as name
                  where jsonb_typeof(name) <> 'string' or char_length(btrim(name #>> '{}')) not between 1 and 24)
       or (select count(distinct lower(btrim(name))) from jsonb_array_elements_text(p_teams) as name) <> jsonb_array_length(p_teams) then
      raise exception 'Jamoalar 1 tadan 3 tagacha bo‘lsin, har biri o‘z nomi bilan (24 belgigacha).' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(btrim(name) order by position), '[]'::jsonb) into v_teams
      from jsonb_array_elements_text(p_teams) with ordinality as entry(name, position);
  else
    v_teams := v_session.teams;
  end if;

  update public.game_sessions set
    game_id = v_session.game_id,
    team_mode = coalesce(p_team_mode, team_mode),
    teams = v_teams,
    show_on_phones = coalesce(p_show_on_phones, show_on_phones),
    sound_enabled = coalesce(p_sound_enabled, sound_enabled),
    allow_late_join = coalesce(p_allow_late_join, allow_late_join),
    reward_plan = case when p_reward_plan is null then reward_plan
                       else public.game_reward_plan_check(p_reward_plan) end,
    state_version = state_version + 1
    where id = p_session_id
    returning * into v_session;

  -- Players chose their teams, so a choice is kept: a renamed team carries its
  -- players to the new name (by place in the list), and only a player left
  -- without a team — a team removed, team mode just switched on — is dealt
  -- into the smallest one.
  if v_session.team_mode and jsonb_array_length(v_session.teams) > 0 then
    update public.game_players gp set team = v_session.teams ->> (renamed.position - 1)::integer
      from jsonb_array_elements_text(v_old_teams) with ordinality as renamed(name, position)
     where gp.session_id = p_session_id
       and gp.team = renamed.name
       and renamed.position <= jsonb_array_length(v_session.teams)
       and v_old_teams is distinct from v_session.teams;
    with homeless as (
      select gp.id, row_number() over (order by gp.joined_at) as n
        from public.game_players gp
       where gp.session_id = p_session_id and gp.status <> 'kicked'
         and (gp.team is null or not (v_session.teams ? gp.team))
    ),
    sizes as (
      select team.name, team.position,
             (select count(*) from public.game_players gp
               where gp.session_id = p_session_id and gp.status <> 'kicked' and gp.team = team.name) as members
        from jsonb_array_elements_text(v_session.teams) with ordinality as team(name, position)
    ),
    ordered as (
      select name, row_number() over (order by members, position) as slot, count(*) over () as total from sizes
    )
    update public.game_players gp set team = ordered.name
      from homeless, ordered
     where gp.id = homeless.id
       and ordered.slot = ((homeless.n - 1) % ordered.total) + 1;
  elsif not v_session.team_mode then
    update public.game_players set team = null where session_id = p_session_id;
  end if;

  return public.game_host_state(p_session_id);
end;
$$;

create or replace function public.game_join(
  p_join_token text,
  p_nickname text,
  p_avatar_id integer default 0,
  p_team text default null
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
  v_returning boolean;
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

  -- After the countdown only someone already in the room may come back —
  -- unless the host let latecomers in ("O‘rtadan qo‘shilish").
  v_returning := exists (select 1 from public.game_players
                          where session_id = v_session.id and user_id = v_user and status <> 'kicked');
  if v_session.status <> 'lobby'::public.game_session_status and not v_session.allow_late_join and not v_returning then
    raise exception 'O‘yin boshlanib ketgan. Mezbon o‘rtadan qo‘shilishga ruxsat bermagan.'
      using errcode = '22023', detail = 'late_join_closed';
  end if;

  -- The player's own team when they chose one the host offers; otherwise the
  -- smallest team, so the room stays even.
  if v_session.team_mode and jsonb_array_length(v_session.teams) > 0 then
    if p_team is not null and v_session.teams ? btrim(p_team) then
      v_team := btrim(p_team);
    else
      select team.name into v_team
        from jsonb_array_elements_text(v_session.teams) with ordinality as team(name, position)
       order by (select count(*) from public.game_players gp
                  where gp.session_id = v_session.id and gp.status <> 'kicked' and gp.team = team.name),
                team.position
       limit 1;
    end if;
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
    -- Coming back keeps the team, unless a team was chosen again in the lobby.
    team = case when p_team is not null and excluded.team is not null
                     and v_session.status = 'lobby'::public.game_session_status
                then excluded.team else game_players.team end,
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

create or replace function public.game_join_by_code(
  p_code text,
  p_nickname text,
  p_avatar_id integer default 0,
  p_team text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_key text;
  v_count integer;
  v_token text;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  -- Ten guesses a minute per account. A person mistyping recovers instantly; a
  -- script walking codes does not.
  v_key := 'game-join-code:' || v_user;
  insert into public.api_rate_limits as limits (key, window_started_at, request_count)
  values (v_key, now(), 1)
  on conflict (key) do update set
    request_count = case when limits.window_started_at < now() - interval '1 minute' then 1
                         else limits.request_count + 1 end,
    window_started_at = case when limits.window_started_at < now() - interval '1 minute' then now()
                             else limits.window_started_at end,
    updated_at = now()
  returning request_count into v_count;
  if v_count > 10 then
    raise exception 'Juda ko‘p urinish. Bir daqiqadan so‘ng qayta urinib ko‘ring.' using errcode = '54000';
  end if;

  select join_token into v_token from public.game_sessions
    where join_code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g')
      and status not in ('finished'::public.game_session_status,
                         'cancelled'::public.game_session_status,
                         'expired'::public.game_session_status)
      and expires_at > now();
  if v_token is null then
    raise exception 'Bunday kodli o‘yin topilmadi.' using errcode = 'P0002';
  end if;

  return public.game_join(v_token, p_nickname, p_avatar_id, p_team);
end;
$$;

/**
 * What a player is about to join: whether it takes latecomers and which teams
 * it offers, so the join screen can ask "which team?" before joining. By the
 * QR's token, or by the typed code — which counts against the same ten tries
 * a minute as joining by code does.
 */
create or replace function public.game_join_preview(p_join_token text default null, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_key text;
  v_count integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_join_token is not null then
    select * into v_session from public.game_sessions where join_token = p_join_token;
  else
    v_key := 'game-join-code:' || v_user;
    insert into public.api_rate_limits as limits (key, window_started_at, request_count)
    values (v_key, now(), 1)
    on conflict (key) do update set
      request_count = case when limits.window_started_at < now() - interval '1 minute' then 1
                           else limits.request_count + 1 end,
      window_started_at = case when limits.window_started_at < now() - interval '1 minute' then now()
                               else limits.window_started_at end,
      updated_at = now()
    returning request_count into v_count;
    if v_count > 10 then
      raise exception 'Juda ko‘p urinish. Bir daqiqadan so‘ng qayta urinib ko‘ring.' using errcode = '54000';
    end if;
    select * into v_session from public.game_sessions
      where join_code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  end if;
  if not found or v_session.status in ('finished'::public.game_session_status,
                                       'cancelled'::public.game_session_status,
                                       'expired'::public.game_session_status)
     or v_session.expires_at <= now() then
    raise exception 'Bunday kodli o‘yin topilmadi.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'status', v_session.status,
    'team_mode', v_session.team_mode,
    'teams', case when v_session.team_mode then v_session.teams else '[]'::jsonb end,
    'allow_late_join', v_session.allow_late_join,
    'joinable', v_session.status = 'lobby'::public.game_session_status or v_session.allow_late_join
      or exists (select 1 from public.game_players where session_id = v_session.id and user_id = v_user and status <> 'kicked')
  );
end;
$$;

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
       and a.question_index = v_session.current_index;
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
    end if;
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
$$;

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

revoke all on function public.game_session_configure(uuid, uuid, boolean, jsonb, boolean, boolean, jsonb, boolean) from public, anon;
grant execute on function public.game_session_configure(uuid, uuid, boolean, jsonb, boolean, boolean, jsonb, boolean) to authenticated, service_role;
revoke all on function public.game_join(text, text, integer, text) from public, anon;
grant execute on function public.game_join(text, text, integer, text) to authenticated, service_role;
revoke all on function public.game_join_by_code(text, text, integer, text) from public, anon;
grant execute on function public.game_join_by_code(text, text, integer, text) to authenticated, service_role;
revoke all on function public.game_join_preview(text, text) from public, anon;
grant execute on function public.game_join_preview(text, text) to authenticated, service_role;
