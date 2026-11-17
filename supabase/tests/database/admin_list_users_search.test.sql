begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'first@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Aziz Karimov"}', now() - interval '3 days', now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'second@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Bobur"}', now() - interval '2 days', now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'third@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"No Handle"}', now() - interval '1 day', now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'admin@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Admin"}', now(), now());

-- Two handles that share letters, so the exact one has something to outrank;
-- the newest account has no handle at all.
update public.profiles set username = 'sardor' where id = '10000000-0000-0000-0000-000000000001';
update public.profiles set username = 'sardor_uz' where id = '10000000-0000-0000-0000-000000000002';

insert into public.user_roles (user_id, role, granted_by)
values ('30000000-0000-0000-0000-000000000003', 'admin', '30000000-0000-0000-0000-000000000003');

-- Plain users first: the list is for administrators only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select * from public.admin_list_users('sardor', 10, 0) $$,
  '42501', 'admin role required',
  'a person who is not an administrator cannot list users'
);

set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select array_agg(username order by ord) from public.admin_list_users('sardor', 10, 0) with ordinality as r(user_id, email, full_name, status, credits, reserved_credits, presentation_count, created_at, last_seen_at, username, ord)),
  array['sardor', 'sardor_uz'],
  'a username finds its person, and the exact handle comes before longer ones that contain it'
);
select is(
  (select array_agg(username order by ord) from public.admin_list_users('@sardor', 10, 0) with ordinality as r(user_id, email, full_name, status, credits, reserved_credits, presentation_count, created_at, last_seen_at, username, ord)),
  array['sardor', 'sardor_uz'],
  'the handle can be typed with its "@"'
);
select is(
  (select array_agg(username order by ord) from public.admin_list_users('  SARDOR_UZ ', 10, 0) with ordinality as r(user_id, email, full_name, status, credits, reserved_credits, presentation_count, created_at, last_seen_at, username, ord)),
  array['sardor_uz'],
  'case and surrounding spaces do not matter'
);
select is(
  (select array_agg(username order by ord) from public.admin_list_users('dor_', 10, 0) with ordinality as r(user_id, email, full_name, status, credits, reserved_credits, presentation_count, created_at, last_seen_at, username, ord)),
  array['sardor_uz'],
  'part of a handle finds it, and "_" is a letter rather than a wildcard'
);
select is(
  (select count(*)::int from public.admin_list_users('sardorx', 10, 0)),
  0, 'a handle nobody has finds nobody'
);
select is(
  (select username from public.admin_list_users('sardor', 1, 0)),
  'sardor', 'with room for one row, the exact handle is that row'
);
select is(
  (select full_name from public.admin_list_users('second@example', 10, 0)),
  'Bobur', 'email still finds people'
);
select is(
  (select email from public.admin_list_users('aziz', 10, 0)),
  'first@example.com', 'name still finds people'
);
select is(
  (select username from public.admin_list_users('Bobur', 10, 0)),
  'sardor_uz', 'the username comes back with each row'
);
select is(
  (select username from public.admin_list_users('No Handle', 10, 0)),
  null, 'a person without a handle is listed with none'
);
select is(
  (select count(*)::int from public.admin_list_users(null, 100, 0)
    where user_id::text like '10000000-%' or user_id::text like '30000000-%'),
  4, 'with no search, everyone is listed'
);

select * from finish();
rollback;
