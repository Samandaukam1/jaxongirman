begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

-- Auto-publish switched on, so "not sent to the store" below is the rule speaking, not the switch.
update public.app_settings set value = '{"enabled": true}' where key = 'games.store_autopublish';

-- A host and seven people in the room.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
       crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now()
  from (values
    ('a1000000-0000-0000-0000-0000000000f0'::uuid, 'mafia-host@example.com'),
    ('b1000000-0000-0000-0000-0000000000f1'::uuid, 'mafia-1@example.com'),
    ('b2000000-0000-0000-0000-0000000000f2'::uuid, 'mafia-2@example.com'),
    ('b3000000-0000-0000-0000-0000000000f3'::uuid, 'mafia-3@example.com'),
    ('b4000000-0000-0000-0000-0000000000f4'::uuid, 'mafia-4@example.com'),
    ('b5000000-0000-0000-0000-0000000000f5'::uuid, 'mafia-5@example.com'),
    ('b6000000-0000-0000-0000-0000000000f6'::uuid, 'mafia-6@example.com'),
    ('b7000000-0000-0000-0000-0000000000f7'::uuid, 'mafia-7@example.com')
  ) as people(id, email);

create temporary table t_ids (key text primary key, id uuid);
grant all on t_ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f0', true);

-- ----------------------------------------------------------- the room --
insert into t_ids values ('game', public.game_mafia_game('ru'));
select is(public.game_mafia_game('ru'), (select id from t_ids where key = 'game'), 'one Mafia game per account, made once');
reset role;
select is((select kind || '/' || store_autopublish || '/' || language from public.games where id = (select id from t_ids where key = 'game')),
  'mafia/off/ru', 'a Mafia room is never sent to the store, and speaks the host''s language');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f0', true);
select ok(not exists (select 1 from public.game_hostable_list() where id = (select id from t_ids where key = 'game')),
  'nor is it offered in the game picker');

insert into t_ids values ('session', (public.game_session_create((select id from t_ids where key = 'game')) ->> 'session_id')::uuid);
insert into t_ids values ('token', null);
reset role;
create temporary table t_token as select join_token from public.game_sessions where id = (select id from t_ids where key = 'session');
grant select on t_token to authenticated;
set local role authenticated;

-- The host joins too (their account may play other games): never dealt a card here.
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f0', true);
select public.game_join((select join_token from t_token), 'Boshlovchi', 0);
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-0000000000f1', true);
select public.game_join((select join_token from t_token), 'Bir', 1);
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000f2', true);
select public.game_join((select join_token from t_token), 'Ikki', 2);
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-0000000000f3', true);
select public.game_join((select join_token from t_token), 'Uch', 3);

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f0', true);
select throws_ok(format('select public.game_mafia_deal(%L::uuid, %L::jsonb)', (select id from t_ids where key = 'session'), '{"mafia": 1}'),
  '22023', null, 'three players are too few');

select set_config('request.jwt.claim.sub', 'b4000000-0000-0000-0000-0000000000f4', true);
select public.game_join((select join_token from t_token), 'To‘rt', 4);
select set_config('request.jwt.claim.sub', 'b5000000-0000-0000-0000-0000000000f5', true);
select public.game_join((select join_token from t_token), 'Besh', 5);

select throws_ok(format('select public.game_mafia_deal(%L::uuid, %L::jsonb)', (select id from t_ids where key = 'session'), '{"mafia": 1}'),
  'P0002', null, 'a player cannot deal');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f0', true);
select throws_ok(format('select public.game_mafia_deal(%L::uuid, %L::jsonb)', (select id from t_ids where key = 'session'), '{"mafia": 2, "don": 1}'),
  '22023', null, 'the mafia must be fewer than half the table');
select throws_ok(format('select public.game_mafia_deal(%L::uuid, %L::jsonb)', (select id from t_ids where key = 'session'), '{"mafia": 0}'),
  '22023', null, 'and there must be a mafia');
select throws_ok(format('select public.game_mafia_deal(%L::uuid, %L::jsonb)', (select id from t_ids where key = 'session'), '{"mafia": 1, "doctor": 2}'),
  '22023', null, 'one of each special card');

-- --------------------------------------------------------------- the deal --
create temporary table t_deal as
  select public.game_mafia_deal((select id from t_ids where key = 'session'), '{"mafia": 1, "don": 1, "sheriff": 1, "doctor": 1}') as view;
select is((select view -> 'roles' from t_deal),
  '{"don": 1, "lover": 0, "mafia": 1, "maniac": 0, "doctor": 1, "sheriff": 1, "civilian": 1}'::jsonb,
  'five players: a Don, a mafioso, a Komissar, a Doktor and one Fuqaro');
select is((select count(*)::integer from jsonb_array_elements((select view -> 'players' from t_deal)) as p where p ->> 'role' is not null), 5,
  'the host sees every card');
select ok((select bool_and(not (p ->> 'in_game')::boolean) from jsonb_array_elements((select view -> 'players' from t_deal)) as p
           where p ->> 'nickname' = 'Boshlovchi') is null,
  'and is not among the players: the narrator holds no card');
select throws_ok(format('select public.game_session_advance(%L::uuid, %L)', (select id from t_ids where key = 'session'), 'next'), '22023', null,
  'the quiz''s "next" cannot move a Mafia game');

reset role;
insert into t_ids select 'don_user', gp.user_id from public.game_mafia_cards c join public.game_players gp on gp.id = c.player_id
  where c.session_id = (select id from t_ids where key = 'session') and c.role = 'don';
insert into t_ids select 'mafioso_user', gp.user_id from public.game_mafia_cards c join public.game_players gp on gp.id = c.player_id
  where c.session_id = (select id from t_ids where key = 'session') and c.role = 'mafia';
insert into t_ids select 'civilian_user', gp.user_id from public.game_mafia_cards c join public.game_players gp on gp.id = c.player_id
  where c.session_id = (select id from t_ids where key = 'session') and c.role = 'civilian';
insert into t_ids select 'civilian_player', c.player_id from public.game_mafia_cards c
  where c.session_id = (select id from t_ids where key = 'session') and c.role = 'civilian';
insert into t_ids select 'mafioso_player', c.player_id from public.game_mafia_cards c
  where c.session_id = (select id from t_ids where key = 'session') and c.role = 'mafia';
insert into t_ids select 'don_player', c.player_id from public.game_mafia_cards c
  where c.session_id = (select id from t_ids where key = 'session') and c.role = 'don';

-- ------------------------------------------------------- what each one sees --
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from t_ids where key = 'civilian_user'), true);
create temporary table t_civ as select public.game_player_state((select id from t_ids where key = 'session')) as state;
select is((select state -> 'mafia' -> 'me' ->> 'role' from t_civ), 'civilian', 'a player sees their own card');
select is((select count(*)::integer from jsonb_array_elements((select state -> 'mafia' -> 'players' from t_civ)) as p where p ->> 'role' is not null), 0,
  'and nobody else''s');
select ok((select state -> 'mafia' -> 'team' = 'null'::jsonb from t_civ), 'a Fuqaro is shown no team');
select is((select state ->> 'game_kind' from t_civ), 'mafia', 'the phone knows it is playing Mafia');
select throws_ok('select role from public.game_mafia_cards', '42501', null, 'the cards table itself is closed to every client');

select set_config('request.jwt.claim.sub', (select id::text from t_ids where key = 'mafioso_user'), true);
select is(
  (select jsonb_agg(p ->> 'role') from jsonb_array_elements((public.game_player_state((select id from t_ids where key = 'session'))) -> 'mafia' -> 'team') as p),
  '["don"]'::jsonb, 'a mafioso knows the Don, as on the first night');
select public.game_mafia_seen((select id from t_ids where key = 'session'));

reset role;
select is((select count(*)::integer from jsonb_array_elements((public.game_screen_state((select id from t_ids where key = 'session'))) -> 'mafia' -> 'players') as p
           where p ->> 'role' is not null), 0, 'the board shows no card while the game is on');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f0', true);
select is((select p ->> 'seen' from jsonb_array_elements((public.game_host_state((select id from t_ids where key = 'session'))) -> 'mafia' -> 'players') as p
           where (p ->> 'id')::uuid = (select id from t_ids where key = 'mafioso_player')), 'true',
  'the host sees who has looked at their card');

-- ------------------------------------------------------------- the game --
select is((public.game_mafia_phase((select id from t_ids where key = 'session'), 'day')) ->> 'round', '1', 'night 1 gives way to day 1');
select is((public.game_mafia_phase((select id from t_ids where key = 'session'), 'night')) ->> 'round', '2', 'and day 1 to night 2');
create temporary table t_out as
  select public.game_mafia_mark((select id from t_ids where key = 'session'), (select id from t_ids where key = 'civilian_player'), false, 'night') as view;
select is((select p ->> 'out_reason' || '/' || (p ->> 'out_round') from jsonb_array_elements((select view -> 'players' from t_out)) as p
           where (p ->> 'id')::uuid = (select id from t_ids where key = 'civilian_player')), 'night/2', 'killed in the second night');
select throws_ok(format('select public.game_mafia_mark(%L::uuid, %L::uuid, false, %L)', (select id from t_ids where key = 'session'), gen_random_uuid(), 'vote'),
  'P0002', null, 'only a dealt player can be taken out');

select public.game_mafia_mark((select id from t_ids where key = 'session'), (select id from t_ids where key = 'mafioso_player'), false, 'vote');
select is((public.game_mafia_mark((select id from t_ids where key = 'session'), (select id from t_ids where key = 'don_player'), false, 'vote')) ->> 'verdict',
  'town', 'with the Don and his mafioso out, the town has won');

-- Nobody walks in on a game being played.
select set_config('request.jwt.claim.sub', 'b6000000-0000-0000-0000-0000000000f6', true);
select throws_ok(format('select public.game_join(%L, %L, 6)', (select join_token from t_token), 'Olti'), '22023', null,
  'a latecomer waits for the next game');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f0', true);
select public.game_mafia_end((select id from t_ids where key = 'session'), 'town');

select set_config('request.jwt.claim.sub', (select id::text from t_ids where key = 'civilian_user'), true);
select is((select count(*)::integer from jsonb_array_elements((public.game_player_state((select id from t_ids where key = 'session'))) -> 'mafia' -> 'players') as p
           where p ->> 'role' is not null), 5, 'when it is over, every card is shown');

select set_config('request.jwt.claim.sub', 'b6000000-0000-0000-0000-0000000000f6', true);
select lives_ok(format('select public.game_join(%L, %L, 6)', (select join_token from t_token), 'Olti'),
  'between games the doors are open');

-- ----------------------------------------------------------- the next one --
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f0', true);
create temporary table t_next as
  select public.game_mafia_deal((select id from t_ids where key = 'session'), '{"mafia": 2, "lover": 1}') as view;
select is((select (view ->> 'game_no') || '/' || (view -> 'roles' ->> 'civilian') from t_next), '2/3',
  'the second game deals six: two mafiosi, a Ma''shuqa and three Fuqaro');
select ok((select bool_and((p ->> 'alive')::boolean) from jsonb_array_elements((select view -> 'players' from t_next)) as p),
  'and everyone is back in');

select is((public.game_mafia_close((select id from t_ids where key = 'session'))) ->> 'over', 'true', 'closing the room ends the game');
reset role;
select is((select status::text from public.game_sessions where id = (select id from t_ids where key = 'session')), 'finished', 'and the session');

select * from finish();
rollback;
