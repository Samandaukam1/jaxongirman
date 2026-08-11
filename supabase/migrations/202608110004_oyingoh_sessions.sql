-- O‘yingoh session lifecycle: pairing, joining, the state machine, answers.
--
-- Everything a client may do to a live match is one of the RPCs below. The
-- server owns the clock (phase_deadline), the verdict (game_grade_answer runs
-- here, never on a phone), the score (base + speed bonus computed from now()),
-- and the state machine (game_session_advance rejects impossible moves).
--
-- The pairing story is the presentation one, reused shape for shape: an
-- unclaimed screen shows a rotating single-use code; the phone that claims it
-- becomes the only device that can drive the match.

-- ------------------------------------------------------------------ pairing --
create table public.game_pairing_tokens (
  token text primary key,
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint game_pairing_tokens_shape check (token ~ '^[A-Za-z0-9_-]{32,64}$')
);

create index game_pairing_tokens_session_idx on public.game_pairing_tokens (session_id, created_at desc);
create index game_pairing_tokens_live_idx on public.game_pairing_tokens (expires_at) where consumed_at is null;

alter table public.game_pairing_tokens enable row level security;
-- Tokens are never read by a client; claiming is a definer RPC. No policies.
revoke all on public.game_pairing_tokens from anon, authenticated;
grant select on public.game_pairing_tokens to service_role;

-- ------------------------------------------------------------------ helpers --
/**
 * May this person put this game in front of a room?
 *
 * Their own game (ready), or a free one. The marketplace migration widens this
 * with purchased entitlements; nothing else in the module needs to change when
 * it does.
 */
create or replace function public.game_can_host(p_game_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.games g
    where g.id = p_game_id
      and g.status = 'ready'::public.game_status
      and (g.owner_id = p_user_id or g.is_free)
  );
$$;

/**
 * Text the grader can compare. Lowercase, outer and doubled spaces gone, and
 * every apostrophe variant folded to one — o‘zbekcha matnda `o'` bilan `oʻ`
 * bir xil javob.
 */
create or replace function public.game_normalize_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(p_value, ''), 'ʻʼ''`´’‘“”«»', '''''''''''')),
    '\s+', ' ', 'g'
  ));
$$;

/** A fresh six-digit join code that no live session is using. */
create or replace function public.game_new_join_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_code text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_code := lpad((floor(random() * 1000000))::integer::text, 6, '0');
    exit when not exists (
      select 1 from public.game_sessions
      where join_code = v_code
        and status not in ('finished'::public.game_session_status,
                           'cancelled'::public.game_session_status,
                           'expired'::public.game_session_status)
    );
    if v_attempt > 25 then
      raise exception 'could not allocate a join code' using errcode = 'P0001';
    end if;
  end loop;
  return v_code;
end;
$$;

/**
 * The question as the room may see it. Everything that decides correctness is
 * stripped; option order is kept, but matching's right column is shuffled with
 * a per-session seed so every phone and the projector agree on the same
 * scrambled order without ever being told the pairs.
 */
create or replace function public.game_sanitized_question(
  p_question public.game_questions,
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_config jsonb := coalesce(p_question.config, '{}'::jsonb);
  v_public jsonb := '{}'::jsonb;
begin
  case p_question.type
    when 'single_choice', 'multiple_choice', 'image_quiz', 'poll' then
      v_public := jsonb_build_object('options', coalesce(v_config -> 'options', '[]'::jsonb));
    when 'true_false' then
      v_public := '{}'::jsonb;
    when 'ordering' then
      -- The items arrive shuffled: presenting them in the authored order would
      -- hand out the answer.
      select jsonb_build_object('items', coalesce(jsonb_agg(item order by md5(p_session_id::text || p_question.id::text || (item ->> 'id'))), '[]'::jsonb))
        into v_public
        from jsonb_array_elements(coalesce(v_config -> 'items', '[]'::jsonb)) as item;
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
$$;

/**
 * The verdict and the score, in one deterministic place.
 *
 * Speed pays: a correct answer earns base × (0.5 + 0.5 × remaining/limit), so
 * an instant answer is worth double a buzzer-beater. Questions with no key
 * (word_cloud, poll) return null correctness and zero points; open_answer
 * returns null and waits for the host.
 */
create or replace function public.game_grade_answer(
  p_question public.game_questions,
  p_payload jsonb,
  p_response_ms integer
)
returns table (is_correct boolean, score integer)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_config jsonb := coalesce(p_question.config, '{}'::jsonb);
  v_correct boolean;
  v_limit_ms integer := p_question.time_limit_seconds * 1000;
  v_x numeric;
  v_y numeric;
  v_region jsonb;
begin
  case p_question.type
    when 'single_choice', 'image_quiz' then
      v_correct := (p_payload ->> 'choice') is not distinct from (v_config ->> 'correct');
    when 'true_false' then
      v_correct := (p_payload ->> 'value')::boolean is not distinct from (v_config ->> 'correct')::boolean;
    when 'multiple_choice' then
      -- Set equality: everything ticked that should be, nothing that should not.
      v_correct := (
        select coalesce(
          (select array_agg(value order by value) from jsonb_array_elements_text(coalesce(p_payload -> 'choices', '[]'::jsonb)))
          is not distinct from
          (select array_agg(value order by value) from jsonb_array_elements_text(coalesce(v_config -> 'correct', '[]'::jsonb))),
          false
        )
      );
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
    when 'word_cloud', 'poll', 'open_answer' then
      return query select null::boolean, 0;
      return;
  end case;

  if coalesce(v_correct, false) and p_question.base_points > 0 then
    return query select true, greatest(
      round(p_question.base_points * (0.5 + 0.5 * greatest(v_limit_ms - p_response_ms, 0)::numeric / greatest(v_limit_ms, 1)))::integer,
      1
    );
  end if;
  return query select coalesce(v_correct, false), 0;
end;
$$;

/**
 * What the room answered, shaped for the result screen: option counts for
 * choice questions, word frequencies for the cloud, correct/incorrect split
 * everywhere a verdict exists.
 */
create or replace function public.game_question_stats(p_session_id uuid, p_question_index integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with answers as (
    select a.payload, a.is_correct
    from public.game_answers a
    where a.session_id = p_session_id and a.question_index = p_question_index
  )
  select jsonb_build_object(
    'answers', (select count(*) from answers),
    'correct', (select count(*) from answers where is_correct),
    'incorrect', (select count(*) from answers where is_correct = false),
    'pending', (select count(*) from answers where is_correct is null),
    'choices', coalesce((
      select jsonb_object_agg(choice, cnt) from (
        select coalesce(payload ->> 'choice', payload ->> 'value') as choice, count(*) as cnt
        from answers
        where coalesce(payload ->> 'choice', payload ->> 'value') is not null
        group by 1
      ) as counted
    ), '{}'::jsonb),
    'words', coalesce((
      select jsonb_object_agg(word, cnt) from (
        select public.game_normalize_text(payload ->> 'text') as word, count(*) as cnt
        from answers
        where nullif(public.game_normalize_text(payload ->> 'text'), '') is not null
        group by 1
        order by count(*) desc
        limit 40
      ) as clouded
    ), '{}'::jsonb)
  );
$$;

/** The scoreboard, best first. Team totals ride along when the mode is on. */
create or replace function public.game_leaderboard_rows(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ranked.id, 'nickname', ranked.nickname, 'avatar_id', ranked.avatar_id,
        'team', ranked.team, 'total_score', ranked.total_score,
        'correct_count', ranked.correct_count, 'rank', ranked.place
      ) order by ranked.place)
      from (
        select gp.*, rank() over (order by gp.total_score desc, gp.joined_at) as place
        from public.game_players gp
        where gp.session_id = p_session_id and gp.status <> 'kicked'
      ) as ranked
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('team', t.team, 'total_score', t.total, 'players', t.members) order by t.total desc)
      from (
        select gp.team, sum(gp.total_score)::integer as total, count(*)::integer as members
        from public.game_players gp
        where gp.session_id = p_session_id and gp.status <> 'kicked' and gp.team is not null
        group by gp.team
      ) as t
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------- opening --
/**
 * A projector opens an unclaimed match shell, exactly like a presentation
 * screen. The raw screen token and realtime token leave the database exactly
 * once, in this response.
 */
create or replace function public.game_screen_open()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_pairing text := public.presentation_new_token();
  v_screen text := public.presentation_new_token();
  v_realtime text := public.presentation_new_token();
  v_join text := public.presentation_new_token();
  v_expires timestamptz := now() + interval '45 seconds';
begin
  insert into public.game_sessions (screen_token_hash, realtime_token, join_token, join_code)
  values (
    encode(extensions.digest(v_screen, 'sha256'), 'hex'),
    v_realtime, v_join, public.game_new_join_code()
  )
  returning * into v_session;

  insert into public.game_pairing_tokens (token, session_id, expires_at)
  values (v_pairing, v_session.id, v_expires);

  return jsonb_build_object(
    'session_id', v_session.id,
    'token', v_pairing,
    'screen_token', v_screen,
    'realtime_token', v_realtime,
    'token_expires_at', v_expires,
    'expires_at', v_session.expires_at
  );
end;
$$;

/** Replaces the pairing code. The projector proves it holds the live one. */
create or replace function public.game_pairing_rotate(
  p_session_id uuid,
  p_current_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_token text;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if v_session.host_user_id is not null then
    raise exception 'session is no longer pairing' using errcode = '22023';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'session has expired' using errcode = '22023';
  end if;

  perform 1 from public.game_pairing_tokens
    where token = p_current_token and session_id = p_session_id
      and consumed_at is null and expires_at > now();
  if not found then
    raise exception 'the code being replaced is not the live one' using errcode = '42501';
  end if;

  update public.game_pairing_tokens
    set expires_at = now()
    where session_id = p_session_id and consumed_at is null and expires_at > now();

  v_token := public.presentation_new_token();
  insert into public.game_pairing_tokens (token, session_id, expires_at)
  values (v_token, p_session_id, now() + interval '45 seconds');

  return jsonb_build_object('token', v_token, 'token_expires_at', now() + interval '45 seconds');
end;
$$;

/**
 * The host's phone claims the projector. Single-statement consume, so two
 * phones scanning at once cannot both win. A game may be chosen now or in the
 * lobby, but only one the caller may host.
 */
create or replace function public.game_pairing_claim(
  p_token text,
  p_game_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_token public.game_pairing_tokens%rowtype;
  v_session public.game_sessions%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  update public.game_pairing_tokens
    set consumed_at = now(), consumed_by = v_user
    where token = p_token and consumed_at is null and expires_at > now()
    returning * into v_token;
  if not found then
    raise exception 'QR kod eskirgan. Ekrandagi yangi kodni skaner qiling.' using errcode = '22023';
  end if;

  select * into v_session from public.game_sessions where id = v_token.session_id for update;
  if not found or v_session.host_user_id is not null then
    raise exception 'Sessiya allaqachon ulangan yoki mavjud emas.' using errcode = '22023';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'Sessiya muddati tugagan.' using errcode = '22023';
  end if;

  if p_game_id is not null and not public.game_can_host(p_game_id, v_user) then
    raise exception 'O‘yin topilmadi yoki uni boshlash huquqingiz yo‘q.' using errcode = '42501';
  end if;

  update public.game_sessions set
    host_user_id = v_user,
    game_id = coalesce(p_game_id, game_id),
    state_version = state_version + 1
    where id = v_session.id
    returning * into v_session;

  return jsonb_build_object(
    'session_id', v_session.id,
    'game_id', v_session.game_id,
    'join_token', v_session.join_token,
    'join_code', v_session.join_code,
    'realtime_token', v_session.realtime_token
  );
end;
$$;

/**
 * A match without a projector: the host's phone is the screen. Same row, no
 * screen token, same lobby from here on.
 */
create or replace function public.game_session_create(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not public.game_can_host(p_game_id, v_user) then
    raise exception 'O‘yin topilmadi yoki uni boshlash huquqingiz yo‘q.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = v_user and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;

  insert into public.game_sessions (host_user_id, game_id, realtime_token, join_token, join_code)
  values (v_user, p_game_id, public.presentation_new_token(), public.presentation_new_token(), public.game_new_join_code())
  returning * into v_session;

  return jsonb_build_object(
    'session_id', v_session.id,
    'game_id', v_session.game_id,
    'join_token', v_session.join_token,
    'join_code', v_session.join_code,
    'realtime_token', v_session.realtime_token
  );
end;
$$;

/** The host, back after a dropped connection, recovers everything private. */
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
    'reward_plan', v_session.reward_plan,
    'reward_state', v_session.reward_state,
    'reward_reserved', v_session.reward_reserved,
    'player_count', v_session.player_count,
    'state_version', v_session.state_version
  );
end;
$$;

-- ------------------------------------------------------------- configuring --
/**
 * Lobby knobs: game choice, teams, phone visibility, sound, the reward plan.
 * Host only, lobby only — once the countdown starts the match is what it is.
 */
create or replace function public.game_session_configure(
  p_session_id uuid,
  p_game_id uuid default null,
  p_team_mode boolean default null,
  p_teams jsonb default null,
  p_show_on_phones boolean default null,
  p_sound_enabled boolean default null,
  p_reward_plan jsonb default null
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

  if p_teams is not null then
    if jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) > 8 then
      raise exception 'teams must be a list of at most 8 names' using errcode = '22023';
    end if;
    v_teams := p_teams;
  else
    v_teams := v_session.teams;
  end if;

  update public.game_sessions set
    game_id = v_session.game_id,
    team_mode = coalesce(p_team_mode, team_mode),
    teams = v_teams,
    show_on_phones = coalesce(p_show_on_phones, show_on_phones),
    sound_enabled = coalesce(p_sound_enabled, sound_enabled),
    reward_plan = case when p_reward_plan is null then reward_plan
                       else public.game_reward_plan_check(p_reward_plan) end,
    state_version = state_version + 1
    where id = p_session_id
    returning * into v_session;

  -- Re-deal teams whenever the mode or the names change.
  if v_session.team_mode and jsonb_array_length(v_session.teams) > 0 then
    with dealt as (
      select gp.id,
             (v_session.teams ->> ((row_number() over (order by gp.joined_at) - 1)
               % jsonb_array_length(v_session.teams))::integer) as team
      from public.game_players gp
      where gp.session_id = p_session_id and gp.status <> 'kicked'
    )
    update public.game_players gp set team = dealt.team
    from dealt where gp.id = dealt.id;
  elsif not v_session.team_mode then
    update public.game_players set team = null where session_id = p_session_id;
  end if;

  return public.game_host_state(p_session_id);
end;
$$;

-- ----------------------------------------------------------------- joining --
/**
 * A player enters the room. The unique (session_id, user_id) row makes this
 * reconnect-safe: scanning twice lands on the same player, with the newer
 * nickname and avatar.
 *
 * Joining after the start is allowed — a latecomer plays the remaining
 * questions — but reward_eligible stays false for them: the coin hold was
 * sized on the lobby.
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
  if v_session.host_user_id = v_user then
    raise exception 'Siz bu o‘yinning boshlovchisisiz.' using errcode = '22023';
  end if;

  if v_session.team_mode and jsonb_array_length(v_session.teams) > 0 then
    v_team := v_session.teams ->> (v_session.player_count % jsonb_array_length(v_session.teams));
  end if;

  insert into public.game_players (session_id, user_id, nickname, avatar_id, team, reward_eligible)
  values (
    v_session.id, v_user, v_nickname, p_avatar_id, v_team,
    v_session.status = 'lobby'::public.game_session_status
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

/**
 * What the universal landing page may say about a scanned link.
 *
 * Callable while signed out, because the browser that followed the QR has
 * nobody in it yet. It answers only what is already painted on the projector in
 * front of the reader — the game's name and the join code — plus whether the
 * match is still open. Holding the token is the authorisation: it is 32 bytes
 * of randomness that only reaches a phone by being photographed off the wall.
 *
 * Deliberately absent: the host, the session id, the reward plan, the roster.
 */
create or replace function public.game_join_info(p_join_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_title text := '';
begin
  select * into v_session from public.game_sessions where join_token = p_join_token;
  if not found then
    return null;
  end if;
  if v_session.game_id is not null then
    select coalesce(title, '') into v_title from public.games where id = v_session.game_id;
  end if;

  return jsonb_build_object(
    'join_code', v_session.join_code,
    'game_title', v_title,
    'open', v_session.status not in ('finished'::public.game_session_status,
                                     'cancelled'::public.game_session_status,
                                     'expired'::public.game_session_status)
            and v_session.expires_at > now()
  );
end;
$$;

/**
 * The fallback for a QR that will not scan: the six digits under it. Costs one
 * rate-limit unit per try so the code space cannot be walked.
 */
create or replace function public.game_join_by_code(
  p_code text,
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

  return public.game_join(v_token, p_nickname, p_avatar_id);
end;
$$;

-- ------------------------------------------------------------ state machine --
/** Internal: question phase → result phase, once. Caller holds the row lock. */
create or replace function public.game_to_result(p_session public.game_sessions)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.game_sessions set
    status = 'question_result'::public.game_session_status,
    phase_deadline = null,
    state_version = state_version + 1,
    last_advance_at = now()
    where id = p_session.id;
end;
$$;

/**
 * The host's one button. `next` walks the machine forward; `finish` ends the
 * match now and settles rewards; `cancel` abandons it and refunds the hold.
 *
 * lobby → countdown → question(0) → question_result → leaderboard →
 * question(1) → … → finished. Anything else is rejected here, which is what
 * makes "finished → question" impossible by construction.
 */
create or replace function public.game_session_advance(
  p_session_id uuid,
  p_action text default 'next'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------- answering --
/**
 * One answer, one verdict, zero trust in the phone's clock.
 *
 * The deadline check and the response time both come from the server clock
 * against question_started_at. The verdict is computed here and *not returned*:
 * the phone learns whether it was right when the host reveals the result, so a
 * fast thumb cannot broadcast the answer to the room.
 *
 * `on conflict do nothing` is the double-tap story: the first accepted answer
 * is the only one that ever exists.
 */
create or replace function public.game_submit_answer(
  p_session_id uuid,
  p_question_index integer,
  p_payload jsonb
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
$$;

-- ------------------------------------------------------------------- state --
/**
 * Everything a player's phone renders, in one call keyed off state_version.
 * During `question` the question arrives sanitised; during `question_result`
 * the correct answer, the explanation, the room's stats and the phone's own
 * verdict arrive together — that is the reveal.
 */
create or replace function public.game_player_state(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      v_state := v_state || jsonb_build_object('answered', v_answer.id is not null);

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
$$;

/**
 * The projector's read, authorised by the bearer screen token rather than a
 * sign-in. Serves the lobby (join code, players as they pop in), the live
 * question, the reveal with stats, and the podium — the whole show.
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
    'game_title', coalesce(v_game.title, ''),
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

-- ------------------------------------------------------------------ review --
/**
 * The host judges an open answer during the reveal. Deterministic points from
 * the recorded response time, applied exactly once per direction — flipping a
 * verdict adjusts the player's total by the difference.
 */
create or replace function public.game_host_review_answer(
  p_answer_id uuid,
  p_is_correct boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_answer public.game_answers%rowtype;
  v_session public.game_sessions%rowtype;
  v_question public.game_questions%rowtype;
  v_score integer := 0;
  v_delta integer;
begin
  select * into v_answer from public.game_answers where id = p_answer_id for update;
  if not found then raise exception 'answer not found' using errcode = 'P0002'; end if;
  select * into v_session from public.game_sessions where id = v_answer.session_id;
  if v_session.host_user_id is distinct from v_user then
    raise exception 'only the host may review answers' using errcode = '42501';
  end if;
  select * into v_question from public.game_questions where id = v_answer.question_id;
  if v_question.type <> 'open_answer'::public.game_question_type then
    raise exception 'only open answers are reviewed by hand' using errcode = '22023';
  end if;

  if p_is_correct then
    v_score := greatest(
      round(v_question.base_points * (0.5 + 0.5 * greatest(v_question.time_limit_seconds * 1000 - v_answer.response_ms, 0)::numeric
        / greatest(v_question.time_limit_seconds * 1000, 1)))::integer,
      1
    );
  end if;

  v_delta := v_score - v_answer.score_awarded;

  update public.game_answers set
    is_correct = p_is_correct,
    score_awarded = v_score,
    reviewed_by_host = true,
    ai_confidence = null
    where id = p_answer_id;

  update public.game_players set
    total_score = greatest(total_score + v_delta, 0),
    correct_count = greatest(correct_count
      + case when p_is_correct and coalesce(v_answer.is_correct, false) = false then 1
             when not p_is_correct and coalesce(v_answer.is_correct, false) then -1
             else 0 end, 0)
    where id = v_answer.player_id;

  update public.game_sessions set state_version = state_version + 1 where id = v_answer.session_id;

  return jsonb_build_object('is_correct', p_is_correct, 'score_awarded', v_score);
end;
$$;

-- ---------------------------------------------------------------- lifecycle --
/**
 * Owner lifecycle for the game itself. 'ready' is earned: a title, at least
 * one question, and every question structurally able to be graded.
 */
create or replace function public.game_set_status(
  p_game_id uuid,
  p_status public.game_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

/** O‘yingoh profile numbers: played, wins, podiums, coins won. */
create or replace function public.game_my_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'played', count(*),
    'wins', count(*) filter (where gp.rank = 1),
    'top3', count(*) filter (where gp.rank between 1 and 3),
    'average_score', coalesce(round(avg(gp.total_score)), 0),
    'coins_won', coalesce((
      select sum(ct.amount) from public.credit_transactions ct
      where ct.user_id = auth.uid() and ct.type = 'game_reward'
    ), 0)
  )
  from public.game_players gp
  join public.game_sessions gs on gs.id = gp.session_id
  where gp.user_id = auth.uid() and gs.status = 'finished'::public.game_session_status;
$$;

/** Sweeps matches past their window; refunds any hold they still carry. */
create or replace function public.purge_expired_game_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_session record;
begin
  delete from public.game_pairing_tokens where expires_at < now() - interval '1 hour';

  for v_session in
    select id from public.game_sessions
    where expires_at <= now()
      and status not in ('finished'::public.game_session_status,
                         'cancelled'::public.game_session_status,
                         'expired'::public.game_session_status)
  loop
    perform public.game_rewards_refund(v_session.id);
    update public.game_sessions set
      status = 'expired'::public.game_session_status,
      state_version = state_version + 1
      where id = v_session.id;
    v_count := v_count + 1;
  end loop;

  delete from public.game_sessions
    where expires_at < now() - interval '7 days'
      and reward_state in ('none', 'settled', 'refunded');
  return v_count;
end;
$$;

-- ------------------------------------------------------------------ grants --
do $$
declare v_signature text;
begin
  -- The projector is signed out: opening, rotating and reading its own match
  -- through the bearer token are the only things `anon` can reach.
  foreach v_signature in array array[
    'public.game_screen_open()',
    'public.game_pairing_rotate(uuid, text)',
    'public.game_screen_snapshot(uuid, text)',
    -- The universal landing page runs in a browser with nobody signed in.
    'public.game_join_info(text)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('grant execute on function %s to anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;

  foreach v_signature in array array[
    'public.game_pairing_claim(text, uuid)',
    'public.game_session_create(uuid)',
    'public.game_host_state(uuid)',
    'public.game_session_configure(uuid, uuid, boolean, jsonb, boolean, boolean, jsonb)',
    'public.game_join(text, text, integer)',
    'public.game_join_by_code(text, text, integer)',
    'public.game_session_advance(uuid, text)',
    'public.game_submit_answer(uuid, integer, jsonb)',
    'public.game_player_state(uuid)',
    'public.game_host_review_answer(uuid, boolean)',
    'public.game_set_status(uuid, public.game_status)',
    'public.game_my_stats()',
    'public.game_can_host(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;

  -- Internal machinery: reachable by nobody but the definer context.
  foreach v_signature in array array[
    'public.game_new_join_code()',
    'public.game_normalize_text(text)',
    'public.game_sanitized_question(public.game_questions, uuid)',
    'public.game_grade_answer(public.game_questions, jsonb, integer)',
    'public.game_question_stats(uuid, integer)',
    'public.game_leaderboard_rows(uuid)',
    'public.game_to_result(public.game_sessions)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
  end loop;

  execute 'revoke all on function public.purge_expired_game_sessions() from public, anon, authenticated';
  execute 'grant execute on function public.purge_expired_game_sessions() to service_role';
end
$$;
