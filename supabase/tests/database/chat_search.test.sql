begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

/*
 * The chat tab's one search box: people anywhere by name or handle, and words
 * in one's own conversations — never someone who blocked the caller, never a
 * message the caller cannot see.
 *
 * Anvar searches. Qumri Ş. and Qumrinisa are findable; Qumri K. blocked
 * Anvar; Qumri F. is a closed account; Qumri H. never chose a handle.
 */
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a5000000-0000-0000-0000-0000000000fa', 'authenticated', 'authenticated',
   'search-a@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Anvar Aliyev"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b5000000-0000-0000-0000-0000000000fa', 'authenticated', 'authenticated',
   'search-b@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Qumri Şodiyeva"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-0000-0000-0000000000fa', 'authenticated', 'authenticated',
   'search-c@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Qumri Karimova"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5000000-0000-0000-0000-0000000000fa', 'authenticated', 'authenticated',
   'search-e@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Qumrinisa"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f5000000-0000-0000-0000-0000000000fa', 'authenticated', 'authenticated',
   'search-f@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Qumri Faol Emas"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd5000000-0000-0000-0000-0000000000fa', 'authenticated', 'authenticated',
   'search-d@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Qumri Handlesiz"}', now(), now());

update public.profiles set username = 'anvar_qs' where id = 'a5000000-0000-0000-0000-0000000000fa';
update public.profiles set username = 'qumri_b1' where id = 'b5000000-0000-0000-0000-0000000000fa';
update public.profiles set username = 'qumri_c1' where id = 'c5000000-0000-0000-0000-0000000000fa';
update public.profiles set username = 'eldor_e1' where id = 'e5000000-0000-0000-0000-0000000000fa';
update public.profiles set username = 'qumri_f1', status = 'blocked' where id = 'f5000000-0000-0000-0000-0000000000fa';

select ok(not has_function_privilege('anon', 'public.chat_search_people(text, integer)', 'EXECUTE'), 'a signed-out caller cannot search people');
select ok(not has_function_privilege('anon', 'public.chat_search_messages(text, integer)', 'EXECUTE'), 'nor messages');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
create temporary table t_c (name text, id uuid);
create temporary table t_m (name text, id uuid);
grant all on t_c, t_m to authenticated;

-- Qumri K. blocks Anvar.
select set_config('request.jwt.claim.sub', 'c5000000-0000-0000-0000-0000000000fa', true);
select public.chat_block('a5000000-0000-0000-0000-0000000000fa');

/* ---------------------------------------------------------------- people */
select set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-0000000000fa', true);
select is((select array_agg(username order by ordinality) from public.chat_search_people('qumri') with ordinality),
  array['qumri_b1', 'eldor_e1'],
  'by name or handle: a handle that begins with it first, then a name; not the blocker, the closed account or the one without a handle');
select is((select array_agg(username) from public.chat_search_people('@qumri')), array['qumri_b1'], 'a leading @ matches handles only');
select ok(exists (select 1 from public.chat_search_people('shodiyeva') where username = 'qumri_b1'), 'Ş in a name is found by sh');
select ok(not exists (select 1 from public.chat_search_people('anvar_qs') where username = 'anvar_qs'), 'the caller never finds themself');
select is((select count(*)::integer from public.chat_search_people('qumri_c1')), 0, 'nor someone who blocked them, even by the full handle');
select is((select count(*)::integer from public.chat_search_people('q')), 0, 'one letter finds nobody');
select is((select count(*)::integer from public.chat_search_people('%%')), 0, '% matches itself, not everyone');
select is((select count(*)::integer from public.chat_search_people('__')), 0, 'and so does _');
select is((select array_agg(username order by ordinality) from public.chat_search_people('eldor_e1') with ordinality), array['eldor_e1'], 'the full handle finds its owner');

select set_config('request.jwt.claim.sub', 'c5000000-0000-0000-0000-0000000000fa', true);
select ok(exists (select 1 from public.chat_search_people('anvar') where username = 'anvar_qs'), 'whoever blocked someone still finds them, to unblock');

select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::integer from public.chat_search_people('qumri')), 0, 'nobody signed in, nobody found');

/* -------------------------------------------------------------- messages */
select set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-0000000000fa', true);
insert into t_c select 'ab', public.chat_open_direct('b5000000-0000-0000-0000-0000000000fa');
insert into t_c select 'ae', public.chat_open_direct('e5000000-0000-0000-0000-0000000000fa');
select set_config('request.jwt.claim.sub', 'b5000000-0000-0000-0000-0000000000fa', true);
insert into t_c select 'be', public.chat_open_direct('e5000000-0000-0000-0000-0000000000fa');

select set_config('request.jwt.claim.sub', 'b5000000-0000-0000-0000-0000000000fa', true);
insert into t_m select 'm1', (public.chat_send((select id from t_c where name = 'ab'), 'text', 'Kutubxona soat 9 da ochiladi')).id;
insert into t_m select 'm5', (public.chat_send((select id from t_c where name = 'be'), 'text', 'Kutubxona haqida bir sir')).id;
insert into t_m select 'm7', (public.chat_send((select id from t_c where name = 'ab'), 'text', 'Şahar markazida uchrashamiz')).id;
select set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-0000000000fa', true);
insert into t_m select 'm2', (public.chat_send((select id from t_c where name = 'ab'), 'text', 'Men ham kutubxonaga kelaman')).id;
insert into t_m select 'm6', (public.chat_send((select id from t_c where name = 'ab'), 'text', repeat('juda uzun gap ', 10) || 'oltin kalit bor')).id;
select set_config('request.jwt.claim.sub', 'e5000000-0000-0000-0000-0000000000fa', true);
insert into t_m select 'm4', (public.chat_send((select id from t_c where name = 'ae'), 'text', 'Kutubxona yonida kutaman')).id;

-- One transaction, one now(): the messages are spread out by hand.
reset role;
update public.chat_messages set created_at = now() - interval '5 minutes' where id = (select id from t_m where name = 'm1');
update public.chat_messages set created_at = now() - interval '4 minutes' where id = (select id from t_m where name = 'm2');
update public.chat_messages set created_at = now() - interval '3 minutes' where id = (select id from t_m where name = 'm4');
update public.chat_messages set created_at = now() - interval '2 minutes' where id in (select id from t_m where name in ('m5', 'm6', 'm7'));
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-0000000000fa', true);
select is((select array_agg(s.id order by ordinality) from public.chat_search_messages('kutubxona') with ordinality s),
  array[(select id from t_m where name = 'm4'), (select id from t_m where name = 'm2'), (select id from t_m where name = 'm1')],
  'words in one''s own conversations, newest first; never a conversation one is not in');
select is((select peer_id from public.chat_search_messages('kutubxona') where id = (select id from t_m where name = 'm4')),
  'e5000000-0000-0000-0000-0000000000fa'::uuid, 'each with whom the conversation is');
select is((select count(*)::integer from public.chat_search_messages('KUTUBXONA')), 3, 'case does not matter');
select is((select id from public.chat_search_messages('shahar')), (select id from t_m where name = 'm7'), 'Ş in a message is found by sh');
select ok((select left(body, 1) = '…' and body like '%oltin kalit%' from public.chat_search_messages('oltin kalit')),
  'deep in a long message, the text shown starts near the words');
select is((select count(*)::integer from public.chat_search_messages('k')), 0, 'one letter finds nothing');
select is((select count(*)::integer from public.chat_search_messages('%%')), 0, '% matches itself, not every message');

select set_config('request.jwt.claim.sub', 'c5000000-0000-0000-0000-0000000000fa', true);
select is((select count(*)::integer from public.chat_search_messages('kutubxona')), 0, 'a stranger to every conversation finds nothing');

-- Anvar hides Barno's message for himself.
select set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-0000000000fa', true);
select is(public.chat_delete(array[(select id from t_m where name = 'm1')], false), 1, 'Anvar hides a message for himself');
select ok(not exists (select 1 from public.chat_search_messages('kutubxona') where id = (select id from t_m where name = 'm1')),
  'and his search no longer finds it');
select set_config('request.jwt.claim.sub', 'b5000000-0000-0000-0000-0000000000fa', true);
select ok(exists (select 1 from public.chat_search_messages('kutubxona') where id = (select id from t_m where name = 'm1')),
  'Barno, who did not hide it, still does');

-- Qumrinisa takes hers back.
select set_config('request.jwt.claim.sub', 'e5000000-0000-0000-0000-0000000000fa', true);
select is(public.chat_delete(array[(select id from t_m where name = 'm4')], true), 1, 'a message is taken back');
select set_config('request.jwt.claim.sub', 'a5000000-0000-0000-0000-0000000000fa', true);
select ok(not exists (select 1 from public.chat_search_messages('kutubxona') where id = (select id from t_m where name = 'm4')),
  'a message taken back is found by nobody');

-- Anvar clears his conversation with Barno, for himself.
select public.chat_clear((select id from t_c where name = 'ab'), false);
select is((select count(*)::integer from public.chat_search_messages('kutubxona')), 0, 'what one cleared is not searched');
select set_config('request.jwt.claim.sub', 'b5000000-0000-0000-0000-0000000000fa', true);
select ok(exists (select 1 from public.chat_search_messages('kutubxona') where id = (select id from t_m where name = 'm2')),
  'while the other side, who kept it, still finds it');

select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::integer from public.chat_search_messages('kutubxona')), 0, 'nobody signed in, nothing found');

select * from finish();
rollback;
