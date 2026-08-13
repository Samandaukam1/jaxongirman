begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'c1110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'qrvideo-admin@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c2220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'qrvideo-user@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"User"}', now(), now());

insert into public.user_roles (user_id, role) values
  ('c1110000-0000-0000-0000-000000000001', 'admin');

-- ------------------------------------------------------------- privileges --

select ok(not has_function_privilege('anon',
  'public.admin_save_qr_video_experience(public.qr_video_surface, boolean, text, text, integer, numeric, numeric, numeric, text, text, text, text, numeric)',
  'EXECUTE'),
  'a signed-out caller cannot change what the projectors play');
select ok(not has_table_privilege('authenticated', 'public.qr_video_experiences', 'UPDATE'),
  'no client can write the row directly — every change goes through the RPC');
select ok(not has_table_privilege('authenticated', 'public.qr_video_experiences', 'INSERT'),
  'and no client can add a surface of its own');

-- The projector is signed out. Without this the feature cannot exist at all.
select ok(has_table_privilege('anon', 'public.qr_video_experiences', 'SELECT'),
  'a signed-out screen can read the experience');

-- A scanned code lands on a page that has to ask whether it is still good.
select ok(has_function_privilege('anon', 'public.presentation_pair_info(text)', 'EXECUTE'),
  'the pair landing can check a code without signing in');
select ok(has_function_privilege('anon', 'public.game_pair_info(text)', 'EXECUTE'),
  'and so can the match landing');

-- ------------------------------------------------------------- the surfaces

select is(
  (select count(*)::integer from public.qr_video_experiences),
  2,
  'there is exactly one row per surface');
select is(
  (select count(*)::integer from public.qr_video_experiences where is_enabled),
  0,
  'and both start switched off, so nothing changes until an admin says so');

-- The reference design is what an untouched row already holds.
select is((select qr_appear_ms from public.qr_video_experiences where surface = 'taqdimot'), 5060,
  'the code appears at 5.06 seconds by default');
select is((select qr_x from public.qr_video_experiences where surface = 'taqdimot'), 46.8::numeric,
  'the reference X');
select is((select qr_y from public.qr_video_experiences where surface = 'taqdimot'), 66::numeric,
  'the reference Y');
select is((select qr_size from public.qr_video_experiences where surface = 'taqdimot'), 18.3::numeric,
  'the reference width');
select is((select gradient_from || ' ' || gradient_via || ' ' || gradient_to
             from public.qr_video_experiences where surface = 'taqdimot'),
  '#A855F7 #7C3AED #4F46E5',
  'the reference gradient');

-- ------------------------------------------------------------------ writes

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c2220000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$ select public.admin_save_qr_video_experience('taqdimot', true) $$,
  '42501',
  'forbidden',
  'an ordinary account cannot publish an experience');

select set_config('request.jwt.claim.sub', 'c1110000-0000-0000-0000-000000000001', true);

-- Enabling a surface with no footage would black out the projector, so the
-- database refuses it rather than trusting the console to.
select throws_ok(
  $$ select public.admin_save_qr_video_experience('taqdimot', true) $$,
  '23514',
  null,
  'a surface cannot be enabled with nothing to play');

-- An object key, never a path that climbs out of the bucket or a URL pointing
-- somewhere else entirely.
select throws_ok(
  $$ select public.admin_save_qr_video_experience(
       'taqdimot', false, '../../secret.mp4', 'taqdimot/loop.mp4') $$,
  '22023', 'unsafe_asset',
  'a video path that climbs out of its prefix is refused');
select throws_ok(
  $$ select public.admin_save_qr_video_experience(
       'taqdimot', false, 'taqdimot/intro.mp4', 'https://elsewhere.example/loop.mp4') $$,
  '22023', 'unsafe_asset',
  'and so is a path that is really a URL');

select throws_ok(
  $$ select public.admin_save_qr_video_experience(
       'taqdimot', false, 'taqdimot/intro.mp4', 'taqdimot/loop.mp4', 5060,
       46.8, 66, 18.3, 'purple') $$,
  '23514',
  null,
  'a colour that is not a hex triplet is refused');

select lives_ok(
  $$ select public.admin_save_qr_video_experience(
       'taqdimot', true, 'taqdimot/intro.mp4', 'taqdimot/loop.mp4', 5060,
       46.8, 66, 18.3, '#a855f7', '#7c3aed', '#4f46e5', '#ffffff', 0.35) $$,
  'an admin can publish a complete experience');

select is(
  (select gradient_from from public.qr_video_experiences where surface = 'taqdimot'),
  '#A855F7',
  'colours are stored in one case, so two spellings are not two designs');

select is(
  (select count(*)::integer from public.admin_audit_logs
     where target_type = 'qr_video_experience' and action = 'qr_video.saved'),
  1,
  'publishing an experience is audited');

-- --------------------------------------------------------------- who sees it

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);

select is(
  (select count(*)::integer from public.qr_video_experiences),
  1,
  'a signed-out screen sees only the surfaces that are switched on');
select is(
  (select surface::text from public.qr_video_experiences),
  'taqdimot',
  'and it is the one that was enabled');

-- The landing behind a scanned code learns whether the code is live, and
-- nothing else — no session, no presenter, no deck.
select is(
  public.presentation_pair_info('nothing-like-a-real-token'),
  '{"live": false}'::jsonb,
  'an unknown presentation code is simply not live');
select is(
  public.game_pair_info('nothing-like-a-real-token'),
  '{"live": false}'::jsonb,
  'an unknown match code is simply not live');
select is(
  (select count(*)::integer from jsonb_object_keys(public.presentation_pair_info('x')) as key),
  1,
  'and the answer carries one key, so nothing can leak through it');

reset role;
select * from finish();
rollback;
