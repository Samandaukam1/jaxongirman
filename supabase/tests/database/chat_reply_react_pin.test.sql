begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

-- Anvar, Barno, Chori: A talks to B and to C.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-0000000000f9', 'authenticated', 'authenticated',
   'react-a@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Anvar"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b3000000-0000-0000-0000-0000000000f9', 'authenticated', 'authenticated',
   'react-b@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Barno"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-0000000000f9', 'authenticated', 'authenticated',
   'react-c@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Chori"}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
create temporary table t_ab (id uuid);
create temporary table t_ac (id uuid);
create temporary table t_m (name text, id uuid);
grant all on t_ab, t_ac, t_m to authenticated;

select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-0000000000f9', true);
insert into t_ab select public.chat_open_direct('b3000000-0000-0000-0000-0000000000f9');
insert into t_ac select public.chat_open_direct('c3000000-0000-0000-0000-0000000000f9');

-- Replies: B asks, A answers that message.
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-0000000000f9', true);
insert into t_m select 'b1', (public.chat_send((select id from t_ab), 'text', 'Ertaga seminar bormi?')).id;
select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-0000000000f9', true);
insert into t_m select 'a1', (public.chat_send((select id from t_ab), 'text', 'Ha, soat 10 da', p_reply_to => (select id from t_m where name = 'b1'))).id;
select is((select reply_to_id from public.chat_messages where id = (select id from t_m where name = 'a1')), (select id from t_m where name = 'b1'),
  'a reply names the message it answers');
select throws_ok(format('select public.chat_send(%L::uuid, %L, %L, p_reply_to => %L::uuid)', (select id from t_ac), 'text', 'x', (select id from t_m where name = 'b1')),
  '22023', null, 'a reply cannot point into another conversation');

-- Reactions: one each; the same again takes it back.
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-0000000000f9', true);
select is(public.chat_react((select id from t_m where name = 'a1'), '❤️') ->> 'b3000000-0000-0000-0000-0000000000f9', '❤️', 'B reacts to A''s message');
select is(public.chat_react((select id from t_m where name = 'a1'), '🔥') ->> 'b3000000-0000-0000-0000-0000000000f9', '🔥', 'another emoji replaces it');
select ok(not (public.chat_react((select id from t_m where name = 'a1'), '🔥') ? 'b3000000-0000-0000-0000-0000000000f9'), 'the same emoji again takes it back');
select throws_ok(format('select public.chat_react(%L::uuid, %L)', (select id from t_m where name = 'a1'), 'zo''r'), '22023', null, 'words are not a reaction');
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000f9', true);
select throws_ok(format('select public.chat_react(%L::uuid, %L)', (select id from t_m where name = 'a1'), '👍'), 'P0002', null, 'nobody outside the conversation reacts');

-- Pins.
select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-0000000000f9', true);
select ok((public.chat_pin((select id from t_m where name = 'b1'), true)).pinned_at is not null, 'a message is pinned');
select ok((public.chat_pin((select id from t_m where name = 'b1'), false)).pinned_at is null, 'and unpinned');

-- Forwarding: B's message, from A's conversation with B into A's with C.
select is(public.chat_forward(array[(select id from t_m where name = 'b1')], array[(select id from t_ac)]), 1, 'A passes B''s message on to C');
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000f9', true);
select is((select forward_from_name from public.chat_messages where conversation_id = (select id from t_ac) and forward_from_id = 'b3000000-0000-0000-0000-0000000000f9'),
  'Barno', 'C sees whom it first came from');
select throws_ok(format('select public.chat_forward(array[%L::uuid], array[%L::uuid])', (select id from t_m where name = 'b1'), (select id from t_ac)),
  'P0002', null, 'C cannot forward a message C never saw');

-- Deleting: for oneself, or one's own for both.
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-0000000000f9', true);
select is(public.chat_delete(array[(select id from t_m where name = 'a1')], false), 1, 'B hides A''s message from B''s own view');
select is((select count(*)::integer from public.chat_messages where id = (select id from t_m where name = 'a1')), 0, 'B no longer sees it');
select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-0000000000f9', true);
select is((select count(*)::integer from public.chat_messages where id = (select id from t_m where name = 'a1')), 1, 'A still does');
select throws_ok(format('select public.chat_delete(array[%L::uuid], true)', (select id from t_m where name = 'b1')), '42501', null,
  'nobody takes back someone else''s message for both');
select is(public.chat_delete(array[(select id from t_m where name = 'a1')], true), 1, 'A takes A''s own message back for both');
select is((select body || '|' || (deleted_at is not null)::text from public.chat_messages where id = (select id from t_m where name = 'a1')), '|true',
  'it stays only as an empty tombstone');

-- Albums: A's own uploads in this conversation, two to ten.
reset role;
insert into storage.objects (bucket_id, name, owner) values
  ('chat-media', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/1.jpg', 'a3000000-0000-0000-0000-0000000000f9'),
  ('chat-media', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/2.jpg', 'a3000000-0000-0000-0000-0000000000f9');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-0000000000f9', true);
insert into t_m select 'album', (public.chat_send((select id from t_ab), 'album', '', p_items => jsonb_build_array(
  jsonb_build_object('path', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/1.jpg', 'width', 800, 'height', 600),
  jsonb_build_object('path', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/2.jpg', 'width', 600, 'height', 800)))).id;
select is((select jsonb_array_length(items) from public.chat_messages where id = (select id from t_m where name = 'album')), 2, 'two pictures go as one album');
select throws_ok(format('select public.chat_send(%L::uuid, %L, %L, p_items => %L::jsonb)', (select id from t_ab), 'album', '', jsonb_build_array(
    jsonb_build_object('path', (select id from t_ab) || '/b3000000-0000-0000-0000-0000000000f9/x.jpg'),
    jsonb_build_object('path', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/1.jpg'))),
  '22023', null, 'an album with someone else''s file in it is refused');

-- A video message in two parts (the camera turned round): both kept, in order; the first part must be the file itself.
reset role;
insert into storage.objects (bucket_id, name, owner) values
  ('chat-media', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/v1.mov', 'a3000000-0000-0000-0000-0000000000f9'),
  ('chat-media', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/v2.mov', 'a3000000-0000-0000-0000-0000000000f9');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-0000000000f9', true);
-- (Sent in its own statement: a query does not see a row its own function call inserts.)
insert into t_m select 'video', (public.chat_send((select id from t_ab), 'video', '', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/v1.mov',
  '{"duration_ms": 9000}'::jsonb, p_items => jsonb_build_array(
    jsonb_build_object('path', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/v1.mov', 'duration_ms', 4000),
    jsonb_build_object('path', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/v2.mov', 'duration_ms', 5000)))).id;
select is((select jsonb_array_length(items) from public.chat_messages where id = (select id from t_m where name = 'video')),
  2, 'a video message keeps its two parts');
select throws_ok(format('select public.chat_send(%L::uuid, %L, %L, %L, %L::jsonb, p_items => %L::jsonb)', (select id from t_ab), 'video', '',
    (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/v1.mov', '{"duration_ms": 9000}', jsonb_build_array(
      jsonb_build_object('path', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/v2.mov'),
      jsonb_build_object('path', (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/v1.mov'))),
  '22023', null, 'the first part must be the message''s own file');

-- Forwarded, the album's pictures open for C in the new conversation.
select public.chat_forward(array[(select id from t_m where name = 'album')], array[(select id from t_ac)]);
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000f9', true);
select is((select count(*)::integer from storage.objects
            where bucket_id = 'chat-media' and name = (select id from t_ab) || '/a3000000-0000-0000-0000-0000000000f9/1.jpg'),
  1, 'a forwarded picture opens in its new conversation');

-- Clearing, and keeping one's history.
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-0000000000f9', true);
select public.chat_protect_history((select id from t_ab), true);
select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-0000000000f9', true);
select throws_ok(format('select public.chat_clear(%L::uuid, true)', (select id from t_ab)), '42501', null,
  'A cannot clear for both while B keeps the history');
select public.chat_clear((select id from t_ab), false);
select is((select count(*)::integer from public.chat_messages where conversation_id = (select id from t_ab)), 0, 'cleared for A, A sees nothing');
select ok((select (listed ->> 'last') is null from jsonb_array_elements(public.chat_list()) as listed where listed ->> 'id' = (select id from t_ab)::text),
  'and the list shows no last message');
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-0000000000f9', true);
select ok((select count(*)::integer from public.chat_messages where conversation_id = (select id from t_ab)) > 0, 'B still has everything');

-- Reports reach the admins only.
select ok(public.chat_report((select id from t_ab), 'spam') is not null, 'B reports A');
select throws_ok($$select * from public.chat_reports$$, '42501', null, 'reports are not readable by users');
select throws_ok($$select public.admin_chat_reports()$$, '42501', null, 'and the admins'' list is for admins');
select throws_ok(format('select public.chat_report(%L::uuid, %L)', (select id from t_ab), 'boring'), '22023', null, 'a report needs a known reason');

-- Blocked (202611170002): nobody pins, and nobody clears for both.
select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-0000000000f9', true);
select public.chat_block('b3000000-0000-0000-0000-0000000000f9');
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-0000000000f9', true);
select throws_ok(format('select public.chat_pin(%L::uuid, true)', (select id from t_m where name = 'b1')), '42501',
  'Bu foydalanuvchiga xabar yuborib bo‘lmaydi.', 'between blocked people nobody pins');
select throws_ok(format('select public.chat_clear(%L::uuid, true)', (select id from t_ab)), '42501',
  'Bu foydalanuvchiga xabar yuborib bo‘lmaydi.', 'nor clears the history for both');

select * from finish();
rollback;
