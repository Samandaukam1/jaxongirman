begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-0000000000f8', 'authenticated', 'authenticated',
   'block-a@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Anvar"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-0000000000f8', 'authenticated', 'authenticated',
   'block-b@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Barno"}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
create temporary table t_chat (id uuid);
grant all on t_chat to authenticated;

-- B is here.
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000f8', true);
select public.chat_touch(true);

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f8', true);
insert into t_chat select public.chat_open_direct('b2000000-0000-0000-0000-0000000000f8');
select lives_ok($$select public.chat_send((select id from t_chat), 'text', 'Salom')$$, 'before any block, a message goes');
select is((public.chat_profile('b2000000-0000-0000-0000-0000000000f8')) ->> 'online', 'true', 'and A sees B online');
select throws_ok($$select public.chat_block('a1000000-0000-0000-0000-0000000000f8')$$, '22023', null, 'nobody blocks themselves');

-- A blocks B.
select public.chat_block('b2000000-0000-0000-0000-0000000000f8');
select is((public.chat_profile('b2000000-0000-0000-0000-0000000000f8')) ->> 'blocked', 'true', 'A sees B as blocked');
select throws_ok($$select public.chat_send((select id from t_chat), 'text', 'Yana')$$, '42501', null, 'A cannot write to someone A blocked');
select is((public.chat_peer_status('b2000000-0000-0000-0000-0000000000f8')) ->> 'online', 'false', 'nor see whether they are here');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000f8', true);
select throws_ok($$select public.chat_send((select id from t_chat), 'text', 'Javob')$$, '42501', 'Bu foydalanuvchiga xabar yuborib bo‘lmaydi.',
  'B cannot write to A — and is told only that it cannot be delivered');
select is((public.chat_profile('a1000000-0000-0000-0000-0000000000f8')) ->> 'blocked', 'false', 'B is not told B was blocked');
select ok((public.chat_profile('a1000000-0000-0000-0000-0000000000f8')) -> 'last_seen_at' = 'null'::jsonb, 'and sees no last-seen time of A''s');
select is((select count(*)::integer from public.chat_blocks), 0, 'B cannot read A''s block list');

-- A unblocks; B goes to the background.
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f8', true);
select public.chat_unblock('b2000000-0000-0000-0000-0000000000f8');
select lives_ok($$select public.chat_send((select id from t_chat), 'text', 'Kechirasiz')$$, 'unblocked, the conversation goes on');
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000f8', true);
select public.chat_touch(false);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f8', true);
select is((public.chat_peer_status('b2000000-0000-0000-0000-0000000000f8')) ->> 'online', 'false', 'a phone in the background is not online');
select ok((public.chat_peer_status('b2000000-0000-0000-0000-0000000000f8')) ->> 'last_seen_at' is not null, 'but when it was last here is known');
select throws_ok('select * from public.chat_presence', '42501', null, 'presence is read only through the functions');

-- Editing: the sender corrects their own words, within 48 hours.
create temporary table t_msg as select (public.chat_send((select id from t_chat), 'text', 'Ertaga kelaman')).id as id;
select is((public.chat_edit((select id from t_msg), 'Indinga kelaman')).body, 'Indinga kelaman', 'the sender corrects a message');
select ok((select edited_at is not null from public.chat_messages where id = (select id from t_msg)), 'and it is marked edited');
select throws_ok($$select public.chat_edit((select id from t_msg), '   ')$$, '22023', null, 'a message cannot be edited into nothing');
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000f8', true);
select throws_ok($$select public.chat_edit((select id from t_msg), 'Buzildi')$$, 'P0002', null, 'nobody edits someone else''s message');
reset role;
update public.chat_messages set created_at = now() - interval '3 days' where id = (select id from t_msg);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f8', true);
select throws_ok($$select public.chat_edit((select id from t_msg), 'Kech')$$, '22023', null, 'and not after 48 hours');

select * from finish();
rollback;
