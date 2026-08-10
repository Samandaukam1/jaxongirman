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
select ok(not has_function_privilege('anon', 'public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text)', 'EXECUTE'),
  'a signed-out caller cannot start a generation');

-- The projector opens and refreshes its own pairing code while signed out, and
-- those two are the whole of what `anon` is meant to be able to call. Trigger
-- functions are excluded: they return `trigger`, so PostgREST will not expose
-- them as RPCs and the trigger machinery, not a caller, invokes them.
select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and pg_get_function_result(p.oid) <> 'trigger'
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  2, 'only the two pairing entry points are callable by a signed-out caller'
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
