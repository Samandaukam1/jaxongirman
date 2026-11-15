begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1a10000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated',
   'teamhost@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Team Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2b20000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated',
   'teamp1@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"P One"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2b20000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated',
   'teamp2@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"P Two"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2b20000-0000-0000-0000-0000000000b3', 'authenticated', 'authenticated',
   'teamp3@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"P Three"}', now(), now());

insert into public.games (id, owner_id, title, status, question_count)
values ('d4d40000-0000-0000-0000-0000000000d1', 'a1a10000-0000-0000-0000-0000000000a1', 'Jamoaviy o‘yin', 'draft', 0);
insert into public.game_questions (id, game_id, owner_id, position, type, prompt, config)
values ('e5e50000-0000-0000-0000-0000000000e1', 'd4d40000-0000-0000-0000-0000000000d1', 'a1a10000-0000-0000-0000-0000000000a1',
  0, 'single_choice', 'Poytaxt qayer?', '{"options":[{"id":"a","text":"Toshkent"},{"id":"b","text":"Samarqand"}],"correct":"a"}');
update public.games set status = 'ready' where id = 'd4d40000-0000-0000-0000-0000000000d1';
insert into public.credit_wallets (user_id, balance) values ('a1a10000-0000-0000-0000-0000000000a1', 1000)
on conflict (user_id) do update set balance = 1000, reserved = 0;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true), set_config('request.jwt.claim.role', 'authenticated', true);
$$;

set local role authenticated;
select pg_temp.act_as('a1a10000-0000-0000-0000-0000000000a1');
create temporary table t_session as select public.game_session_create('d4d40000-0000-0000-0000-0000000000d1') as payload;
create temporary table t_ids as
  select (payload ->> 'session_id')::uuid as session_id, payload ->> 'join_token' as token, payload ->> 'join_code' as code from t_session;

-- The host names three teams.
select is(
  (select public.game_session_configure((select session_id from t_ids), p_team_mode => true,
     p_teams => '["1-jamoa","2-jamoa","3-jamoa"]'::jsonb) -> 'teams'),
  '["1-jamoa","2-jamoa","3-jamoa"]'::jsonb, 'the host sets three teams');
select throws_ok(
  format('select public.game_session_configure(%L, p_teams => %L::jsonb)', (select session_id from t_ids), '["A","B","C","D"]'),
  '22023', null, 'four teams is one too many');
select throws_ok(
  format('select public.game_session_configure(%L, p_teams => %L::jsonb)', (select session_id from t_ids), '["A","a"]'),
  '22023', null, 'two teams may not share a name');

-- Players choose.
select pg_temp.act_as('b2b20000-0000-0000-0000-0000000000b1');
select is((select public.game_join_preview((select token from t_ids)) -> 'teams'), '["1-jamoa","2-jamoa","3-jamoa"]'::jsonb,
  'a player sees the teams before joining');
select is((select public.game_join((select token from t_ids), 'Bir', 1, '3-jamoa') ->> 'team'), '3-jamoa', 'a player joins the team they chose');
select pg_temp.act_as('b2b20000-0000-0000-0000-0000000000b2');
select is((select public.game_join_by_code((select code from t_ids), 'Ikki', 2, 'Yo‘q jamoa') ->> 'team'), '1-jamoa',
  'a team the host does not offer falls back to the smallest one');

-- Changing an unrelated setting keeps every choice; renaming carries the players along.
select pg_temp.act_as('a1a10000-0000-0000-0000-0000000000a1');
select public.game_session_configure((select session_id from t_ids), p_sound_enabled => false);
select is((select team from public.game_players where user_id = 'b2b20000-0000-0000-0000-0000000000b1'), '3-jamoa',
  'switching the sound off does not re-deal the teams');
select public.game_session_configure((select session_id from t_ids), p_teams => '["Lochinlar","Burgutlar","Qoplonlar"]'::jsonb);
select is((select team from public.game_players where user_id = 'b2b20000-0000-0000-0000-0000000000b1'), 'Qoplonlar',
  'a renamed team keeps its players');
select is((select team from public.game_players where user_id = 'b2b20000-0000-0000-0000-0000000000b2'), 'Lochinlar',
  'and so does the first one');

-- Latecomers: welcome unless the host closes the door. A host on an app from
-- before 2.0 has no switch, so the default must be the old behaviour.
reset role;
select is((select allow_late_join from public.game_sessions where id = (select session_id from t_ids)), true,
  'latecomers are welcome by default, as they were before the switch existed');
set local role authenticated;
select pg_temp.act_as('a1a10000-0000-0000-0000-0000000000a1');
select public.game_session_configure((select session_id from t_ids), p_allow_late_join => false);
reset role;
update public.game_sessions set status = 'question', question_ids = array['e5e50000-0000-0000-0000-0000000000e1'::uuid], current_index = 0
 where id = (select session_id from t_ids);
set local role authenticated;
select pg_temp.act_as('b2b20000-0000-0000-0000-0000000000b3');
select is((select public.game_join_preview((select token from t_ids)) ->> 'joinable'), 'false', 'the preview says the door is closed');
select throws_ok(format('select public.game_join(%L, %L, 3)', (select token from t_ids), 'Uch'), '22023', null,
  'with latecomers off, nobody new joins once it has started');
select pg_temp.act_as('b2b20000-0000-0000-0000-0000000000b1');
select lives_ok(format('select public.game_join(%L, %L, 1)', (select token from t_ids), 'Bir'),
  'someone already in may come back after a dropped connection');
reset role;
update public.game_sessions set allow_late_join = true where id = (select session_id from t_ids);
set local role authenticated;
select pg_temp.act_as('b2b20000-0000-0000-0000-0000000000b3');
select is((select public.game_join((select token from t_ids), 'Uch', 3) ->> 'team'), 'Burgutlar',
  'with latecomers on, a latecomer joins — into the smallest team');

-- The host sees the question and its answer; the board knows the door is open.
select pg_temp.act_as('a1a10000-0000-0000-0000-0000000000a1');
select is((select public.game_host_state((select session_id from t_ids)) -> 'current_question' ->> 'prompt'), 'Poytaxt qayer?',
  'the host sees the open question');
select is((select public.game_host_state((select session_id from t_ids)) -> 'current_question' -> 'config' ->> 'correct'), 'a',
  'and its answer');
reset role;
select is((select public.game_screen_state((select session_id from t_ids)) ->> 'allow_late_join'), 'true',
  'the board knows latecomers are welcome');

-- A player's answer is the player's own JSON: a "done" that is not a boolean
-- must not take the host's or the board's screen down.
insert into public.game_answers (session_id, player_id, question_id, question_index, payload)
select (select session_id from t_ids), p.id, 'e5e50000-0000-0000-0000-0000000000e1', 0, '{"choice": "a", "done": "zzz"}'::jsonb
  from public.game_players p
 where p.session_id = (select session_id from t_ids) and p.user_id = 'b2b20000-0000-0000-0000-0000000000b3';
select lives_ok(format('select public.game_screen_state(%L)', (select session_id from t_ids)),
  'the board still shows the question');
set local role authenticated;
select pg_temp.act_as('a1a10000-0000-0000-0000-0000000000a1');
select is((select public.game_host_state((select session_id from t_ids)) ->> 'answered_count'), '1',
  'and the host still counts the answer');
reset role;
select ok(not has_function_privilege('anon', 'public.game_join_preview(text, text)', 'EXECUTE'),
  'a signed-out browser cannot look a game up');

select * from finish();
rollback;
