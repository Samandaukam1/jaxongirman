begin;

create extension if not exists pgtap with schema extensions;
select plan(44);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aa110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'host@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bb220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'intruder@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Intruder"}', now(), now());

insert into public.presentations (
  id, owner_id, title, topic, style, status, requested_slide_count, generated_slide_count
) values (
  'cc330000-0000-0000-0000-000000000003',
  'aa110000-0000-0000-0000-000000000001',
  'Remote test deck', 'Remote test topic', 'simple', 'ready', 2, 2
);

insert into public.slides (id, presentation_id, owner_id, position, title) values
  ('dd440000-0000-0000-0000-000000000004', 'cc330000-0000-0000-0000-000000000003', 'aa110000-0000-0000-0000-000000000001', 0, 'First'),
  ('ee550000-0000-0000-0000-000000000005', 'cc330000-0000-0000-0000-000000000003', 'aa110000-0000-0000-0000-000000000001', 1, 'Second');

-- ---------------------------------------------------------------- grants --
-- The projector is signed out, so it must be able to open and refresh a code —
-- and must not be able to do anything else.
select ok(has_function_privilege('anon', 'public.presentation_session_open()', 'EXECUTE'),
  'a signed-out screen can open a session');
select ok(has_function_privilege('anon', 'public.presentation_pairing_rotate(uuid, text)', 'EXECUTE'),
  'a signed-out screen can rotate its code');
select ok(not has_function_privilege('anon', 'public.presentation_command(uuid, text, numeric)', 'EXECUTE'),
  'a signed-out caller cannot drive a session');
select ok(not has_function_privilege('anon', 'public.presentation_pairing_claim(text, uuid)', 'EXECUTE'),
  'a signed-out caller cannot claim a code');
select ok(has_function_privilege('anon', 'public.presentation_screen_snapshot(uuid, text)', 'EXECUTE'),
  'a signed-out screen may use its capability to recover state');
select ok(has_function_privilege('anon', 'public.presentation_screen_command(uuid, text, text, numeric)', 'EXECUTE'),
  'a signed-out screen may use its capability for keyboard navigation');
select ok(not has_function_privilege('anon', 'public.presentation_viewport_commit(uuid, numeric, numeric, numeric, integer)', 'EXECUTE'),
  'a signed-out caller cannot commit a host viewport');
-- Tokens are never handed to a client, not even the host's.
select ok(not has_table_privilege('authenticated', 'public.presentation_pairing_tokens', 'SELECT'),
  'pairing tokens are unreadable by any client');

-- The signed-out policy is a listing, not a lookup — RLS cannot require that a
-- caller already knew the id. So what matters is that the columns reachable
-- that way carry no identity.
select ok(has_column_privilege('anon', 'public.presentation_sessions', 'current_slide', 'SELECT'),
  'the screen can read the slide it must render');
select ok(has_column_privilege('anon', 'public.presentation_sessions', 'translate_x', 'SELECT'),
  'the screen can follow safe viewport translation state');
-- A table-wide grant would cover every column and make the list below
-- decorative. A hosted project's default privileges hand one out, so its
-- absence is the assertion, not an implementation detail.
select ok(not has_table_privilege('anon', 'public.presentation_sessions', 'SELECT'),
  'the screen is granted columns, not the table');
select ok(not has_column_privilege('anon', 'public.presentation_sessions', 'host_user_id', 'SELECT'),
  'a signed-out caller cannot learn who is presenting');
select ok(not has_column_privilege('anon', 'public.presentation_sessions', 'presentation_id', 'SELECT'),
  'a signed-out caller cannot learn which deck is being shown');
select ok(not has_column_privilege('anon', 'public.presentation_sessions', 'screen_token_hash', 'SELECT'),
  'a signed-out caller cannot read the screen capability digest');
select ok(not has_column_privilege('anon', 'public.presentation_sessions', 'realtime_token', 'SELECT'),
  'a signed-out caller cannot list private realtime channels');

-- ------------------------------------------------------------- the code --
create temporary table t_open as select public.presentation_session_open() as payload;

select ok(
  (select payload ->> 'token' from t_open) ~ '^[A-Za-z0-9_-]{32,64}$',
  'the code is opaque and URL-safe'
);
select ok(
  (select payload ->> 'screen_token' from t_open) ~ '^[A-Za-z0-9_-]{32,64}$',
  'the projector receives a separate opaque screen capability'
);
select ok(
  (select payload ->> 'realtime_token' from t_open) ~ '^[A-Za-z0-9_-]{32,64}$',
  'the projector receives a separate opaque realtime channel token'
);
select ok(
  (select count(distinct value) from jsonb_each_text((select payload from t_open))
   where key in ('token', 'screen_token', 'realtime_token')) = 3,
  'pairing, screen and realtime capabilities are independent secrets'
);
-- The QR must not carry identity: nothing in it resembles a uuid.
select ok(
  (select payload ->> 'token' from t_open) !~ '[0-9a-f]{8}-[0-9a-f]{4}',
  'the code contains no user or presentation id'
);

-- Rotating kills the previous code, which is what makes a photographed QR
-- useless rather than merely short-lived.
create temporary table t_rotated as
  select public.presentation_pairing_rotate(
    (select (payload ->> 'session_id')::uuid from t_open),
    (select payload ->> 'token' from t_open)
  ) as payload;

select is(
  (select count(*)::integer from public.presentation_pairing_tokens
   where token = (select payload ->> 'token' from t_open) and expires_at > now()),
  0, 'rotation expires the code it replaced'
);

-- Rotation is destructive and reachable by `anon`, so knowing a session id must
-- not be enough: otherwise a stranger could spin the code faster than anyone
-- can scan it.
select throws_ok(
  format(
    $$select public.presentation_pairing_rotate(%L::uuid, %L)$$,
    (select payload ->> 'session_id' from t_open),
    repeat('a', 43)
  ),
  '42501', null, 'a stranger who knows a session id cannot rotate its code'
);

-- The temp tables were created as the superuser; the assertions below read them
-- as `authenticated`, so the grant has to be explicit.
grant select on t_open, t_rotated to authenticated;

-- ------------------------------------------------------------- claiming --
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa110000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$select public.presentation_command((select (payload ->> 'session_id')::uuid from t_open), 'next')$$,
  '42501', null, 'an unclaimed session cannot be driven'
);

select throws_ok(
  $$select public.presentation_screen_snapshot(
      (select (payload ->> 'session_id')::uuid from t_open), repeat('z', 43)
    )$$,
  '42501', null, 'a guessed screen capability cannot read the session'
);

select throws_ok(
  $$select public.presentation_screen_snapshot(
      (select (payload ->> 'session_id')::uuid from t_open),
      (select payload ->> 'screen_token' from t_open)
    )$$,
  '22023', null, 'even a valid capability cannot fetch a deck before pairing'
);

select throws_ok(
  $$select public.presentation_screen_command(
      (select (payload ->> 'session_id')::uuid from t_open),
      (select payload ->> 'screen_token' from t_open), 'next'
    )$$,
  '22023', null, 'a valid screen capability cannot drive an unclaimed session'
);

create temporary table t_claimed as
  select public.presentation_pairing_claim(
    (select payload ->> 'token' from t_rotated),
    'cc330000-0000-0000-0000-000000000003'
  ) as payload;

select ok(
  (select payload ->> 'session_id' from t_claimed) is not null,
  'the phone claims the session'
);
select is(
  (select payload ->> 'realtime_token' from t_claimed),
  (select payload ->> 'realtime_token' from t_open),
  'only the paired host receives the projector realtime token'
);

-- Single use: the replay guard is the update itself, not a later check.
select throws_ok(
  $$select public.presentation_pairing_claim((select payload ->> 'token' from t_rotated))$$,
  '22023', null, 'a code cannot be claimed twice'
);

-- -------------------------------------------------------------- driving --
select is(
  (public.presentation_viewport_commit(
    (select (payload ->> 'session_id')::uuid from t_open), 2, 100, 50, 0
  )).zoom,
  2.00, 'the paired phone commits the final gesture scale once'
);
select is(
  (select translate_x from public.presentation_sessions
   where id = (select (payload ->> 'session_id')::uuid from t_open)),
  100.0000, 'the viewport snapshot keeps logical horizontal translation'
);
select is(
  (select translate_y from public.presentation_sessions
   where id = (select (payload ->> 'session_id')::uuid from t_open)),
  50.0000, 'the viewport snapshot keeps logical vertical translation'
);

create temporary table t_screen_move as
  select public.presentation_screen_command(
    (select (payload ->> 'session_id')::uuid from t_open),
    (select payload ->> 'screen_token' from t_open),
    'next'
  ) as payload;

select is(
  (select (payload ->> 'current_slide')::integer from t_screen_move),
  1, 'the capability-authorized projector can move with the keyboard'
);
select is(
  (select (payload ->> 'zoom')::numeric from t_screen_move),
  1.00, 'changing slides resets scale'
);
select is(
  (select (payload ->> 'translate_x')::numeric from t_screen_move),
  0.0000, 'changing slides resets horizontal translation'
);
select is(
  (select (payload ->> 'translate_y')::numeric from t_screen_move),
  0.0000, 'changing slides resets vertical translation'
);

create temporary table t_screen_snapshot as
  select public.presentation_screen_snapshot(
    (select (payload ->> 'session_id')::uuid from t_open),
    (select payload ->> 'screen_token' from t_open)
  ) as payload;

select ok(
  not ((select payload from t_screen_snapshot) ?| array['host_user_id', 'screen_token_hash']),
  'the screen snapshot never returns host identity or the stored digest'
);
select is(
  (select payload ->> 'presentation_id' from t_screen_snapshot),
  'cc330000-0000-0000-0000-000000000003',
  'the capability binds the projector to the selected deck'
);

select throws_ok(
  $$select public.presentation_screen_command(
      (select (payload ->> 'session_id')::uuid from t_open), repeat('z', 43), 'previous'
    )$$,
  '42501', null, 'a guessed screen capability cannot issue keyboard commands'
);

select is(
  (public.presentation_command((select (payload ->> 'session_id')::uuid from t_open), 'zoom_in')).zoom,
  1.25, 'zoom in steps by a quarter'
);
select is(
  (public.presentation_command((select (payload ->> 'session_id')::uuid from t_open), 'reset_zoom')).zoom,
  1.00, 'reset returns zoom to one'
);

select set_config('request.jwt.claim.sub', 'bb220000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.presentation_command((select (payload ->> 'session_id')::uuid from t_open), 'next')$$,
  '42501', null, 'another signed-in user cannot drive someone else''s session'
);
select throws_ok(
  $$select public.presentation_viewport_commit(
      (select (payload ->> 'session_id')::uuid from t_open), 2, 20, 20, 1
    )$$,
  '42501', null, 'another signed-in user cannot commit someone else''s viewport'
);

select set_config('request.jwt.claim.sub', 'aa110000-0000-0000-0000-000000000001', true);
select is(
  (public.presentation_command((select (payload ->> 'session_id')::uuid from t_open), 'end')).status::text,
  'ended', 'the host can end the session'
);

reset role;
select * from finish();
rollback;
