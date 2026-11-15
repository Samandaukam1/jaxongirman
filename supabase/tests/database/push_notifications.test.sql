begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-0000000000e9', 'authenticated', 'authenticated',
   'push-a@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Aziza Push"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-0000000000e9', 'authenticated', 'authenticated',
   'push-b@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Bobur Push"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-0000000000e9', 'authenticated', 'authenticated',
   'push-c@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Chori Push"}', now(), now());
update public.profiles set preferred_language = 'ru' where id = 'b2000000-0000-0000-0000-0000000000e9';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

-- B has a phone; A does not yet.
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000e9', true);
select throws_ok($$select public.push_token_register('not-a-token', 'ios', 'iPhone')$$, '22023', null, 'only an Expo push token is a token');
select lives_ok($$select public.push_token_register('ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]', 'ios', 'iPhone 15')$$, 'a phone registers its token');
select is((select count(*)::integer from public.push_tokens), 1, 'and its owner sees it');

-- A notification for each of them: only the one with a phone is queued.
reset role;
insert into public.notifications (user_id, kind, title, body, deep_link) values
  ('a1000000-0000-0000-0000-0000000000e9', 'system', 'Salom A', 'Matn', '/notifications'),
  ('b2000000-0000-0000-0000-0000000000e9', 'game_store_published', 'O‘yiningiz do‘konda', 'Tekin chiqdi', '/oyingoh/publish/x');
select is((select count(*)::integer from public.push_outbox where user_id = 'a1000000-0000-0000-0000-0000000000e9'), 0,
  'nobody is queued for a push no phone will receive');
select is((select data ->> 'url' from public.push_outbox where user_id = 'b2000000-0000-0000-0000-0000000000e9'), '/oyingoh/publish/x',
  'a notification is pushed, opening where the list item opens');

-- A chat: A writes to B and to C.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000e9', true);
select public.push_token_register('ExponentPushToken[cccccccccccccccccccccc]', 'android', 'Pixel');
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000e9', true);
-- B saved A under a name of their own.
insert into public.chat_contacts (owner_id, contact_id, display_name) values ('b2000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000e9', 'Azizaxon');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e9', true);
create temporary table t_chat (who text, id uuid);
grant all on t_chat to authenticated;
insert into t_chat select 'b', public.chat_open_direct('b2000000-0000-0000-0000-0000000000e9');
insert into t_chat select 'c', public.chat_open_direct('c3000000-0000-0000-0000-0000000000e9');
-- The picture A sends is in A's folder of the conversation, as the app uploads it.
reset role;
insert into storage.objects (bucket_id, name) values
  ('chat-media', (select id from t_chat where who = 'b')::text || '/a1000000-0000-0000-0000-0000000000e9/p.jpg');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e9', true);
select public.chat_send((select id from t_chat where who = 'b'), 'image', '',
  (select id from t_chat where who = 'b')::text || '/a1000000-0000-0000-0000-0000000000e9/p.jpg', '{"width": 10, "height": 10}'::jsonb);
select public.chat_send((select id from t_chat where who = 'c'), 'text', 'Ertaga   uchrashamiz');

reset role;
create temporary table t_b as select * from public.push_outbox where user_id = 'b2000000-0000-0000-0000-0000000000e9' and channel = 'chat';
select is((select title from t_b), 'Azizaxon', 'the sender as the recipient saved them');
select is((select body from t_b), 'Фото', 'what it is, in the recipient''s language');
select is((select data ->> 'url' from t_b), '/chat/' || (select id from t_chat where who = 'b'), 'and it opens the conversation');
select is((select title || ' / ' || body from public.push_outbox where user_id = 'c3000000-0000-0000-0000-0000000000e9'), 'Aziza Push / Ertaga uchrashamiz',
  'a text message is its own words, on one line');
select is((select count(*)::integer from public.push_outbox where user_id = 'a1000000-0000-0000-0000-0000000000e9'), 0, 'the sender is not told of their own message');

-- C mutes A: nothing more from A reaches C's phone.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000e9', true);
insert into public.chat_contacts (owner_id, contact_id, muted) values ('c3000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000e9', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e9', true);
select public.chat_send((select id from t_chat where who = 'c'), 'text', 'Yana bir xabar');
reset role;
select is((select count(*)::integer from public.push_outbox where user_id = 'c3000000-0000-0000-0000-0000000000e9'), 1, 'a muted sender reaches no phone');

-- No client reads the outbox or runs the dispatcher's functions.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000e9', true);
select throws_ok('select count(*) from public.push_outbox', '42501', null, 'the outbox is closed to clients');
select throws_ok('select * from public.push_outbox_claim(10)', '42501', null, 'and so is claiming it');

-- The dispatcher.
reset role;
set local role service_role;
create temporary table t_claim as select * from public.push_outbox_claim(50);
select is((select count(*)::integer from t_claim), 3, 'a run claims every pending push');
select is((select tokens from t_claim where title = 'Azizaxon'), array['ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'], 'each with the phones to send it to');
select is((select count(*)::integer from public.push_outbox_claim(50)), 0, 'and a second run at once finds nothing to send twice');
select public.push_outbox_finish(
  (select array_agg(id) from t_claim where title <> 'Azizaxon'),
  jsonb_build_object((select id from t_claim where title = 'Azizaxon')::text, 'DeviceNotRegistered'),
  array['ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]']);
reset role;
select is((select count(*)::integer from public.push_outbox where status = 'sent'), 2, 'what went is marked sent');
select is((select status from public.push_outbox where title = 'Azizaxon'), 'pending', 'what failed is tried again');
select ok(not exists (select 1 from public.push_tokens where token = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'), 'a phone Expo says is gone is forgotten');

-- The same phone signed into another account moves with it.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e9', true);
select public.push_token_register('ExponentPushToken[cccccccccccccccccccccc]', 'android', 'Pixel');
reset role;
select is((select user_id from public.push_tokens where token = 'ExponentPushToken[cccccccccccccccccccccc]'), 'a1000000-0000-0000-0000-0000000000e9'::uuid,
  'a phone signed into another account belongs to that account now');
select lives_ok('select public.push_kick()', 'with no dispatcher configured, a nudge is a quiet no-op');

-- An administrator's message: everyone, or everyone in one language.
insert into public.user_roles (user_id, role) values ('c3000000-0000-0000-0000-0000000000e9', 'admin');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e9', true);
select throws_ok($$select public.admin_broadcast('Yangi versiya', 'Yangilang', '/notifications')$$, '42501', null, 'only an administrator broadcasts');
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000e9', true);
select is(public.admin_broadcast('Новая версия', 'Обновите приложение', '/notifications', 'ru'), 1, 'to one language: only those using the app in it');
reset role;
select ok(exists (select 1 from public.notifications where user_id = 'b2000000-0000-0000-0000-0000000000e9' and title = 'Новая версия'), 'it is an ordinary notification in their list');
select ok(exists (select 1 from public.admin_audit_logs where action = 'broadcast' and admin_id = 'c3000000-0000-0000-0000-0000000000e9'), 'and the act is logged');

select * from finish();
rollback;
