-- Crosswords (Jaxongirman.app 2.0, §5.1).
--
-- A crossword is an O‘yingoh game of kind 'crossword' with one question of type
-- 'crossword' whose config is the grid: {width, height, words: [{id, number,
-- direction, row, col, length, clue, answer}]} (packages/types/src/crossword.ts).
-- Being a game, it is hosted on the board, joined by QR or code, played in
-- teams and ranked like any other; only answering and grading are its own:
--
-- * a player sends the words they have filled in, again and again, as
--   `{words: {"3a": "KITOB"}, done}`; each send regrades the grid and moves
--   their score by the difference, so the board's ranking is live;
-- * the grid is closed for a player when they say they are done or when every
--   word is right, and for the room when everyone is done or the time is up;
-- * players are never sent the answers (`game_sanitized_question`), only
--   which of their own words are right.

alter table public.games add column if not exists kind text not null default 'quiz';
alter table public.games drop constraint if exists games_kind;
alter table public.games add constraint games_kind check (kind in ('quiz', 'crossword'));
comment on column public.games.kind is 'quiz: O‘yingoh questions; crossword: one crossword question holding the grid.';

-- A crossword takes minutes, not seconds.
alter table public.game_questions drop constraint if exists game_questions_time;
alter table public.game_questions add constraint game_questions_time check (
  time_limit_seconds between 5 and 300
  or (type = 'crossword'::public.game_question_type and time_limit_seconds between 60 and 3600)
);

/** Who has how much of the grid, best first: what the board and the host show while it is being solved. */
create or replace function public.game_crossword_progress(p_session_id uuid, p_question_index integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'player_id', p.id, 'nickname', p.nickname, 'avatar_id', p.avatar_id, 'team', p.team,
      'solved', coalesce((a.payload ->> 'solved')::integer, 0),
      'done', coalesce((a.payload ->> 'done')::boolean, false),
      'score', coalesce(a.score_awarded, 0)
    ) order by coalesce((a.payload ->> 'solved')::integer, 0) desc, coalesce(a.response_ms, 2147483647), p.joined_at), '[]'::jsonb)
  from public.game_players p
  left join public.game_answers a
    on a.session_id = p.session_id and a.player_id = p.id and a.question_index = p_question_index
  where p.session_id = p_session_id and p.status <> 'kicked';
$$;
revoke all on function public.game_crossword_progress(uuid, integer) from public, anon, authenticated;

/**
 * One player's grid, sent again: regraded, stored, and their score moved by
 * the difference. Called by game_submit_answer once it has checked who is
 * asking; not callable on its own.
 */
create or replace function public.game_crossword_submit(
  p_session public.game_sessions,
  p_player public.game_players,
  p_question_index integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := p_session;
  v_question public.game_questions%rowtype;
  v_before public.game_answers%rowtype;
  v_words jsonb := case when jsonb_typeof(p_payload -> 'words') = 'object' then p_payload -> 'words' else '{}'::jsonb end;
  v_response_ms integer;
  v_verdict record;
  v_solved jsonb;
  v_done boolean;
  v_stored jsonb;
  v_active integer;
  v_finished integer;
begin
  if v_session.status <> 'question'::public.game_session_status
     or v_session.current_index <> p_question_index then
    raise exception 'Bu savol yopilgan.' using errcode = '22023';
  end if;
  if v_session.phase_deadline is null or now() > v_session.phase_deadline + interval '1500 milliseconds' then
    raise exception 'Vaqt tugadi.' using errcode = '22023';
  end if;

  select * into v_question from public.game_questions
    where id = v_session.question_ids[v_session.current_index + 1];
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;

  select * into v_before from public.game_answers
    where session_id = v_session.id and player_id = p_player.id and question_id = v_question.id
    for update;
  -- A finished grid stays as it was finished.
  if v_before.id is not null and coalesce((v_before.payload ->> 'done')::boolean, false) then
    return jsonb_build_object('accepted', true, 'locked', true);
  end if;

  v_response_ms := least(
    greatest((extract(epoch from (now() - v_session.question_started_at)) * 1000)::integer, 0),
    v_question.time_limit_seconds * 1000
  );
  select * into v_verdict from public.game_grade_answer(v_question, jsonb_build_object('words', v_words), v_response_ms);

  select coalesce(jsonb_agg(word ->> 'id' order by ordinality), '[]'::jsonb) into v_solved
    from jsonb_array_elements(coalesce(v_question.config -> 'words', '[]'::jsonb)) with ordinality as listed(word, ordinality)
   where (v_words ->> (word ->> 'id')) is not distinct from (word ->> 'answer');

  v_done := coalesce((p_payload ->> 'done')::boolean, false) or v_verdict.is_correct;
  v_stored := jsonb_build_object('words', v_words, 'done', v_done, 'solved', jsonb_array_length(v_solved), 'solved_ids', v_solved);

  if v_before.id is null then
    insert into public.game_answers (
      session_id, player_id, question_id, question_index, payload, response_ms, is_correct, score_awarded
    ) values (
      v_session.id, p_player.id, v_question.id, p_question_index, v_stored, v_response_ms, v_verdict.is_correct, v_verdict.score
    );
  else
    update public.game_answers set
      payload = v_stored, response_ms = v_response_ms, is_correct = v_verdict.is_correct,
      score_awarded = v_verdict.score, submitted_at = now()
    where id = v_before.id;
  end if;

  update public.game_players set
    total_score = greatest(total_score + v_verdict.score - coalesce(v_before.score_awarded, 0), 0),
    correct_count = greatest(correct_count
      + case when v_verdict.is_correct then 1 else 0 end
      - case when coalesce(v_before.is_correct, false) then 1 else 0 end, 0),
    last_seen_at = now()
  where id = p_player.id;

  -- When every player in the room has finished, the grid closes.
  select count(*) into v_active from public.game_players
    where session_id = v_session.id and status in ('joined'::public.game_player_status,
                                                   'disconnected'::public.game_player_status);
  select count(*) into v_finished from public.game_answers
    where session_id = v_session.id and question_index = p_question_index and (payload ->> 'done')::boolean;
  -- The session row is left alone otherwise: every phone in the room follows
  -- it, and a send is not a new phase. The board and the host poll the race.
  if v_finished >= v_active then
    perform public.game_to_result(v_session);
  end if;

  return jsonb_build_object('accepted', true, 'locked', v_done,
    'solved_ids', v_solved, 'score', v_verdict.score);
end;
$$;
revoke all on function public.game_crossword_submit(public.game_sessions, public.game_players, integer, jsonb) from public, anon, authenticated;

create or replace function public.game_store_autopublish_arm()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- O‘yingoh quizzes go to the store on their own (while the switch is on); a
  -- crossword is its own product and stays with its owner unless they publish it.
  if not public.game_store_autopublish_enabled() or new.kind = 'crossword' then
    new.store_autopublish := 'off';
    new.store_autopublish_at := null;
    return new;
  end if;
  new.store_autopublish := 'pending';
  new.store_autopublish_at := now() + interval '1 hour';
  return new;
end;
$function$;

create or replace function public.game_grade_answer(p_question game_questions, p_payload jsonb, p_response_ms integer)
 RETURNS TABLE(is_correct boolean, score integer)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_config jsonb := coalesce(p_question.config, '{}'::jsonb);
  v_correct boolean;
  v_limit_ms integer := p_question.time_limit_seconds * 1000;
  v_x numeric;
  v_y numeric;
  v_region jsonb;
  -- multiple_choice only: the share of the points earned, 0..1.
  v_share numeric;
  v_keys integer;
  v_right integer;
  v_wrong integer;
begin
  case p_question.type
    when 'single_choice', 'image_quiz' then
      v_correct := (p_payload ->> 'choice') is not distinct from (v_config ->> 'correct');
    when 'true_false' then
      v_correct := (p_payload ->> 'value')::boolean is not distinct from (v_config ->> 'correct')::boolean;
    when 'multiple_choice' then
      -- Credit by the option: each right tick earns its share, each wrong tick
      -- takes one share back, never below nothing. Correct only when exact.
      select count(*) into v_keys
        from jsonb_array_elements_text(case when jsonb_typeof(v_config -> 'correct') = 'array' then v_config -> 'correct' else '[]'::jsonb end);
      select
        count(*) filter (where chosen.value in (
          select key from jsonb_array_elements_text(case when jsonb_typeof(v_config -> 'correct') = 'array' then v_config -> 'correct' else '[]'::jsonb end) as key
        )),
        count(*) filter (where chosen.value not in (
          select key from jsonb_array_elements_text(case when jsonb_typeof(v_config -> 'correct') = 'array' then v_config -> 'correct' else '[]'::jsonb end) as key
        ))
        into v_right, v_wrong
        from (
          select distinct value
          from jsonb_array_elements_text(case when jsonb_typeof(p_payload -> 'choices') = 'array' then p_payload -> 'choices' else '[]'::jsonb end)
        ) as chosen;
      v_correct := v_keys > 0 and v_right = v_keys and v_wrong = 0;
      v_share := case when v_keys > 0 then greatest(v_right - v_wrong, 0)::numeric / v_keys else 0 end;
    when 'ordering' then
      v_correct := coalesce(p_payload -> 'order', 'null'::jsonb) = coalesce(v_config -> 'order', '[]'::jsonb);
    when 'matching' then
      v_correct := coalesce(p_payload -> 'pairs', 'null'::jsonb) = coalesce(v_config -> 'pairs', '{}'::jsonb);
    when 'fill_blank' then
      v_correct := exists (
        select 1 from jsonb_array_elements_text(coalesce(v_config -> 'answers', '[]'::jsonb)) as accepted
        where public.game_normalize_text(accepted) = public.game_normalize_text(p_payload ->> 'text')
      );
    when 'hotspot' then
      v_x := (p_payload ->> 'x')::numeric;
      v_y := (p_payload ->> 'y')::numeric;
      v_region := v_config -> 'region';
      if v_x is null or v_y is null or v_region is null then
        v_correct := false;
      elsif coalesce(v_config ->> 'shape', 'rect') = 'circle' then
        v_correct := sqrt(
          power(v_x - ((v_region ->> 'x')::numeric + (v_region ->> 'w')::numeric / 2), 2)
          + power(v_y - ((v_region ->> 'y')::numeric + (v_region ->> 'h')::numeric / 2), 2)
        ) <= (v_region ->> 'w')::numeric / 2;
      else
        v_correct := v_x between (v_region ->> 'x')::numeric and (v_region ->> 'x')::numeric + (v_region ->> 'w')::numeric
          and v_y between (v_region ->> 'y')::numeric and (v_region ->> 'y')::numeric + (v_region ->> 'h')::numeric;
      end if;
    when 'crossword' then
      -- Half the points are the words, shared out: each right word only ever
      -- adds. The other half is for the whole grid, by how much time was left
      -- when it was finished — so a word found late never costs points.
      select count(*) filter (where (p_payload -> 'words' ->> (word ->> 'id')) is not distinct from (word ->> 'answer')),
             count(*)
        into v_right, v_keys
        from jsonb_array_elements(case when jsonb_typeof(v_config -> 'words') = 'array' then v_config -> 'words' else '[]'::jsonb end) as word;
      v_correct := v_keys > 0 and v_right = v_keys;
      return query select v_correct, (
        round(p_question.base_points * 0.5 * case when v_keys > 0 then v_right::numeric / v_keys else 0 end)
        + case when v_correct then round(p_question.base_points * 0.5
            * greatest(v_limit_ms - p_response_ms, 0)::numeric / greatest(v_limit_ms, 1)) else 0 end
      )::integer;
      return;
    when 'word_cloud', 'poll', 'open_answer' then
      return query select null::boolean, 0;
      return;
  end case;

  if p_question.base_points > 0 and (coalesce(v_correct, false) or coalesce(v_share, 0) > 0) then
    return query select coalesce(v_correct, false), greatest(
      round(p_question.base_points * coalesce(v_share, 1)
        * (0.5 + 0.5 * greatest(v_limit_ms - p_response_ms, 0)::numeric / greatest(v_limit_ms, 1)))::integer,
      1
    );
    return;
  end if;
  return query select coalesce(v_correct, false), 0;
end;
$function$;

create or replace function public.game_sanitized_question(p_question game_questions, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_config jsonb := coalesce(p_question.config, '{}'::jsonb);
  v_public jsonb := '{}'::jsonb;
  v_items jsonb;
begin
  case p_question.type
    when 'single_choice', 'multiple_choice', 'image_quiz', 'poll' then
      v_public := jsonb_build_object('options', coalesce(v_config -> 'options', '[]'::jsonb));
    when 'true_false' then
      v_public := '{}'::jsonb;
    when 'ordering' then
      -- The items arrive shuffled: presenting them in the authored order would
      -- hand out the answer. A shuffle that lands on the answer anyway — one
      -- time in six with three items — is turned by one place.
      select coalesce(jsonb_agg(item order by md5(p_session_id::text || p_question.id::text || (item ->> 'id'))), '[]'::jsonb)
        into v_items
        from jsonb_array_elements(coalesce(v_config -> 'items', '[]'::jsonb)) as item;
      if jsonb_array_length(v_items) > 1
        and (select jsonb_agg(dealt.value ->> 'id' order by dealt.ordinality) from jsonb_array_elements(v_items) with ordinality as dealt)
          = coalesce(v_config -> 'order', '[]'::jsonb) then
        v_items := (v_items - 0) || jsonb_build_array(v_items -> 0);
      end if;
      v_public := jsonb_build_object('items', v_items);
    when 'matching' then
      select jsonb_build_object(
        'left', coalesce(v_config -> 'left', '[]'::jsonb),
        'right', coalesce((
          select jsonb_agg(item order by md5(p_session_id::text || p_question.id::text || (item ->> 'id')))
          from jsonb_array_elements(coalesce(v_config -> 'right', '[]'::jsonb)) as item
        ), '[]'::jsonb)
      ) into v_public;
    when 'fill_blank' then
      v_public := jsonb_build_object('kind', 'text');
    when 'word_cloud' then
      v_public := jsonb_build_object('max_length', 40);
    when 'open_answer' then
      v_public := jsonb_build_object('max_length', 300);
    when 'hotspot' then
      -- The image is the question; the region is the answer.
      v_public := '{}'::jsonb;
    when 'crossword' then
      -- The grid without its letters: where each word starts, which way it
      -- runs, how long it is and its clue.
      v_public := jsonb_build_object(
        -- The language, so the phone shows the keyboard of the grid's letters.
        'language', (select g.language from public.games g where g.id = p_question.game_id),
        'width', v_config -> 'width',
        'height', v_config -> 'height',
        'words', coalesce((
          select jsonb_agg(word - 'answer' order by ordinality)
          from jsonb_array_elements(coalesce(v_config -> 'words', '[]'::jsonb)) with ordinality as listed(word, ordinality)
        ), '[]'::jsonb)
      );
  end case;

  return jsonb_build_object(
    'id', p_question.id,
    'type', p_question.type,
    'prompt', p_question.prompt,
    'time_limit_seconds', p_question.time_limit_seconds,
    'base_points', p_question.base_points,
    'media_path', p_question.media_path,
    'config', v_public
  );
end;
$function$;

create or replace function public.game_submit_answer(p_session_id uuid, p_question_index integer, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_player public.game_players%rowtype;
  v_question public.game_questions%rowtype;
  v_response_ms integer;
  v_verdict record;
  v_answer public.game_answers%rowtype;
  v_active integer;
  v_answered integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'answer payload must be an object' using errcode = '22023';
  end if;
  if pg_column_size(p_payload) > 4096 then
    raise exception 'answer payload is too large' using errcode = '22023';
  end if;

  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;

  select * into v_player from public.game_players
    where session_id = p_session_id and user_id = v_user;
  if not found or v_player.status = 'kicked' then
    raise exception 'Siz bu o‘yinda emassiz.' using errcode = '42501';
  end if;

  -- A crossword is answered again and again as it is filled in, not once.
  if (select q.type from public.game_questions q where q.id = v_session.question_ids[p_question_index + 1])
       = 'crossword'::public.game_question_type then
    return public.game_crossword_submit(v_session, v_player, p_question_index, p_payload);
  end if;

  -- The double tap comes first: an answer that already exists is a quiet
  -- success even if the first tap was what closed the question.
  if exists (
    select 1 from public.game_answers
    where session_id = p_session_id and player_id = v_player.id and question_index = p_question_index
  ) then
    return jsonb_build_object('accepted', true, 'locked', true);
  end if;

  if v_session.status <> 'question'::public.game_session_status
     or v_session.current_index <> p_question_index then
    raise exception 'Bu savol yopilgan.' using errcode = '22023';
  end if;
  -- A small grace absorbs network latency; the recorded time is still real.
  if v_session.phase_deadline is null or now() > v_session.phase_deadline + interval '1500 milliseconds' then
    raise exception 'Vaqt tugadi.' using errcode = '22023';
  end if;

  select * into v_question from public.game_questions
    where id = v_session.question_ids[v_session.current_index + 1];
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;

  v_response_ms := least(
    greatest((extract(epoch from (now() - v_session.question_started_at)) * 1000)::integer, 0),
    v_question.time_limit_seconds * 1000
  );

  select * into v_verdict from public.game_grade_answer(v_question, p_payload, v_response_ms);

  insert into public.game_answers (
    session_id, player_id, question_id, question_index, payload,
    response_ms, is_correct, score_awarded
  ) values (
    p_session_id, v_player.id, v_question.id, p_question_index, p_payload,
    v_response_ms, v_verdict.is_correct, v_verdict.score
  )
  on conflict (session_id, player_id, question_id) do nothing
  returning * into v_answer;

  if v_answer.id is null then
    -- Already answered: idempotent accept, no verdict leak either way.
    return jsonb_build_object('accepted', true, 'locked', true);
  end if;

  if v_verdict.score > 0 then
    update public.game_players set
      total_score = total_score + v_verdict.score,
      correct_count = correct_count + 1,
      last_seen_at = now()
      where id = v_player.id;
  else
    update public.game_players set
      correct_count = correct_count + case when v_verdict.is_correct then 1 else 0 end,
      last_seen_at = now()
      where id = v_player.id;
  end if;

  -- When the whole room has answered, the question closes itself — nobody
  -- stares at a timer that no longer matters.
  select count(*) into v_active from public.game_players
    where session_id = p_session_id and status in ('joined'::public.game_player_status,
                                                   'disconnected'::public.game_player_status);
  select count(*) into v_answered from public.game_answers
    where session_id = p_session_id and question_index = p_question_index;
  if v_answered >= v_active then
    perform public.game_to_result(v_session);
  end if;

  return jsonb_build_object('accepted', true, 'locked', true);
end;
$function$;

create or replace function public.game_player_state(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_player public.game_players%rowtype;
  v_question public.game_questions%rowtype;
  v_state jsonb;
  v_answer public.game_answers%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_session from public.game_sessions where id = p_session_id;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  select * into v_player from public.game_players
    where session_id = p_session_id and user_id = v_user;
  if not found then raise exception 'Siz bu o‘yinda emassiz.' using errcode = '42501'; end if;

  v_state := jsonb_build_object(
    'status', v_session.status,
    'current_index', v_session.current_index,
    'question_count', coalesce(array_length(v_session.question_ids, 1),
                               (select count(*)::integer from public.game_questions q where q.game_id = v_session.game_id)),
    'phase_deadline', v_session.phase_deadline,
    'show_on_phones', v_session.show_on_phones,
    'team_mode', v_session.team_mode,
    'player_count', v_session.player_count,
    'state_version', v_session.state_version,
    'me', jsonb_build_object(
      'player_id', v_player.id, 'nickname', v_player.nickname, 'avatar_id', v_player.avatar_id,
      'team', v_player.team, 'total_score', v_player.total_score, 'rank', v_player.rank
    )
  );

  if v_session.status in ('question'::public.game_session_status,
                          'question_result'::public.game_session_status)
     and v_session.current_index >= 0 then
    select * into v_question from public.game_questions
      where id = v_session.question_ids[v_session.current_index + 1];
    if found then
      v_state := v_state || jsonb_build_object('question', public.game_sanitized_question(v_question, p_session_id));
      select * into v_answer from public.game_answers
        where session_id = p_session_id and player_id = v_player.id and question_id = v_question.id;
      if v_question.type = 'crossword'::public.game_question_type then
        -- Where this player left the grid, so a phone that reopens picks it
        -- up; "answered" is having finished it.
        v_state := v_state || jsonb_build_object(
          'answered', coalesce((v_answer.payload ->> 'done')::boolean, false),
          'progress', jsonb_build_object(
            'words', coalesce(v_answer.payload -> 'words', '{}'::jsonb),
            'solved_ids', coalesce(v_answer.payload -> 'solved_ids', '[]'::jsonb),
            'score', coalesce(v_answer.score_awarded, 0)
          )
        );
      else
        v_state := v_state || jsonb_build_object('answered', v_answer.id is not null);
      end if;

      if v_session.status = 'question_result'::public.game_session_status then
        v_state := v_state || jsonb_build_object(
          'reveal', jsonb_build_object(
            'config', v_question.config,
            'explanation', v_question.explanation,
            'stats', public.game_question_stats(p_session_id, v_session.current_index),
            'my_answer', case when v_answer.id is null then null else jsonb_build_object(
              'is_correct', v_answer.is_correct,
              'score_awarded', v_answer.score_awarded,
              'response_ms', v_answer.response_ms
            ) end
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

create or replace function public.game_set_status(p_game_id uuid, p_status game_status)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_game public.games%rowtype;
  v_question public.game_questions%rowtype;
  v_problem text;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.owner_id is distinct from v_user then
    raise exception 'game not found' using errcode = 'P0002';
  end if;
  if p_status not in ('draft'::public.game_status, 'ready'::public.game_status, 'archived'::public.game_status) then
    raise exception 'status must be draft, ready or archived' using errcode = '22023';
  end if;

  if p_status = 'ready'::public.game_status then
    if char_length(btrim(v_game.title)) < 1 then
      raise exception 'O‘yinga nom bering.' using errcode = '22023';
    end if;
    if v_game.question_count < 1 then
      raise exception 'Kamida bitta savol qo‘shing.' using errcode = '22023';
    end if;
    for v_question in select * from public.game_questions where game_id = p_game_id loop
      v_problem := case
        when char_length(btrim(v_question.prompt)) < 1 then 'savol matni bo‘sh'
        when v_question.type in ('single_choice'::public.game_question_type, 'image_quiz'::public.game_question_type)
          and (jsonb_array_length(coalesce(v_question.config -> 'options', '[]'::jsonb)) < 2
               or nullif(v_question.config ->> 'correct', '') is null) then 'variantlar yoki to‘g‘ri javob yo‘q'
        when v_question.type = 'true_false'::public.game_question_type
          and (v_question.config ->> 'correct') is null then 'to‘g‘ri javob belgilanmagan'
        when v_question.type = 'multiple_choice'::public.game_question_type
          and (jsonb_array_length(coalesce(v_question.config -> 'options', '[]'::jsonb)) < 2
               or jsonb_array_length(coalesce(v_question.config -> 'correct', '[]'::jsonb)) < 1) then 'variantlar yoki to‘g‘ri javoblar yo‘q'
        when v_question.type = 'ordering'::public.game_question_type
          and jsonb_array_length(coalesce(v_question.config -> 'order', '[]'::jsonb)) < 2 then 'tartib elementlari yetarli emas'
        when v_question.type = 'matching'::public.game_question_type
          and (select count(*) from jsonb_object_keys(coalesce(v_question.config -> 'pairs', '{}'::jsonb))) < 2 then 'juftliklar yetarli emas'
        when v_question.type = 'fill_blank'::public.game_question_type
          and jsonb_array_length(coalesce(v_question.config -> 'answers', '[]'::jsonb)) < 1 then 'qabul qilinadigan javoblar yo‘q'
        when v_question.type = 'poll'::public.game_question_type
          and jsonb_array_length(coalesce(v_question.config -> 'options', '[]'::jsonb)) < 2 then 'ovoz variantlari yetarli emas'
        when v_question.type = 'hotspot'::public.game_question_type
          and (v_question.media_path is null or v_question.config -> 'region' is null) then 'rasm yoki zona belgilanmagan'
        when v_question.type = 'image_quiz'::public.game_question_type
          and v_question.media_path is null then 'rasm yuklanmagan'
        when v_question.type = 'crossword'::public.game_question_type
          and jsonb_array_length(coalesce(v_question.config -> 'words', '[]'::jsonb)) < 2 then 'krossvordda so‘zlar yetarli emas'
        else null
      end;
      if v_problem is not null then
        raise exception '%-savol tayyor emas: %', v_question.position + 1, v_problem using errcode = '22023';
      end if;
    end loop;
  end if;

  update public.games set status = p_status where id = p_game_id returning * into v_game;
  return jsonb_build_object('id', v_game.id, 'status', v_game.status, 'question_count', v_game.question_count);
end;
$function$;
