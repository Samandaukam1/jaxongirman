begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

/*
 * Devices: a new one is announced, the older one may remove it at once, and
 * the new one may remove an older one only after two hours.
 *
 *   A  the owner's phone, signed in three hours ago
 *   B  a new browser, signed in just now
 *   C  another new device, signed in a minute after B
 */

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '91000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'd@example.com', '', now(), '{}', '{"full_name":"D"}', now(), now());

insert into auth.sessions (id, user_id, created_at, updated_at, user_agent) values
  ('9a000000-0000-0000-0000-00000000000a', '91000000-0000-0000-0000-000000000001', now() - interval '3 hours', now(), 'Jaxongirman/43 CFNetwork Darwin'),
  ('9b000000-0000-0000-0000-00000000000b', '91000000-0000-0000-0000-000000000001', now() - interval '2 minutes', now(), 'Mozilla/5.0 (Macintosh) Chrome/131.0'),
  ('9c000000-0000-0000-0000-00000000000c', '91000000-0000-0000-0000-000000000001', now() - interval '1 minute', now(), 'okhttp/4.12');

set local role authenticated;

-- A names itself: the account's only named device has nobody to ask.
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"9a000000-0000-0000-0000-00000000000a"}';
select is(public.device_register('ios', 'iPhone 15', '0.1.0') ->> 'active', 'true', 'a signed-in device registers');

-- B appears: A is told.
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"9b000000-0000-0000-0000-00000000000b"}';
select is(public.device_register('web', 'Chrome · macOS', null) ->> 'new', 'true', 'a new device registers');
select is((select count(*)::int from public.notifications where user_id = '91000000-0000-0000-0000-000000000001' and kind = 'new_device'),
  1, 'the account hears of the new device, and only of it — A, signed in hours ago, is not news');
select is((select count(*)::int from public.device_alerts()), 0, 'B is not asked about itself');

set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"9a000000-0000-0000-0000-00000000000a"}';
select ok(exists(select 1 from public.device_alerts() where session_id = '9b000000-0000-0000-0000-00000000000b'), 'A sees “is this you?” for B');

-- B, just signed in, may not remove A; it sees when it may.
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"9b000000-0000-0000-0000-00000000000b"}';
select is((select can_revoke from public.device_list() where session_id = '9a000000-0000-0000-0000-00000000000a'), false,
  'a new device may not remove an older one');
select ok((select revoke_from from public.device_list() where session_id = '9a000000-0000-0000-0000-00000000000a') > now() + interval '1 hour',
  '...and is told it may in about two hours');
select throws_ok($$ select public.device_revoke('9a000000-0000-0000-0000-00000000000a') $$,
  '42501', 'Avval kirilgan qurilmani chiqarish uchun bu qurilmada kirganingizga 2 soat bo‘lishi kerak.', 'the server refuses it too');
select is((select can_revoke from public.device_list() where session_id = '9c000000-0000-0000-0000-00000000000c'), true,
  'but it may remove a device newer than itself');
select throws_ok($$ select public.device_revoke('9b000000-0000-0000-0000-00000000000b') $$,
  '22023', null, 'a device does not remove itself this way');

-- A answers "no": B is out at once.
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"9a000000-0000-0000-0000-00000000000a"}';
select lives_ok($$ select public.device_revoke('9b000000-0000-0000-0000-00000000000b') $$, 'the older device removes the new one at once');
reset role;
select is((select count(*)::int from auth.sessions where id = '9b000000-0000-0000-0000-00000000000b'), 0, 'its session is gone');
set local role authenticated;

set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"9b000000-0000-0000-0000-00000000000b"}';
select is(public.device_register('web', 'Chrome · macOS', null) ->> 'active', 'false', 'and the removed device learns it is signed out');

-- "Yes, it's me" for C, then everything else out.
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"9c000000-0000-0000-0000-00000000000c"}';
select is(public.device_register('android', 'Pixel 8', '0.1.0') ->> 'active', 'true', 'C registers');
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"9a000000-0000-0000-0000-00000000000a"}';
select public.device_confirm('9c000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.device_alerts()), 0, 'a confirmed device stops asking');
select is(public.device_revoke_others() ->> 'revoked', '1', 'the owner takes every other device out');

select * from finish();
rollback;
