begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

/* O‘yingoh in three languages: the column, the grader's fold, the projector. */

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '61000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'g@example.com', '', now(), '{}', '{"full_name":"G"}', now(), now());

insert into public.games (id, owner_id, title) values ('62000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000001', 'Tarix');
select is((select language from public.games where id = '62000000-0000-0000-0000-000000000002'), 'uz', 'a game is Uzbek unless it says otherwise');

insert into public.games (id, owner_id, title, language) values ('62000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000001', 'История', 'ru');
select is((select language from public.games where id = '62000000-0000-0000-0000-000000000003'), 'ru', 'a Russian game is stored as Russian');
select throws_ok($$ insert into public.games (owner_id, title, language) values ('61000000-0000-0000-0000-000000000001', 'X', 'de') $$,
  '23514', null, 'only uz, en and ru are languages');

select is(public.game_normalize_text('  Ёлка   МОСКВА '), 'елка москва', 'Russian answers fold ё and case');
select is(public.game_normalize_text('ёж'), public.game_normalize_text('еж'), '«ёж» and «еж» are one answer');
select is(public.game_normalize_text('O‘zbekiston'), public.game_normalize_text('O''zbekiston'), 'Uzbek apostrophes still fold');
select is(public.game_normalize_text('  New   York '), 'new york', 'English answers fold case and spaces');

select ok(pg_get_functiondef('public.game_screen_snapshot(uuid, text)'::regprocedure) like '%''game_language''%',
  'the projector snapshot carries the game''s language');

select * from finish();
rollback;
