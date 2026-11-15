begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

-- Auto-publish switched on, so "not sent to the store" below is the rule speaking, not the switch.
update public.app_settings set value = '{"enabled": true}' where key = 'games.store_autopublish';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated',
   'xw-host@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated',
   'xw-fast@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Fast"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated',
   'xw-slow@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Slow"}', now(), now());

-- KITOB across and KALIT down, sharing the K in the corner.
insert into public.games (id, owner_id, title, status, question_count, kind)
values ('d4000000-0000-0000-0000-0000000000c4', 'a1000000-0000-0000-0000-0000000000c1', 'Krossvord sinovi', 'draft', 0, 'crossword');

select is((select store_autopublish from public.games where id = 'd4000000-0000-0000-0000-0000000000c4'), 'off',
  'a crossword is not sent to the store on its own');

insert into public.game_questions (id, game_id, owner_id, position, type, prompt, time_limit_seconds, base_points, config)
values ('e5000000-0000-0000-0000-0000000000c5', 'd4000000-0000-0000-0000-0000000000c4', 'a1000000-0000-0000-0000-0000000000c1',
  0, 'crossword', 'Krossvord', 600, 1000,
  '{"width": 5, "height": 5, "words": [
     {"id": "1a", "number": 1, "direction": "across", "row": 0, "col": 0, "length": 5, "clue": "Öqiladigan narsa", "answer": "KITOB"},
     {"id": "1d", "number": 1, "direction": "down", "row": 0, "col": 0, "length": 5, "clue": "Eşikni oçadi", "answer": "KALIT"}
   ]}');

select throws_ok(
  $$insert into public.game_questions (game_id, owner_id, position, type, prompt, time_limit_seconds, config)
    values ('d4000000-0000-0000-0000-0000000000c4', 'a1000000-0000-0000-0000-0000000000c1', 1, 'single_choice', 'x', 600,
      '{"options": [], "correct": "a"}')$$,
  '23514', null, 'ten minutes is a crossword''s time, not a quiz question''s');

select is(
  (public.game_grade_answer((select q from public.game_questions q where q.id = 'e5000000-0000-0000-0000-0000000000c5'),
    '{"words": {"1a": "KITOB"}}'::jsonb, 300000)).score,
  250, 'one word of two is half of the words'' half of the points, whatever the time');
select is(
  (public.game_grade_answer((select q from public.game_questions q where q.id = 'e5000000-0000-0000-0000-0000000000c5'),
    '{"words": {"1a": "KITOB", "1d": "KALIT"}}'::jsonb, 300000)).score,
  750, 'the whole grid at half time: all the words, and half the speed half');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000c1', true);
select is((public.game_set_status('d4000000-0000-0000-0000-0000000000c4', 'ready')) ->> 'status', 'ready',
  'a crossword with its words is ready to host');

create temporary table t_session as
  select public.game_session_create('d4000000-0000-0000-0000-0000000000c4') as payload;

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000c2', true);
select ok(public.game_join((select payload ->> 'join_token' from t_session), 'Tez', 1) is not null, 'the fast player joins');
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000c3', true);
select ok(public.game_join((select payload ->> 'join_token' from t_session), 'Sekin', 2) is not null, 'the slow player joins');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000c1', true);
select is((public.game_session_advance((select (payload ->> 'session_id')::uuid from t_session), 'next')) ->> 'status',
  'countdown', 'the host starts');
select is((public.game_session_advance((select (payload ->> 'session_id')::uuid from t_session), 'next')) ->> 'status',
  'question', 'the grid opens');
select ok(
  (public.game_host_state((select (payload ->> 'session_id')::uuid from t_session))) -> 'current_question' -> 'config' -> 'words' -> 0 ->> 'answer' = 'KITOB',
  'the host sees the answers');

-- ------------------------------------------------------------ the fast one --
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000c2', true);
create temporary table t_state as
  select public.game_player_state((select (payload ->> 'session_id')::uuid from t_session)) as payload;
select is(jsonb_array_length((select payload from t_state) -> 'question' -> 'config' -> 'words'), 2,
  'a player gets every word of the grid');
select ok(position('KITOB' in ((select payload from t_state) -> 'question')::text) = 0
      and position('KALIT' in ((select payload from t_state) -> 'question')::text) = 0,
  'and not one answer');

create temporary table t_first as
  select public.game_submit_answer((select (payload ->> 'session_id')::uuid from t_session), 0,
    '{"words": {"1a": "KITOB", "1d": "KAL"}}'::jsonb) as payload;
select is((select payload -> 'solved_ids' from t_first), '["1a"]'::jsonb, 'the player learns which of their words are right');
select is((select payload ->> 'locked' from t_first), 'false', 'and keeps solving');

select is(
  (select payload -> 'progress' -> 'words' ->> '1a' from (select public.game_player_state((select (payload ->> 'session_id')::uuid from t_session)) as payload) s),
  'KITOB', 'a phone that reopens gets its letters back');

create temporary table t_second as
  select public.game_submit_answer((select (payload ->> 'session_id')::uuid from t_session), 0,
    '{"words": {"1a": "KITOB", "1d": "KALIT"}}'::jsonb) as payload;
select is((select payload ->> 'locked' from t_second), 'true', 'every word right finishes the grid');
select is(
  (select total_score from public.game_players where user_id = 'b2000000-0000-0000-0000-0000000000c2'),
  (select score_awarded from public.game_answers a join public.game_players p on p.id = a.player_id
    where p.user_id = 'b2000000-0000-0000-0000-0000000000c2'),
  'sending again moves the score by the difference, never adds it twice');
select is(
  (select count(*)::integer from public.game_answers where question_id = 'e5000000-0000-0000-0000-0000000000c5'),
  1, 'one player, one row, however many sends');
select is((public.game_submit_answer((select (payload ->> 'session_id')::uuid from t_session), 0,
    '{"words": {"1a": "XXXXX"}}'::jsonb)) ->> 'locked', 'true', 'a finished grid cannot be undone');

reset role;
select is(
  (public.game_screen_state((select (payload ->> 'session_id')::uuid from t_session))) ->> 'status', 'question',
  'the room is still solving while one player has not finished');
select is(
  (public.game_screen_state((select (payload ->> 'session_id')::uuid from t_session))) -> 'crossword_progress' -> 0 ->> 'nickname',
  'Tez', 'the board ranks the race by words found');
select is(
  ((public.game_screen_state((select (payload ->> 'session_id')::uuid from t_session))) ->> 'answered_count')::integer,
  1, 'and counts who has finished, not who has typed');

-- ------------------------------------------------------------ the slow one --
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000c3', true);
select is((public.game_submit_answer((select (payload ->> 'session_id')::uuid from t_session), 0,
    '{"words": {"1a": "KITOP"}, "done": true}'::jsonb)) -> 'solved_ids', '[]'::jsonb,
  'a wrong word earns nothing');

reset role;
select is((select status::text from public.game_sessions where id = (select (payload ->> 'session_id')::uuid from t_session)),
  'question_result', 'when everyone is done the grid closes for the room');

select * from finish();
rollback;
