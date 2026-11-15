begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

-- Auto-publish switched on, so "not sent to the store" below is the rule speaking, not the switch.
update public.app_settings set value = '{"enabled": true}' where key = 'games.store_autopublish';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-0000000000a7', 'authenticated', 'authenticated',
   'lib-a@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Muallif"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-0000000000b7', 'authenticated', 'authenticated',
   'lib-b@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Oluvchi"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-0000000000c7', 'authenticated', 'authenticated',
   'lib-c@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Begona"}', now(), now());

-- The author's deck: two slides, a picture in their folder, a defence script and a source.
insert into public.presentations (id, owner_id, title, topic, status, style, requested_slide_count)
values ('d0000000-0000-0000-0000-0000000000d7', 'a1000000-0000-0000-0000-0000000000a7', 'Muallif taqdimoti', 'Mavzu bu', 'ready', 'simple', 2);
insert into public.slides (id, presentation_id, owner_id, position, title) values
  ('d1000000-0000-0000-0000-0000000000d7', 'd0000000-0000-0000-0000-0000000000d7', 'a1000000-0000-0000-0000-0000000000a7', 0, 'Birinchi'),
  ('d2000000-0000-0000-0000-0000000000d7', 'd0000000-0000-0000-0000-0000000000d7', 'a1000000-0000-0000-0000-0000000000a7', 1, 'Ikkinchi');
insert into public.slide_elements (slide_id, presentation_id, owner_id, type, x, y, width, height, content) values
  ('d1000000-0000-0000-0000-0000000000d7', 'd0000000-0000-0000-0000-0000000000d7', 'a1000000-0000-0000-0000-0000000000a7', 'text', 0, 0, 100, 50, '{"text": "Salom"}'),
  ('d1000000-0000-0000-0000-0000000000d7', 'd0000000-0000-0000-0000-0000000000d7', 'a1000000-0000-0000-0000-0000000000a7', 'image', 0, 60, 100, 50,
   '{"storageBucket": "user-uploads", "storagePath": "a1000000-0000-0000-0000-0000000000a7/d0000000-0000-0000-0000-0000000000d7/rasm.png"}'),
  ('d2000000-0000-0000-0000-0000000000d7', 'd0000000-0000-0000-0000-0000000000d7', 'a1000000-0000-0000-0000-0000000000a7', 'text', 0, 0, 100, 50, '{"text": "Xayr"}');
insert into public.presentation_defenses (presentation_id, owner_id, status, introduction, pdf_path)
values ('d0000000-0000-0000-0000-0000000000d7', 'a1000000-0000-0000-0000-0000000000a7', 'ready', 'Hurmatli hay’at', 'a1000000-0000-0000-0000-0000000000a7/defense.pdf');
insert into public.presentation_sources (presentation_id, owner_id, label, url)
values ('d0000000-0000-0000-0000-0000000000d7', 'a1000000-0000-0000-0000-0000000000a7', 'Manba', 'https://example.com');

insert into public.games (id, owner_id, title, status, question_count)
values ('e0000000-0000-0000-0000-0000000000e7', 'a1000000-0000-0000-0000-0000000000a7', 'Muallif o‘yini', 'ready', 0);
insert into public.game_questions (game_id, owner_id, position, type, prompt, media_path, config) values
  ('e0000000-0000-0000-0000-0000000000e7', 'a1000000-0000-0000-0000-0000000000a7', 0, 'true_false', 'Rostmi?', null, '{"correct": true}'),
  ('e0000000-0000-0000-0000-0000000000e7', 'a1000000-0000-0000-0000-0000000000a7', 1, 'image_quiz', 'Bu nima?',
   'a1000000-0000-0000-0000-0000000000a7/e0000000-0000-0000-0000-0000000000e7/q.jpg', '{"options": [{"id": "a", "text": "Olma"}, {"id": "b", "text": "Nok"}], "correct": "a"}');

insert into public.academic_works (id, owner_id, kind, topic, status)
values ('f0000000-0000-0000-0000-0000000000f7', 'a1000000-0000-0000-0000-0000000000a7', 'referat', 'Ilmiy mavzu', 'ready');
insert into public.academic_sections (work_id, owner_id, position, key, heading, body)
values ('f0000000-0000-0000-0000-0000000000f7', 'a1000000-0000-0000-0000-0000000000a7', 0, 'intro', 'Kirish', 'Matn');

-- The author shares all three.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000a7', true);
create temporary table t_chat as select public.chat_open_direct('b2000000-0000-0000-0000-0000000000b7') as id;
create temporary table t_shares as
  select 'presentation' as kind, (public.chat_send((select id from t_chat), 'share', '', p_share => '{"kind": "presentation", "id": "d0000000-0000-0000-0000-0000000000d7"}')).id as message
  union all
  select 'game', (public.chat_send((select id from t_chat), 'share', '', p_share => '{"kind": "game", "id": "e0000000-0000-0000-0000-0000000000e7"}')).id
  union all
  select 'academic', (public.chat_send((select id from t_chat), 'share', '', p_share => '{"kind": "academic", "id": "f0000000-0000-0000-0000-0000000000f7"}')).id;
select throws_ok($$select public.chat_library_copy((select message from t_shares where kind = 'game'), 'b2000000-0000-0000-0000-0000000000b7')$$,
  '42501', null, 'the app cannot call the copy itself; the function does it');
reset role;

-- ------------------------------------------------------------- the deck --
create temporary table t_deck as
  select public.chat_library_copy((select message from t_shares where kind = 'presentation'), 'b2000000-0000-0000-0000-0000000000b7') as result;
create temporary table t_deck_id as select ((select result from t_deck) ->> 'id')::uuid as id;
select is((select owner_id from public.presentations where id = (select id from t_deck_id)), 'b2000000-0000-0000-0000-0000000000b7'::uuid,
  'the receiver owns the copy');
select is((select count(*)::integer from public.slides where presentation_id = (select id from t_deck_id)), 2, 'with both slides');
select is((select count(*)::integer from public.slide_elements where presentation_id = (select id from t_deck_id) and owner_id = 'b2000000-0000-0000-0000-0000000000b7'), 3,
  'and every element, theirs');
select is(
  (select content ->> 'storagePath' from public.slide_elements where presentation_id = (select id from t_deck_id) and type = 'image'),
  'b2000000-0000-0000-0000-0000000000b7/' || (select id from t_deck_id) || '/rasm.png',
  'the picture is moved into the receiver''s folder');
select is((select result -> 'files' -> 0 ->> 'from' from t_deck),
  'a1000000-0000-0000-0000-0000000000a7/d0000000-0000-0000-0000-0000000000d7/rasm.png', 'and the file to copy is listed');
select is((select introduction from public.presentation_defenses where presentation_id = (select id from t_deck_id)), 'Hurmatli hay’at',
  'the defence script travels with the deck');
select ok((select pdf_path is null from public.presentation_defenses where presentation_id = (select id from t_deck_id)),
  'its PDF is drawn again for the new owner, not shared');
select is((select count(*)::integer from public.presentation_sources where presentation_id = (select id from t_deck_id)), 1, 'and so do its sources');
select is(
  (public.chat_library_copy((select message from t_shares where kind = 'presentation'), 'b2000000-0000-0000-0000-0000000000b7')) ->> 'id',
  (select id from t_deck_id)::text, 'adding it twice gives the same copy');
select is((select count(*)::integer from public.presentations where owner_id = 'b2000000-0000-0000-0000-0000000000b7'), 1, 'not a second one');

-- ------------------------------------------------------------- the game --
create temporary table t_game as
  select ((public.chat_library_copy((select message from t_shares where kind = 'game'), 'b2000000-0000-0000-0000-0000000000b7')) ->> 'id')::uuid as id;
select is((select store_autopublish from public.games where id = (select id from t_game)), 'off',
  'a copied game is not sent to the store on the receiver''s behalf');
select is((select question_count from public.games where id = (select id from t_game)), 2, 'it has both questions');
select is((select media_path from public.game_questions where game_id = (select id from t_game) and type = 'image_quiz'),
  'b2000000-0000-0000-0000-0000000000b7/' || (select id from t_game) || '/q.jpg', 'its picture moves with it');
select is((select count(*)::integer from public.notifications where user_id = 'b2000000-0000-0000-0000-0000000000b7'), 0,
  'and nobody is told it will be published');

-- ----------------------------------------------------- the scientific work --
create temporary table t_work as
  select ((public.chat_library_copy((select message from t_shares where kind = 'academic'), 'b2000000-0000-0000-0000-0000000000b7')) ->> 'id')::uuid as id;
select is((select count(*)::integer from public.academic_sections where work_id = (select id from t_work)), 1, 'a scientific work comes with its sections');

-- ------------------------------------------------------------- outsiders --
select throws_ok($$select public.chat_library_copy((select message from t_shares where kind = 'game'), 'c3000000-0000-0000-0000-0000000000c7')$$,
  'P0002', null, 'someone outside the conversation gets nothing');
select is(
  (public.chat_library_copy((select message from t_shares where kind = 'game'), 'a1000000-0000-0000-0000-0000000000a7')) ->> 'id',
  'e0000000-0000-0000-0000-0000000000e7', 'the author adding their own share just gets theirs back');

select * from finish();
rollback;
