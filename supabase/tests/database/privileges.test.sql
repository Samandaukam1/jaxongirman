begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- Standing guards over privileges that come from defaults rather than from
-- decisions. Each of these was true at some point in this schema's life; the
-- test exists so that stops being something anyone has to remember.

-- Row-level security has nothing to say about TRUNCATE: there are no rows to
-- filter, only a table to empty. A policy is therefore not what stops it.
select is(
  (select count(*)::integer from information_schema.table_privileges
   where table_schema = 'public' and grantee = 'anon' and privilege_type = 'TRUNCATE'),
  0, 'a signed-out caller cannot empty any table'
);
select is(
  (select count(*)::integer from information_schema.table_privileges
   where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE'),
  0, 'a signed-in caller cannot empty any table'
);

-- Postgres grants EXECUTE to PUBLIC when a function is created, and a later
-- grant to `authenticated` adds to that rather than replacing it.
select ok(not has_function_privilege('anon', 'public.admin_adjust_credits(uuid, integer, text, text)', 'EXECUTE'),
  'a signed-out caller cannot reach the credit adjuster');
select ok(not has_function_privilege('anon', 'public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text, text)', 'EXECUTE'),
  'a signed-out caller cannot start a generation');

-- What a signed-out caller may reach, and nothing else: a presentation screen
-- (open, rotate, snapshot, command), an O‘yingoh projector (open, rotate,
-- snapshot), and the landings a scanned QR opens (join_info, and the two
-- pair_info calls, which answer only whether a code is still live). Trigger
-- functions are excluded: they return `trigger`, so PostgREST will not expose
-- them as RPCs and the trigger machinery, not a caller, invokes them.
--
-- The names are listed rather than counted. A count says a door was added; only
-- the list says which one, and a swap that keeps the total the same is exactly
-- the change worth catching.
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and pg_get_function_result(p.oid) <> 'trigger'
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  array[
    'game_join_info',
    'game_pair_info',
    'game_pairing_rotate',
    'game_screen_open',
    'game_screen_snapshot',
    'presentation_pair_info',
    'presentation_pairing_rotate',
    'presentation_screen_command',
    'presentation_screen_snapshot',
    'presentation_session_open'
  ],
  'only pairing, screen-capability and scan-landing entry points are callable by a signed-out caller'
);

-- A definer function that does not pin its search_path can be redirected by a
-- caller who controls a schema earlier in the path.
select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}')) as setting
       where setting like 'search_path=%'
     )),
  0, 'every definer function pins its search_path'
);

select is(
  (select count(*)::integer
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'every public table has row-level security switched on'
);

select * from finish();
rollback;
