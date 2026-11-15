begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated',
   'chat-a@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Aziz"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated',
   'chat-b@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Barno"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-0000000000f3', 'authenticated', 'authenticated',
   'chat-c@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Chetdagi"}', now(), now());

insert into public.presentations (id, owner_id, title, topic, status, style, requested_slide_count)
values ('d4000000-0000-0000-0000-0000000000f4', 'a1000000-0000-0000-0000-0000000000f1', 'Aziz taqdimoti', 'Mavzu', 'ready', 'simple', 8),
       ('e5000000-0000-0000-0000-0000000000f5', 'b2000000-0000-0000-0000-0000000000f2', 'Barno taqdimoti', 'Mavzu', 'ready', 'simple', 8);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);

create temporary table t_chat as select public.chat_open_direct('b2000000-0000-0000-0000-0000000000f2') as id;
-- A test is one transaction, so now() never moves: membership is dated a minute back.
reset role;
update public.chat_members set last_read_at = now() - interval '1 minute' where conversation_id = (select id from t_chat);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);
select is(public.chat_open_direct('b2000000-0000-0000-0000-0000000000f2'), (select id from t_chat), 'two people have one conversation');
select throws_ok($$select public.chat_open_direct('a1000000-0000-0000-0000-0000000000f1')$$, '22023', null, 'not with oneself');

create temporary table t_first as
  select public.chat_send((select id from t_chat), 'text', '  Salom!  ', p_client_id => 'one') as row;
select is((select (row).body from t_first), 'Salom!', 'a message is sent, trimmed');
select is((public.chat_send((select id from t_chat), 'text', 'Salom!', p_client_id => 'one')).id, (select (row).id from t_first),
  'the same send twice is one message');
select is((select count(*)::integer from public.chat_messages), 1, 'and only one row');
select throws_ok(format('select public.chat_send(%L::uuid, %L, %L)', (select id from t_chat), 'text', '   '), '22023', null, 'an empty message is refused');
select throws_ok($$insert into public.chat_messages (conversation_id, sender_id, kind, body)
                   values ((select id from t_chat), 'a1000000-0000-0000-0000-0000000000f1', 'text', 'x')$$,
  '42501', null, 'messages are written only through chat_send');

-- Files must be the sender's own upload into this conversation.
select throws_ok(format('select public.chat_send(%L::uuid, %L, %L, %L)', (select id from t_chat), 'image', '', (select id from t_chat) || '/a1000000-0000-0000-0000-0000000000f1/none.jpg'),
  '22023', null, 'a picture that was never uploaded is refused');
reset role;
insert into storage.objects (bucket_id, name, owner) values
  ('chat-media', (select id from t_chat) || '/a1000000-0000-0000-0000-0000000000f1/photo.jpg', 'a1000000-0000-0000-0000-0000000000f1'),
  ('chat-media', (select id from t_chat) || '/a1000000-0000-0000-0000-0000000000f1/voice.m4a', 'a1000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);
select is((public.chat_send((select id from t_chat), 'image', '', (select id from t_chat) || '/a1000000-0000-0000-0000-0000000000f1/photo.jpg', '{"width": 800, "height": 600}')).kind,
  'image', 'an uploaded picture is sent');
select throws_ok(format('select public.chat_send(%L::uuid, %L, %L, %L, %L::jsonb)', (select id from t_chat), 'voice', '',
    (select id from t_chat) || '/a1000000-0000-0000-0000-0000000000f1/voice.m4a', '{"duration_ms": 180000}'),
  '22023', null, 'a voice message longer than two minutes is refused');

select is((public.chat_send((select id from t_chat), 'share', '', p_share => '{"kind": "presentation", "id": "d4000000-0000-0000-0000-0000000000f4", "title": "Boshqa nom"}')).share ->> 'title',
  'Aziz taqdimoti', 'one''s own deck is shared, under its real title');
select throws_ok($$select public.chat_send((select id from t_chat), 'share', '', p_share => '{"kind": "presentation", "id": "e5000000-0000-0000-0000-0000000000f5"}')$$,
  '22023', null, 'someone else''s deck cannot be shared');

-- ------------------------------------------------------------- the other --
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000f2', true);
select is((select count(*)::integer from public.chat_messages), 3, 'the other member reads the conversation');
select is((public.chat_list() -> 0 ->> 'unread')::integer, 3, 'and has three unread');
select is((public.chat_list() -> 0 -> 'peer' ->> 'full_name'), 'Aziz', 'the list says who it is with');
select is(public.chat_unread_total(), 3, 'the tab counts them');
insert into public.chat_contacts (owner_id, contact_id, display_name, muted)
values ('b2000000-0000-0000-0000-0000000000f2', 'a1000000-0000-0000-0000-0000000000f1', 'Aziz aka', true);
select is(public.chat_unread_total(), 0, 'a muted contact does not count towards the badge');
select is((public.chat_list() -> 0 -> 'peer' ->> 'contact_name'), 'Aziz aka', 'a saved name is shown');
select public.chat_mark_read((select id from t_chat));
select is((public.chat_list() -> 0 ->> 'unread')::integer, 0, 'read is read');

-- ------------------------------------------------------------- a stranger --
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000f3', true);
select is((select count(*)::integer from public.chat_messages), 0, 'a stranger reads nothing');
select is(jsonb_array_length(public.chat_list()), 0, 'and lists nothing');
select throws_ok(format('select public.chat_send(%L::uuid, %L, %L)', (select id from t_chat), 'text', 'Men ham'), 'P0002', null,
  'nor can they write into it');

select * from finish();
rollback;
