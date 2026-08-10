begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aa110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'host@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bb220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'intruder@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Intruder"}', now(), now());

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
-- Tokens are never handed to a client, not even the host's.
select ok(not has_table_privilege('authenticated', 'public.presentation_pairing_tokens', 'SELECT'),
  'pairing tokens are unreadable by any client');

-- The signed-out policy is a listing, not a lookup — RLS cannot require that a
-- caller already knew the id. So what matters is that the columns reachable
-- that way carry no identity.
select ok(has_column_privilege('anon', 'public.presentation_sessions', 'current_slide', 'SELECT'),
  'the screen can read the slide it must render');
-- A table-wide grant would cover every column and make the list below
-- decorative. A hosted project's default privileges hand one out, so its
-- absence is the assertion, not an implementation detail.
select ok(not has_table_privilege('anon', 'public.presentation_sessions', 'SELECT'),
  'the screen is granted columns, not the table');
select ok(not has_column_privilege('anon', 'public.presentation_sessions', 'host_user_id', 'SELECT'),
  'a signed-out caller cannot learn who is presenting');
select ok(not has_column_privilege('anon', 'public.presentation_sessions', 'presentation_id', 'SELECT'),
  'a signed-out caller cannot learn which deck is being shown');

-- ------------------------------------------------------------- the code --
create temporary table t_open as select public.presentation_session_open() as payload;

select ok(
  (select payload ->> 'token' from t_open) ~ '^[A-Za-z0-9_-]{32,64}$',
  'the code is opaque and URL-safe'
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

select ok(
  (public.presentation_pairing_claim((select payload ->> 'token' from t_rotated)) ->> 'session_id') is not null,
  'the phone claims the session'
);

-- Single use: the replay guard is the update itself, not a later check.
select throws_ok(
  $$select public.presentation_pairing_claim((select payload ->> 'token' from t_rotated))$$,
  '22023', null, 'a code cannot be claimed twice'
);

-- -------------------------------------------------------------- driving --
select is(
  (public.presentation_command((select (payload ->> 'session_id')::uuid from t_open), 'next')).current_slide,
  0, 'next stops at the end of an empty deck'
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

select set_config('request.jwt.claim.sub', 'aa110000-0000-0000-0000-000000000001', true);
select is(
  (public.presentation_command((select (payload ->> 'session_id')::uuid from t_open), 'end')).status::text,
  'ended', 'the host can end the session'
);

reset role;
select * from finish();
rollback;
