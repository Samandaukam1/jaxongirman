begin;

create extension if not exists pgtap with schema extensions;
select plan(50);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aa110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'gamehost@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Game Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bb220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'gameplayer@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Player"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc330000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'stranger@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Stranger"}', now(), now());

-- The host's quiz: one question whose config carries the correct answer — the
-- exact thing a player must never be able to read while the match runs.
insert into public.games (id, owner_id, title, status, question_count)
values ('dd440000-0000-0000-0000-000000000004', 'aa110000-0000-0000-0000-000000000001', 'RLS sinov o‘yini', 'draft', 0);

insert into public.game_questions (id, game_id, owner_id, position, type, prompt, config)
values (
  'ee550000-0000-0000-0000-000000000005', 'dd440000-0000-0000-0000-000000000004',
  'aa110000-0000-0000-0000-000000000001', 0, 'single_choice', 'Poytaxt qayer?',
  '{"options":[{"id":"a","text":"Toshkent"},{"id":"b","text":"Samarqand"}],"correct":"a"}'
);

update public.games set status = 'ready' where id = 'dd440000-0000-0000-0000-000000000004';

-- Give the host coins so a reward plan can reserve.
insert into public.credit_wallets (user_id, balance)
values ('aa110000-0000-0000-0000-000000000001', 1000)
on conflict (user_id) do update set balance = 1000;

-- ---------------------------------------------------------------- grants --
select ok(has_function_privilege('anon', 'public.game_screen_open()', 'EXECUTE'),
  'a signed-out projector can open a match shell');
select ok(has_function_privilege('anon', 'public.game_pairing_rotate(uuid, text)', 'EXECUTE'),
  'a signed-out projector can rotate its pairing code');
select ok(has_function_privilege('anon', 'public.game_screen_snapshot(uuid, text)', 'EXECUTE'),
  'a signed-out projector can read through its bearer capability');
select ok(not has_function_privilege('anon', 'public.game_pairing_claim(text, uuid)', 'EXECUTE'),
  'a signed-out caller cannot claim a match');
select ok(not has_function_privilege('anon', 'public.game_session_advance(uuid, text)', 'EXECUTE'),
  'a signed-out caller cannot drive a match');
select ok(not has_function_privilege('anon', 'public.game_submit_answer(uuid, integer, jsonb)', 'EXECUTE'),
  'a signed-out caller cannot answer');
select ok(not has_function_privilege('anon', 'public.game_join(text, text, integer)', 'EXECUTE'),
  'joining requires an account');
select ok(not has_table_privilege('authenticated', 'public.game_pairing_tokens', 'SELECT'),
  'pairing tokens are unreadable by any client');

-- The projector's column grant: state yes, secrets no.
select ok(not has_table_privilege('anon', 'public.game_sessions', 'SELECT'),
  'the projector is granted columns, not the table');
select ok(has_column_privilege('anon', 'public.game_sessions', 'current_index', 'SELECT'),
  'the projector can follow the question index');
select ok(not has_column_privilege('anon', 'public.game_sessions', 'join_token', 'SELECT'),
  'the join token is not selectable while signed out');
select ok(not has_column_privilege('anon', 'public.game_sessions', 'join_code', 'SELECT'),
  'the join code is not selectable while signed out');
select ok(not has_column_privilege('anon', 'public.game_sessions', 'realtime_token', 'SELECT'),
  'the private channel name is not selectable while signed out');
select ok(not has_column_privilege('anon', 'public.game_sessions', 'screen_token_hash', 'SELECT'),
  'the screen token digest is not selectable while signed out');
select ok(not has_column_privilege('anon', 'public.game_sessions', 'host_user_id', 'SELECT'),
  'the host identity is not selectable while signed out');

-- Players are signed in, and still never see the channel the host and the
-- projector share.
select ok(not has_column_privilege('authenticated', 'public.game_sessions', 'realtime_token', 'SELECT'),
  'a player cannot read the private broadcast channel name');
select ok(not has_column_privilege('authenticated', 'public.game_sessions', 'screen_token_hash', 'SELECT'),
  'a player cannot read the screen token digest');

-- Answers and players move only through RPCs.
select ok(not has_table_privilege('authenticated', 'public.game_answers', 'INSERT'),
  'answers cannot be inserted directly');
select ok(not has_table_privilege('authenticated', 'public.game_answers', 'UPDATE'),
  'answers cannot be updated directly');
select ok(not has_table_privilege('authenticated', 'public.game_players', 'INSERT'),
  'players cannot be inserted directly');
select ok(not has_table_privilege('authenticated', 'public.game_players', 'UPDATE'),
  'scores cannot be written directly');
select ok(not has_table_privilege('authenticated', 'public.game_sessions', 'INSERT'),
  'sessions cannot be created directly');
select ok(not has_table_privilege('authenticated', 'public.game_sessions', 'UPDATE'),
  'sessions cannot be driven directly');

-- Curation stays with the server: the owner may retitle a game but not put it
-- on everyone's home screen.
select ok(not has_column_privilege('authenticated', 'public.games', 'is_free', 'UPDATE'),
  'nobody promotes their own game to free');
select ok(not has_column_privilege('authenticated', 'public.games', 'featured_at', 'UPDATE'),
  'nobody features their own game');
select ok(not has_column_privilege('authenticated', 'public.games', 'status', 'UPDATE'),
  'lifecycle status moves only through game_set_status');
select ok(has_column_privilege('authenticated', 'public.games', 'title', 'UPDATE'),
  'the owner still edits their own content');

-- ------------------------------------------------- the flow, as the host --
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa110000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table t_session as
  select public.game_session_create('dd440000-0000-0000-0000-000000000004') as payload;

select ok((select payload ->> 'join_token' from t_session) ~ '^[A-Za-z0-9_-]{32,64}$',
  'the join token is opaque and URL-safe');
select ok((select payload ->> 'join_code' from t_session) ~ '^[0-9]{6}$',
  'the join code is six digits');
select ok((select payload ->> 'join_token' from t_session) !~ '[0-9a-f]{8}-[0-9a-f]{4}',
  'the join QR carries no database id');

-- A reward plan beyond the balance is rejected before the match can start.
select is(
  (select (public.game_session_configure(
    (select (payload ->> 'session_id')::uuid from t_session),
    p_reward_plan => '{"first": 900, "participant": 10}'::jsonb
  )) -> 'reward_plan' ->> 'first'),
  '900', 'the host may configure a plan while in the lobby'
);

-- --------------------------------------------------- the flow, as a player --
select set_config('request.jwt.claim.sub', 'bb220000-0000-0000-0000-000000000002', true);

create temporary table t_join as
  select public.game_join((select payload ->> 'join_token' from t_session), 'Jahongir', 3) as payload;

select is((select payload ->> 'nickname' from t_join), 'Jahongir', 'a player joins with a nickname');
select is(
  (select count(*)::integer from public.game_players
   where session_id = (select (payload ->> 'session_id')::uuid from t_session)),
  1, 'the join created one player row'
);

-- Joining twice lands on the same row: the reconnect story.
select is(
  (select (public.game_join((select payload ->> 'join_token' from t_session), 'Jahongir 2', 5)) ->> 'player_id'),
  (select payload ->> 'player_id' from t_join),
  'scanning again reconnects the same player'
);

-- The correct answer is invisible to the player, by table and by RPC.
select is(
  (select count(*)::integer from public.game_questions
   where id = 'ee550000-0000-0000-0000-000000000005'),
  0, 'a player cannot select the question table at all'
);

-- The stranger sees nothing of a private game.
select set_config('request.jwt.claim.sub', 'cc330000-0000-0000-0000-000000000003', true);
select is(
  (select count(*)::integer from public.games where id = 'dd440000-0000-0000-0000-000000000004'),
  0, 'a stranger cannot see a private game'
);
select is(
  (select count(*)::integer from public.game_players
   where session_id = (select (payload ->> 'session_id')::uuid from t_session)),
  0, 'a stranger cannot see who is in the room'
);

-- ----------------------------------------------- start, answer, protect --
select set_config('request.jwt.claim.sub', 'aa110000-0000-0000-0000-000000000001', true);

-- A plan the wallet cannot cover refuses to start the match — "balans
-- yetmaydi" happens before the first question or never.
select ok(
  (select (public.game_session_configure(
    (select (payload ->> 'session_id')::uuid from t_session),
    p_reward_plan => '{"first": 995, "participant": 10}'::jsonb
  )) is not null),
  'an over-balance plan may be written in the lobby'
);
select throws_ok(
  format('select public.game_session_advance(%L::uuid, %L)',
    (select payload ->> 'session_id' from t_session), 'next'),
  'P0001', null,
  'a plan beyond the balance refuses to start'
);
select ok(
  (select (public.game_session_configure(
    (select (payload ->> 'session_id')::uuid from t_session),
    p_reward_plan => '{"first": 900, "participant": 10}'::jsonb
  )) is not null),
  'the host reduces the plan to what the wallet covers'
);

select is(
  (select (public.game_session_advance((select (payload ->> 'session_id')::uuid from t_session), 'next')) ->> 'status'),
  'countdown', 'the host starts the match'
);
select is(
  (select (public.game_session_advance((select (payload ->> 'session_id')::uuid from t_session), 'next')) ->> 'status'),
  'question', 'countdown yields to the first question'
);

-- The reward hold was taken when the match started: 900 + 10 × 1 player = 910.
select is(
  (select reserved from public.credit_wallets where user_id = 'aa110000-0000-0000-0000-000000000001'),
  910, 'the reward hold covers the worst case before the first question'
);

select set_config('request.jwt.claim.sub', 'bb220000-0000-0000-0000-000000000002', true);

-- The sanitised state carries the options and never the answer key.
select ok(
  (select (public.game_player_state((select (payload ->> 'session_id')::uuid from t_session))) -> 'question' -> 'config' ->> 'correct') is null,
  'the live question reaches the player without its answer'
);

create temporary table t_answer as
  select public.game_submit_answer(
    (select (payload ->> 'session_id')::uuid from t_session), 0, '{"choice": "a"}'::jsonb
  ) as payload;

select is((select payload ->> 'accepted' from t_answer), 'true', 'an answer is accepted');
select ok(
  (select payload -> 'is_correct' from t_answer) is null,
  'the verdict is not returned at submit time'
);

-- The double tap: same idempotent acceptance, still one row.
select is(
  (select (public.game_submit_answer(
    (select (payload ->> 'session_id')::uuid from t_session), 0, '{"choice": "b"}'::jsonb
  )) ->> 'locked'),
  'true', 'a second submit is a no-op'
);
select is(
  (select count(*)::integer from public.game_answers
   where session_id = (select (payload ->> 'session_id')::uuid from t_session)),
  1, 'one player, one question, one answer'
);

-- The single player answering closed the question; scoring was server-side.
select is(
  (select (public.game_player_state((select (payload ->> 'session_id')::uuid from t_session))) ->> 'status'),
  'question_result', 'the room answering in full closes the question'
);
select ok(
  (select total_score from public.game_players
   where user_id = 'bb220000-0000-0000-0000-000000000002') > 0,
  'a correct answer scored on the server'
);

select finish();
rollback;
