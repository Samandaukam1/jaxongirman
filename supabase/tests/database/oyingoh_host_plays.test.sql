begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

-- A match hosted from a laptop, with the host's own phone in it.
--
-- The host plays and scores like anybody, never draws on their own reward
-- hold, and reads the big screen of their own match by being its host. The
-- projector's screen-token door is unchanged.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1a10000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated',
   'laptophost@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Laptop Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2b20000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated',
   'roomplayer@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Room Player"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3c30000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated',
   'outsider@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Outsider"}', now(), now());

insert into public.games (id, owner_id, title, status, question_count)
values ('d4d40000-0000-0000-0000-00000000000d', 'a1a10000-0000-0000-0000-00000000000a', 'Noutbuk o‘yini', 'draft', 0);

insert into public.game_questions (id, game_id, owner_id, position, type, prompt, config)
values (
  'e5e50000-0000-0000-0000-00000000000e', 'd4d40000-0000-0000-0000-00000000000d',
  'a1a10000-0000-0000-0000-00000000000a', 0, 'single_choice', 'Poytaxt qayer?',
  '{"options":[{"id":"a","text":"Toshkent"},{"id":"b","text":"Samarqand"}],"correct":"a"}'
);

update public.games set status = 'ready' where id = 'd4d40000-0000-0000-0000-00000000000d';

insert into public.credit_wallets (user_id, balance)
values ('a1a10000-0000-0000-0000-00000000000a', 1000)
on conflict (user_id) do update set balance = 1000, reserved = 0;

-- ---------------------------------------------------------------- grants --
select ok(not has_function_privilege('anon', 'public.game_host_screen(uuid)', 'EXECUTE'),
  'a signed-out browser cannot read a host screen');
select ok(has_function_privilege('authenticated', 'public.game_host_screen(uuid)', 'EXECUTE'),
  'a signed-in host can ask for their own screen');
select ok(not has_function_privilege('authenticated', 'public.game_screen_state(uuid)', 'EXECUTE'),
  'the shared screen view has no door of its own for a client');
select ok(not has_function_privilege('anon', 'public.game_screen_state(uuid)', 'EXECUTE'),
  'nor for a signed-out one');

-- ------------------------------------------------- the host opens a match --
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1a10000-0000-0000-0000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table t_session as
  select public.game_session_create('d4d40000-0000-0000-0000-00000000000d') as payload;

-- ------------------------------------ the host's own phone joins, same account --
create temporary table t_host_join as
  select public.game_join((select payload ->> 'join_token' from t_session), 'Mezbon', 1) as payload;

select is((select payload ->> 'session_id' from t_host_join), (select payload ->> 'session_id' from t_session),
  'the host joins their own match');
select is(
  (select reward_eligible from public.game_players
   where id = (select (payload ->> 'player_id')::uuid from t_host_join)),
  false, 'the host is never eligible for their own hold');
select is(
  (select (public.game_join_by_code((select payload ->> 'join_code' from t_session), 'Mezbon 2', 2)) ->> 'player_id'),
  (select payload ->> 'player_id' from t_host_join),
  'the six digits land the host on the same player row');

-- ------------------------------------------------------- a room player --
select set_config('request.jwt.claim.sub', 'b2b20000-0000-0000-0000-00000000000b', true);

create temporary table t_player_join as
  select public.game_join((select payload ->> 'join_token' from t_session), 'Talaba', 4) as payload;

select is(
  (select reward_eligible from public.game_players
   where id = (select (payload ->> 'player_id')::uuid from t_player_join)),
  true, 'a player in the lobby is eligible as before');
select throws_ok(
  format('select public.game_host_screen(%L::uuid)', (select payload ->> 'session_id' from t_session)),
  'P0002', null,
  'a player cannot read the host screen');

select set_config('request.jwt.claim.sub', 'c3c30000-0000-0000-0000-00000000000c', true);
select throws_ok(
  format('select public.game_host_screen(%L::uuid)', (select payload ->> 'session_id' from t_session)),
  'P0002', null,
  'nor can a stranger');

-- --------------------------------------------- the laptop is the big screen --
select set_config('request.jwt.claim.sub', 'a1a10000-0000-0000-0000-00000000000a', true);

select is(
  (select (public.game_host_screen((select (payload ->> 'session_id')::uuid from t_session))) ->> 'player_count'),
  '2', 'the host screen counts the host''s phone and the room');
select is(
  (select (public.game_host_screen((select (payload ->> 'session_id')::uuid from t_session))) ->> 'paired'),
  'true', 'a match opened on the laptop is never waiting for a phone to pair');
select is(
  (select (public.game_host_screen((select (payload ->> 'session_id')::uuid from t_session))) ->> 'join_token'),
  (select payload ->> 'join_token' from t_session),
  'the host screen carries the join token its QR is drawn from');

select ok(
  (select (public.game_session_configure(
    (select (payload ->> 'session_id')::uuid from t_session),
    p_reward_plan => '{"first": 100, "participant": 10}'::jsonb
  )) is not null),
  'the host sets a reward plan');
select is(
  (select (public.game_session_advance((select (payload ->> 'session_id')::uuid from t_session), 'next')) ->> 'status'),
  'countdown', 'the host starts the match with their own phone in it');

-- The hold is priced on the lobby as it stands: 100 + 10 × 2 players.
select is(
  (select reserved from public.credit_wallets where user_id = 'a1a10000-0000-0000-0000-00000000000a'),
  120, 'the hold covers every player in the lobby');

select is(
  (select (public.game_session_advance((select (payload ->> 'session_id')::uuid from t_session), 'next')) ->> 'status'),
  'question', 'the first question opens');
select ok(
  (select (public.game_host_screen((select (payload ->> 'session_id')::uuid from t_session))) -> 'question' -> 'config' ->> 'correct') is null,
  'the host screen shows the question without its answer, like the projector');

-- ------------------------------------------------------------- answering --
select is(
  (select (public.game_submit_answer(
    (select (payload ->> 'session_id')::uuid from t_session), 0, '{"choice": "a"}'::jsonb
  )) ->> 'accepted'),
  'true', 'the host''s phone answers as a player');

select set_config('request.jwt.claim.sub', 'b2b20000-0000-0000-0000-00000000000b', true);
create temporary table t_before as
  select balance from public.credit_wallets where user_id = 'b2b20000-0000-0000-0000-00000000000b';
select is(
  (select (public.game_submit_answer(
    (select (payload ->> 'session_id')::uuid from t_session), 0, '{"choice": "b"}'::jsonb
  )) ->> 'accepted'),
  'true', 'the room player answers too');

select set_config('request.jwt.claim.sub', 'a1a10000-0000-0000-0000-00000000000a', true);
select is(
  (select (public.game_player_state((select (payload ->> 'session_id')::uuid from t_session))) ->> 'status'),
  'question_result', 'the host''s phone follows the match through its own player state');
select is(
  (select (public.game_host_screen((select (payload ->> 'session_id')::uuid from t_session))) ->> 'status'),
  'question_result', 'everyone answering closes the question on the host screen too');

-- ---------------------------------------------------------------- podium --
select is(
  (select (public.game_session_advance((select (payload ->> 'session_id')::uuid from t_session), 'finish')) ->> 'status'),
  'finished', 'the host finishes the match');
select is(
  (select rank from public.game_players
   where id = (select (payload ->> 'player_id')::uuid from t_host_join)),
  1, 'the host''s score stands on the podium');
select is(
  (select count(*)::integer from public.credit_transactions
   where user_id = 'a1a10000-0000-0000-0000-00000000000a' and type = 'game_reward'),
  0, 'the host is never paid out of their own hold');
select is(
  (select reserved from public.credit_wallets where user_id = 'a1a10000-0000-0000-0000-00000000000a'),
  0, 'the hold is fully resolved');
select is(
  (select balance from public.credit_wallets where user_id = 'a1a10000-0000-0000-0000-00000000000a'),
  890, 'what was not paid out returns to the host');

-- A wallet is its owner's to read, so the prize is checked as the player.
select set_config('request.jwt.claim.sub', 'b2b20000-0000-0000-0000-00000000000b', true);
select is(
  (select balance from public.credit_wallets where user_id = 'b2b20000-0000-0000-0000-00000000000b')
    - (select balance from t_before),
  110, 'first prize and the participation coin go to the best eligible player');

-- ------------------------------------------- the projector's door, unchanged --
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

create temporary table t_screen as select public.game_screen_open() as payload;

select is(
  (select (public.game_screen_snapshot(
    (select (payload ->> 'session_id')::uuid from t_screen),
    (select payload ->> 'screen_token' from t_screen)
  )) ->> 'paired'),
  'false', 'a projector still reads its match by its screen token');
select throws_ok(
  format('select public.game_screen_snapshot(%L::uuid, %L)',
    (select payload ->> 'session_id' from t_screen), 'not-the-token'),
  '42501', null,
  'and a wrong token is still refused');

select finish();
rollback;
