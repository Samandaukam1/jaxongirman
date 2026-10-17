begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

/* Signing in on the website with the phone: open, approve, collect once. */

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '81000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'w@example.com', '', now(), '{}', '{"full_name":"W"}', now(), now());

set local role anon;
create temporary table opened on commit drop as
  select public.web_sign_in_open('Mozilla/5.0 (Macintosh) Chrome/131.0') as payload;
grant select on opened to postgres;

select is(length(payload ->> 'token'), 36, 'the QR token is 36 hex characters') from opened;
select is(length(payload ->> 'secret'), 64, 'the browser keeps a 64-character secret') from opened;
select throws_ok($$ select count(*) from public.web_sign_in_sessions $$, '42501', null, 'nobody reads the table directly');

select is((select public.web_sign_in_collect((payload ->> 'session_id')::uuid, payload ->> 'secret') ->> 'status' from opened),
  'pending', 'before the phone answers, the browser hears pending');
select is((select public.web_sign_in_collect((payload ->> 'session_id')::uuid, 'not-the-secret') ->> 'status' from opened),
  'unknown', 'a wrong secret learns nothing');

-- The phone lets it in (what the web-sign-in function does with the service role).
reset role;
update public.web_sign_in_sessions
   set status = 'approved', user_id = '81000000-0000-0000-0000-000000000001', otp_hash = 'hash-for-w', approved_at = now()
 where id = (select (payload ->> 'session_id')::uuid from opened);

set local role anon;
select is((select public.web_sign_in_collect((payload ->> 'session_id')::uuid, 'not-the-secret') ->> 'status' from opened),
  'unknown', 'an approved request still tells a wrong secret nothing');
select is((select public.web_sign_in_collect((payload ->> 'session_id')::uuid, payload ->> 'secret') ->> 'token_hash' from opened),
  'hash-for-w', 'the browser with the secret collects the one-time hash');
select is((select public.web_sign_in_collect((payload ->> 'session_id')::uuid, payload ->> 'secret') ->> 'status' from opened),
  'used', 'and only once');
reset role;
select is((select otp_hash from public.web_sign_in_sessions where id = (select (payload ->> 'session_id')::uuid from opened)),
  null, 'the hash is wiped as it is handed over');

-- An approval nobody collected in time is not handed over late.
set local role anon;
create temporary table late on commit drop as select public.web_sign_in_open(null) as payload;
reset role;
grant select on late to anon;
update public.web_sign_in_sessions
   set status = 'approved', user_id = '81000000-0000-0000-0000-000000000001', otp_hash = 'late-hash', approved_at = now(), expires_at = now() - interval '1 second'
 where id = (select (payload ->> 'session_id')::uuid from late);
set local role anon;
select is((select public.web_sign_in_collect((payload ->> 'session_id')::uuid, payload ->> 'secret') ->> 'status' from late),
  'expired', 'an expired approval is refused');

-- The person sees which browsers they let in.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.web_sign_in_history()), 2, 'both approvals are in the history');
select is((select user_agent from public.web_sign_in_history() where used_at is not null), 'Mozilla/5.0 (Macintosh) Chrome/131.0',
  'with the browser that asked');

-- One address may open thirty requests in ten minutes, not more.
reset role;
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', true);
set local role anon;
select throws_ok($$ select public.web_sign_in_open(null) from generate_series(1, 31) $$,
  '54000', 'Juda ko‘p urinish. Bir necha daqiqadan so‘ng qayta urinib ko‘ring.', 'a flood from one address is stopped');

select * from finish();
rollback;
