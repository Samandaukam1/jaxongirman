begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated',
   'teacher@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Teacher"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated',
   'other@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Other"}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000d1', true);

insert into public.tests (id, owner_id, title, option_count)
values ('c3000000-0000-0000-0000-0000000000d3', 'a1000000-0000-0000-0000-0000000000d1', 'Sinov testi', 4);

insert into public.test_questions (test_id, owner_id, position, prompt, options, correct) values
  ('c3000000-0000-0000-0000-0000000000d3', 'a1000000-0000-0000-0000-0000000000d1', 0, '2+2?', '["3","4","5","6"]', 1),
  ('c3000000-0000-0000-0000-0000000000d3', 'a1000000-0000-0000-0000-0000000000d1', 1, 'Poytaxt?', '["Toşkent","Samarqand","Buxoro","Xiva"]', 0),
  ('c3000000-0000-0000-0000-0000000000d3', 'a1000000-0000-0000-0000-0000000000d1', 5, 'Eng katta?', '["1","2","3","9"]', 3);

select is((select question_count from public.tests where id = 'c3000000-0000-0000-0000-0000000000d3'), 3,
  'the test counts its questions');

select throws_ok(
  $$insert into public.test_questions (test_id, owner_id, position, prompt, options, correct)
    values ('c3000000-0000-0000-0000-0000000000d3', 'a1000000-0000-0000-0000-0000000000d1', 6, 'x', '["a","b","c"]', 0)$$,
  '22023', null, 'every question has the test''s number of options — the sheet has that many bubbles');
select throws_ok(
  $$update public.tests set option_count = 5 where id = 'c3000000-0000-0000-0000-0000000000d3'$$,
  '42501', null, 'the app cannot change the number of options at all');

select is((public.test_save_result('c3000000-0000-0000-0000-0000000000d3', 'Ali', '[1, 0, 3]'::jsonb)).score, 3,
  'all right: three of three');
select is((public.test_save_result('c3000000-0000-0000-0000-0000000000d3', 'Vali', '[1, null, 2]'::jsonb)).score, 1,
  'a blank and a wrong answer score nothing');
select is((public.test_save_result('c3000000-0000-0000-0000-0000000000d3', 'Vali', '[1, null, 2]'::jsonb)).total, 3,
  'out of the number of questions');
select is((public.test_save_result('c3000000-0000-0000-0000-0000000000d3', '', '[0, 0, 3]'::jsonb, 'manual')).source, 'manual',
  'a sheet typed in by hand says so');
select is((select score from public.test_results where student_name = 'Ali'), 3,
  'the third question is graded third although its stored position is 5');
select throws_ok(
  $$select public.test_save_result('c3000000-0000-0000-0000-0000000000d3', 'X', '[1, 0]'::jsonb)$$,
  '22023', null, 'one answer per question, no fewer');
select throws_ok(
  $$select public.test_save_result('c3000000-0000-0000-0000-0000000000d3', 'X', '[1, 0, 7]'::jsonb)$$,
  '22023', null, 'an answer outside the options is refused');
select throws_ok(
  $$insert into public.test_results (test_id, owner_id, answers, score, total)
    values ('c3000000-0000-0000-0000-0000000000d3', 'a1000000-0000-0000-0000-0000000000d1', '[]', 99, 3)$$,
  '42501', null, 'a score cannot be written by the app, only graded here');

-- ------------------------------------------------------------- a stranger --
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000d2', true);
select is((select count(*)::integer from public.tests), 0, 'a stranger sees no tests');
select is((select count(*)::integer from public.test_questions), 0, 'nor their answer keys');
select throws_ok(
  $$select public.test_save_result('c3000000-0000-0000-0000-0000000000d3', 'X', '[1, 0, 3]'::jsonb)$$,
  'P0002', null, 'nor can they grade against them');

select * from finish();
rollback;
