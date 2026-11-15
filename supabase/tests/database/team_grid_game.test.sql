begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated',
   'grid-host@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated',
   'grid-other@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Other"}', now(), now());

insert into public.games (id, owner_id, title, status, question_count, kind)
values ('c3000000-0000-0000-0000-0000000000e3', 'a1000000-0000-0000-0000-0000000000e1', 'Jamoaviy sinov', 'draft', 0, 'grid');
insert into public.game_questions (game_id, owner_id, position, type, prompt, base_points, config)
select 'c3000000-0000-0000-0000-0000000000e3', 'a1000000-0000-0000-0000-0000000000e1', n - 1, 'open_answer',
       'Savol ' || n, (array[500, 1000, 1500])[1 + (n - 1) % 3], jsonb_build_object('reference', 'Javob ' || n)
  from generate_series(1, 12) as n;
update public.games set status = 'ready' where id = 'c3000000-0000-0000-0000-0000000000e3';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e1', true);

create temporary table t_session as
  select (public.game_session_create('c3000000-0000-0000-0000-0000000000e3') ->> 'session_id')::uuid as id;

select throws_ok($$select public.game_grid_start((select id from t_session), array['Bir'])$$, '22023', null,
  'one team is no contest');
select is(jsonb_array_length((public.game_grid_start((select id from t_session), array['Lochinlar', ''])) -> 'cells'), 12,
  'two teams: up to thirty cells, here every one of the twelve questions');
select is((public.game_host_state((select id from t_session))) -> 'grid' -> 'teams', '["Lochinlar", "2-jamoa"]'::jsonb,
  'a team without a name is numbered');
select throws_ok($$select public.game_grid_start((select id from t_session), array['A', 'B'])$$, '22023', null,
  'a started game does not start again');
select throws_ok(format('select public.game_session_advance(%L::uuid, %L)', (select id from t_session), 'next'), '22023', null,
  'the quiz''s own "next" cannot move a grid game');
select is(
  (select count(distinct cell -> 'points')::integer from jsonb_array_elements((public.game_host_state((select id from t_session))) -> 'grid' -> 'cells') as cell),
  3, 'the cells carry their worth: easy, middling and hard');

create temporary table t_open as select public.game_grid_open((select id from t_session), 4) as view;
select is((select view -> 'open' ->> 'cell' from t_open), '4', 'the host opens a cell');
select ok((select view -> 'open' ->> 'answer' from t_open) like 'Javob %', 'and sees its answer');
select throws_ok($$select public.game_grid_open((select id from t_session), 5)$$, '22023', null,
  'one cell open at a time');

reset role;
select ok((public.game_screen_state((select id from t_session))) -> 'grid' -> 'open' ->> 'prompt' like 'Savol %',
  'the board shows the question');
select ok((public.game_screen_state((select id from t_session))) -> 'grid' -> 'open' -> 'answer' = 'null'::jsonb,
  'but not its answer');
select ok(position('Javob' in ((public.game_screen_state((select id from t_session))) -> 'grid' -> 'cells')::text) = 0,
  'and no cell carries an answer or a question');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e1', true);
select ok((public.game_grid_reveal((select id from t_session))) -> 'open' ->> 'revealed' = 'true', 'the host shows the answer');
reset role;
select ok((public.game_screen_state((select id from t_session))) -> 'grid' -> 'open' ->> 'answer' like 'Javob %',
  'and then the board has it');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e1', true);
create temporary table t_points as
  select ((public.game_host_state((select id from t_session))) -> 'grid' -> 'cells' -> 4 ->> 'points')::integer as points;
create temporary table t_right as select public.game_grid_judge((select id from t_session), true) as view;
select is((select (view -> 'scores' ->> 0)::integer from t_right), (select points from t_points),
  'right: the cell''s points go to the team whose turn it was');
select is((select view -> 'cells' -> 4 ->> 'state' from t_right) || '/' || (select view ->> 'turn' from t_right), 'won/1',
  'the cell is theirs and the turn passes');
select throws_ok($$select public.game_grid_open((select id from t_session), 4)$$, '22023', null,
  'a played cell cannot be opened again');

select public.game_grid_open((select id from t_session), 0);
create temporary table t_wrong as select public.game_grid_judge((select id from t_session), false) as view;
select is((select (view -> 'scores' ->> 1)::integer || '/' || (view -> 'cells' -> 0 ->> 'state') || '/' || (view ->> 'turn') from t_wrong),
  '0/missed/0', 'wrong: no points, the cell is spent, the turn passes back');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000e2', true);
select throws_ok($$select public.game_grid_open((select id from t_session), 1)$$, 'P0002', null,
  'nobody but the host moves the game');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e1', true);
select public.game_grid_finish((select id from t_session));
reset role;
select is((select status::text from public.game_sessions where id = (select id from t_session)), 'finished', 'the host ends the game');

select * from finish();
rollback;
